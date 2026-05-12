"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBase } from "@/lib/api";
import { computeCartTotals } from "@/lib/cartPricing";
import { subscriptionGrantedFromOrdersPayload } from "@/lib/trialAccess";
import { isPlatformSuperAdmin } from "@/lib/platformUser";
import styles from "./page.module.css";

export default function BillingChoicePage() {
  const router = useRouter();
  const { isLoaded, userId, user } = useAuth();
  const [cart, setCart] = useState({ plan: null, addons: [], currency: "INR" });
  const [phase, setPhase] = useState("loading");
  const [trialBusy, setTrialBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCart = useCallback(() => {
    try {
      const raw = localStorage.getItem("rnd_cart");
      if (raw) setCart(JSON.parse(raw));
    } catch {
      setCart({ plan: null, addons: [], currency: "INR" });
    }
  }, []);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  useEffect(() => {
    if (!isLoaded || !userId) return;

    let cancelled = false;

    async function run() {
      setPhase("loading");
      setError("");
      try {
        if (!userId) {
          router.replace("/login");
          return;
        }

        const res = await fetch(`${getApiBase()}/orders`, { credentials: "include", 
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !data.success) {
          setError(data.message || "Could not load your account.");
          setPhase("error");
          return;
        }

        const hasLive = subscriptionGrantedFromOrdersPayload(data);

        if (hasLive) {
          router.replace("/dashboard");
          return;
        }

        const elig = data.trialEligibility?.eligible === true;

        const raw = localStorage.getItem("rnd_cart");
        let c = { plan: null, addons: [], currency: "INR" };
        try {
          if (raw) c = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        setCart(c);

        if (!c.plan) {
          router.replace("/add-package");
          return;
        }

        if (!elig) {
          router.replace("/cart");
          return;
        }

        setPhase("ready");
      } catch {
        if (!cancelled) {
          setError("Network error. Try again.");
          setPhase("error");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, user, router]);

  const { sym, planPrice, addonsTotal, subtotal, gst, total } = computeCartTotals(cart);

  const startTrial = async () => {
    if (!cart.plan?.id) return;
    setTrialBusy(true);
    setError("");
    try {
      const res = await fetch(`${getApiBase()}/orders/start-trial`, { credentials: "include", 
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_id: cart.plan.id,
          currency: cart.currency || "INR",
          addons: cart.addons || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Could not start your trial.");
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
      setError("Could not start trial. Check your connection.");
    } finally {
      setTrialBusy(false);
    }
  };

  const payNow = async () => {
    setPayBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payment/checkout", { credentials: "include", 
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          },
        body: JSON.stringify({
          package_name: cart.plan?.name || null,
          package_price: planPrice,
          currency: cart.currency || "INR",
          addons: cart.addons || [],
          subtotal,
          gst,
          total,
          return_origin:
            typeof window !== "undefined" ? window.location.origin : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setError(data.message || "Payment could not be started.");
    } catch {
      setError("Payment could not be started.");
    } finally {
      setPayBusy(false);
    }
  };

  if (!isLoaded || phase === "loading") {
    return (
      <div className={styles.loading}>
        <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow)" }} />
        Preparing checkout…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={styles.page}>
        <p className={styles.errorBanner}>{error || "Something went wrong."}</p>
        <button type="button" className={styles.backLink} onClick={() => router.push("/add-package")}>
          <i className="fas fa-arrow-left" /> Back to packages
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backLink} onClick={() => router.push("/add-package")}>
          <i className="fas fa-arrow-left" /> Previous
        </button>
        <h1 className={styles.title}>Review Your Order and Proceed</h1>
        <p className={styles.subtitle}>
          Choose a 7-day full-feature trial (no card) or pay now to subscribe immediately.
        </p>
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.layout}>
        <div className={styles.tablePanel}>
          <div className={styles.tableHead}>
            <i className="fas fa-file-invoice-dollar" style={{ color: "var(--yellow)" }} />
            Order lines
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {cart.plan ? (
                <tr>
                  <td>{cart.plan.name}</td>
                  <td>
                    {sym}
                    {planPrice.toLocaleString()}
                  </td>
                  <td>1</td>
                  <td>
                    {sym}
                    {planPrice.toLocaleString()}
                  </td>
                </tr>
              ) : null}
              {cart.addons.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>
                    {sym}
                    {Number(a.priceRaw || 0).toLocaleString()}
                  </td>
                  <td>1</td>
                  <td>
                    {sym}
                    {Number(a.priceRaw || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.totals}>
            <div className={styles.totalRow}>
              <span>Subtotal</span>
              <span>
                {sym}
                {subtotal.toLocaleString()}
              </span>
            </div>
            <div className={styles.totalRow}>
              <span>GST (18%)</span>
              <span>
                {sym}
                {gst.toLocaleString()}
              </span>
            </div>
            <div className={styles.totalRowStrong}>
              <span>Total</span>
              <span>
                {sym}
                {total.toLocaleString()}
              </span>
            </div>
            <p className={styles.couponNote}>
              Add-ons in your cart are included in payment. On a free trial, you get full CRM access for the
              selected plan tier; paid add-ons activate when you subscribe.
            </p>
          </div>
        </div>

        <div className={styles.side}>
          <p className={styles.trialNote}>
            First-time workspace: one 7-day trial per account. If you already used a trial, use Pay now.
          </p>
          <div className={`${styles.choiceCard} ${styles.choiceCardTrial}`}>
            <div className={styles.choiceIcon} aria-hidden>
              <i className="fas fa-clock" style={{ color: "#16a34a" }} />
            </div>
            <h3 className={styles.choiceTitle}>Start 7 Days Trial</h3>
            <p className={styles.choiceSub}>Free — full plan access</p>
            <button
              type="button"
              className={styles.btnTrial}
              disabled={trialBusy || payBusy}
              onClick={startTrial}
            >
              {trialBusy ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Starting…
                </>
              ) : (
                "Start Free Trial"
              )}
            </button>
          </div>

          <div className={`${styles.choiceCard} ${styles.choiceCardPay}`}>
            <div className={styles.choiceIcon} aria-hidden>
              <i className="fas fa-credit-card" style={{ color: "#5b57a6" }} />
            </div>
            <h3 className={styles.choiceTitle}>Make a Payment</h3>
            <p className={styles.choiceSub}>
              {sym}
              {total.toLocaleString()}
            </p>
            <button
              type="button"
              className={styles.btnPay}
              disabled={payBusy || trialBusy}
              onClick={payNow}
            >
              {payBusy ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Redirecting…
                </>
              ) : (
                "Pay Now"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
