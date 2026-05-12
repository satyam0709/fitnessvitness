"use client";
import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { computeCartTotals } from "@/lib/cartPricing";
import { subscriptionGrantedFromOrdersPayload } from "@/lib/trialAccess";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";
import styles from "./page.module.css";

function resolveTrialMessage(reason, message) {
  if (message) return message;
  const r = String(reason || "").toLowerCase();
  if (r === "workspace_trial_active") {
    return "Your workspace trial is already active. You can continue with secure payment anytime.";
  }
  if (r === "workspace_subscription") {
    return "Your workspace subscription is already active.";
  }
  if (r === "already_registered") {
    return "Your free trial was used. Please continue with secure payment.";
  }
  return "Free trial is not available for this account. Please continue with secure payment.";
}

function CartPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, userId } = useAuth();
  const [cart, setCart] = useState({ plan: null, addons: [], currency: "INR" });
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState("");
  const [trialEligible, setTrialEligible] = useState(false);
  const [trialStatusLoaded, setTrialStatusLoaded] = useState(false);
  const [trialReason, setTrialReason] = useState("");
  const [trialInfoMessage, setTrialInfoMessage] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const onboardingRequested = searchParams.get("onboarding") === "1";

  useEffect(() => {
    const saved = localStorage.getItem("rnd_cart");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setCart({
        plan: null,
        addons: [],
        currency: "INR",
        coupon: null,
        ...parsed,
        addons: Array.isArray(parsed.addons) ? parsed.addons : [],
      });
    } catch {
      /* ignore */
    }
  }, []);

  const loadTrialAndAccessState = useCallback(async (cancelledRef) => {
    if (!isLoaded || !userId) return;
    try {
      if (cancelledRef?.current) return;
      await apiFetch("/users/sync", {
        method: "POST",
      });
      const res = await apiFetch("/orders");
      const data = await res.json().catch(() => ({}));
      if (cancelledRef?.current) return;
      if (!data.success) {
        setTrialEligible(false);
        setTrialReason("");
        setTrialInfoMessage(data.message || "");
        setTrialStatusLoaded(true);
        return;
      }
      const te = data.trialEligibility;
      let eligible = false;
      let reason = "";
      let infoMessage = "";
      if (te && typeof te.eligible === "boolean") {
        eligible = te.eligible;
        reason = te.reason || "";
        infoMessage = resolveTrialMessage(reason, te.message || "");
      } else {
        const list = Array.isArray(data.orders) ? data.orders : [];
        const hasLive = subscriptionGrantedFromOrdersPayload(data);
        if (hasLive) eligible = false;
        else if (list.length > 0) eligible = false;
        else eligible = true;
        infoMessage = eligible ? "" : resolveTrialMessage("", "");
      }
      setTrialEligible(eligible);
      setTrialReason(reason);
      setTrialInfoMessage(infoMessage);
      setTrialStatusLoaded(true);
    } catch {
      if (!cancelledRef?.current) {
        setTrialEligible(false);
        setTrialReason("");
        setTrialInfoMessage("");
        setTrialStatusLoaded(true);
      }
    }
  }, [isLoaded, userId]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const cancelledRef = { current: false };
    void loadTrialAndAccessState(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [isLoaded, userId, loadTrialAndAccessState]);

  useEffect(() => {
    if (!isLoaded || !userId) return undefined;
    const unsubscribe = subscribeWorkspaceAccess(() => {
      void loadTrialAndAccessState();
    });
    return unsubscribe;
  }, [isLoaded, userId, loadTrialAndAccessState]);

  useEffect(() => {
    function onOrdersChanged() {
      void loadTrialAndAccessState();
    }
    window.addEventListener("crm-orders-changed", onOrdersChanged);
    return () => {
      window.removeEventListener("crm-orders-changed", onOrdersChanged);
    };
  }, [loadTrialAndAccessState]);

  const { sym, planPrice, addonsTotal, subtotal, gst, total, discountAmount, couponPercent } = computeCartTotals(cart);
  const totalItems = (cart.plan ? 1 : 0) + cart.addons.length;

  const persistCart = (next) => {
    setCart(next);
    localStorage.setItem("rnd_cart", JSON.stringify(next));
  };

  const removeAddon = (id) => {
    const addons = cart.addons.filter((a) => a.id !== id);
    const updated = { ...cart, addons };
    if (!updated.plan && addons.length === 0) updated.coupon = null;
    persistCart(updated);
  };

  const removePlan = () => {
    const updated = { ...cart, plan: null };
    if (!updated.plan && (!updated.addons || updated.addons.length === 0)) updated.coupon = null;
    persistCart(updated);
  };

  async function applyCoupon() {
    setCouponMsg("");
    setCouponBusy(true);
    try {
      const res = await apiFetch("/coupons/validate", {
        method: "POST",
        body: JSON.stringify({ code: couponInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        setCouponMsg(data.message || "Could not validate coupon.");
        return;
      }
      if (!data.valid) {
        setCouponMsg(data.message || "Invalid coupon.");
        return;
      }
      const updated = {
        ...cart,
        coupon: { code: data.code, discount_percent: data.discount_percent },
      };
      persistCart(updated);
      setCouponMsg(`${data.discount_percent}% discount applied to package + add-ons (before GST).`);
      setCouponInput("");
    } catch {
      setCouponMsg("Network error.");
    } finally {
      setCouponBusy(false);
    }
  }

  function removeCoupon() {
    setCouponMsg("");
    const updated = { ...cart, coupon: null };
    persistCart(updated);
  }

  const hasSelectedPlan = Boolean(cart.plan?.id);
  const showTrialCta = trialStatusLoaded && hasSelectedPlan && trialEligible;
  const trialUnavailableMessage = resolveTrialMessage(trialReason, trialInfoMessage);

  const handleStartTrial = async () => {
    if (!cart.plan?.id) {
      setError("Select a package first to start your trial.");
      return;
    }
    setTrialLoading(true);
    setError("");
    try {
      const res = await apiFetch("/orders/start-trial", {
        method: "POST",
        body: JSON.stringify({
          plan_id: cart.plan.id,
          currency: cart.currency || "INR",
          addons: cart.addons || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Could not start your free trial.");
        return;
      }
      try {
        localStorage.removeItem("rnd_cart");
        localStorage.removeItem("rnd_onboarding");
        document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
        window.dispatchEvent(new CustomEvent("crm-orders-changed"));
      } catch {
        /* ignore */
      }
      router.replace(
        `/payment/success?order_id=${encodeURIComponent(String(data.order_id))}&billing=trial`
      );
    } catch {
      setError("Network error. Try again.");
    } finally {
      setTrialLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!cart.plan && cart.addons.length === 0) {
      setError("Your cart is empty. Please add a plan or addon to proceed.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch("/payment/checkout", {
        method: "POST",
        body: JSON.stringify({
          package_name: cart.plan?.name || null,
          package_price: planPrice,
          currency: cart.currency,
          addons: cart.addons,
          subtotal,
          gst,
          total,
          coupon_code: cart.coupon?.code || undefined,
          // Same host you started checkout on (localhost vs Vercel); backend validates allowlist
          return_origin:
            typeof window !== "undefined" ? window.location.origin : undefined,
          cancel_path: onboardingRequested ? "/add-package?onboarding=1&cancelled=1" : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && data.checkout_url) {
        // Keep rnd_cart until /payment/success confirms payment (fallback + UX if user cancels Stripe)
        window.location.href = data.checkout_url;
      } else {
        setError(data.message || "Failed to create checkout session.");
      }
    } catch {
      setError("Failed to connect to payment server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isEmpty = !cart.plan && cart.addons.length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          className={styles.backLink}
          onClick={() => router.push(onboardingRequested ? "/add-package?onboarding=1" : "/add-package")}
        >
          <i className="fas fa-arrow-left" />
          Back to Packages
        </button>
        <div>
          <div className={styles.stepIndicator}>
            <span className={styles.stepDot} />
            <span className={styles.stepText}>Step 2 of 3 — Review Order</span>
          </div>
        </div>
        <h1 className={styles.title}>Review Your Order</h1>
        <p className={styles.subtitle}>Please review your selected package and addon services before proceeding</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.itemsPanel}>
          <div className={styles.itemsPanelHeader}>
            <h3 className={styles.itemsPanelTitle}>
              <i className="fas fa-shopping-cart" />
              Cart Items
              {!isEmpty && <span className={styles.itemCount}>{totalItems}</span>}
            </h3>
          </div>

          {isEmpty ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🛒</div>
              <p className={styles.emptyText}>Your cart is empty</p>
              <p className={styles.emptySubText}>Add a plan or addon from the packages page to get started.</p>
            </div>
          ) : (
            <>
              {cart.plan && (
                <div className={styles.cartItem}>
                  <div className={styles.itemLeft}>
                    <div className={`${styles.itemIconWrap} ${styles.iconPlan}`}>📦</div>
                    <div className={styles.itemDetails}>
                      <div className={styles.itemTag}>
                        <i className="fas fa-star" style={{ fontSize: "8px" }} />
                        Yearly Plan
                      </div>
                      <p className={styles.itemName}>{cart.plan.name} Package</p>
                      <p className={styles.itemMeta}>{cart.plan.staff} Staff Members included</p>
                    </div>
                  </div>
                  <div className={styles.itemRight}>
                    <span className={styles.itemPrice}>
                      {sym}{cart.plan.priceRaw.toLocaleString()}
                    </span>
                    <button className={styles.removeBtn} onClick={removePlan} title="Remove plan">
                      <i className="fas fa-times" />
                    </button>
                  </div>
                </div>
              )}

              {cart.addons.map((addon) => (
                <div key={addon.id} className={styles.cartItem}>
                  <div className={styles.itemLeft}>
                    <div className={`${styles.itemIconWrap} ${styles.iconAddon}`}>🔧</div>
                    <div className={styles.itemDetails}>
                      <div className={styles.itemTag}>Add-on Service</div>
                      <p className={styles.itemName}>{addon.name}</p>
                      <p className={styles.itemMeta}>{addon.desc}</p>
                    </div>
                  </div>
                  <div className={styles.itemRight}>
                    <span className={styles.itemPrice}>
                      {sym}{addon.priceRaw.toLocaleString()}
                    </span>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeAddon(addon.id)}
                      title="Remove addon"
                    >
                      <i className="fas fa-times" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className={styles.summaryPanel}>
          <div className={styles.summaryHeader}>
            <h3 className={styles.summaryTitle}>
              <i className="fas fa-receipt" />
              Order Summary
            </h3>
          </div>

          <div className={styles.summaryBody}>
            <div className={styles.summaryRow}>
              <span>Package Charges</span>
              <span>{sym}{planPrice.toLocaleString()}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>Addon Services</span>
              <span>{sym}{addonsTotal.toLocaleString()}</span>
            </div>

            {couponPercent != null && discountAmount > 0 ? (
              <div className={styles.summaryRow} style={{ color: "#15803d" }}>
                <span>
                  Coupon ({couponPercent}%){cart.coupon?.code ? ` — ${cart.coupon.code}` : ""}
                </span>
                <span>−{sym}{discountAmount.toLocaleString()}</span>
              </div>
            ) : null}

            <div style={{ marginTop: 14, marginBottom: 8 }}>
              <p className={styles.summaryLabel} style={{ marginBottom: 6 }}>
                Promo code
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Enter code"
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-hover)",
                    color: "var(--text-main)",
                  }}
                  disabled={couponBusy || isEmpty}
                />
                <button
                  type="button"
                  onClick={() => applyCoupon()}
                  disabled={couponBusy || isEmpty || !couponInput.trim()}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--yellow-tint)",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {couponBusy ? <i className="fas fa-spinner fa-spin" /> : "Apply"}
                </button>
                {cart.coupon?.code ? (
                  <button
                    type="button"
                    onClick={removeCoupon}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-hover)",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {couponMsg ? (
                <p style={{ fontSize: 12, marginTop: 6, color: couponMsg.startsWith("Invalid") ? "#b91c1c" : "var(--text-muted)" }}>
                  {couponMsg}
                </p>
              ) : null}
            </div>

            <div className={styles.divider} />

            <p className={styles.summaryLabel}>Billing Breakdown</p>
            <div className={styles.summaryRow}>
              <span>Merchandise (after coupon)</span>
              <span>{sym}{subtotal.toLocaleString()}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>GST (18%)</span>
              <span>{sym}{gst.toLocaleString()}</span>
            </div>

            <div className={styles.divider} />

            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Total Payable</span>
              <span className={styles.totalAmount}>{sym}{total.toLocaleString()}</span>
            </div>
            <p className={styles.gstNote}>Inclusive of all taxes</p>

            {error && (
              <p className={styles.errorText}>
                <i className="fas fa-exclamation-circle" />
                {error}
              </p>
            )}

            {showTrialCta ? (
              <div className={styles.trialOffer}>
                <div className={styles.trialOfferIcon} aria-hidden>
                  <i className="fas fa-gift" />
                </div>
                <div>
                  <strong className={styles.trialOfferTitle}>New here? Start a 7-day free trial</strong>
                  <p className={styles.trialOfferText}>
                    Full CRM access for your selected plan — no card. One trial per account. Paid add-ons
                    activate when you subscribe.
                  </p>
                </div>
              </div>
            ) : null}

            {!showTrialCta && trialStatusLoaded ? (
              <div className={styles.stripeNote} style={{ marginTop: 10 }}>
                <i className="fas fa-info-circle" style={{ color: "var(--text-muted)", marginTop: "2px" }} />
                <span>{trialUnavailableMessage}</span>
              </div>
            ) : null}

            {showTrialCta ? (
              <button
                type="button"
                className={styles.trialBtn}
                onClick={handleStartTrial}
                disabled={trialLoading || loading || isEmpty}
              >
                {trialLoading ? (
                  <>
                    <i className="fas fa-spinner fa-spin" />
                    Starting trial…
                  </>
                ) : (
                  <>
                    <i className="fas fa-clock" />
                    Start 7-day free trial
                  </>
                )}
              </button>
            ) : null}

            <div
              className={styles.stripeNote}
              style={{ marginTop: showTrialCta ? 14 : 10 }}
            >
              <i className="fas fa-shield-alt" style={{ color: "var(--yellow)", marginTop: "2px" }} />
              <span>
                {showTrialCta
                  ? "Pay securely with Stripe (cards, UPI, net banking), or use Start 7-day free trial above — no payment needed."
                  : "Pay securely with Stripe. We accept major cards, UPI, and net banking."}
              </span>
            </div>

            <button
              className={styles.payBtn}
              onClick={handleCheckout}
              disabled={loading || trialLoading || isEmpty}
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin" />
                  Redirecting to Payment...
                </>
              ) : (
                <>
                  Pay {sym}{total.toLocaleString()} Securely
                  <i className="fas fa-arrow-right" />
                </>
              )}
            </button>

            <div className={styles.secureNote}>
              <i className="fas fa-lock" />
              Powered by Stripe — PCI DSS compliant
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CartPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading cart...</div>}>
      <CartPageInner />
    </Suspense>
  );
}
