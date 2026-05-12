const Stripe = require("stripe");
const { mainPool } = require("../config/database");
const { expireStaleTrials } = require("./orderController");
const { onPaidWorkspaceSubscription } = require("../services/workspacePurchaseHook");
const { getStripePlanLineItem } = require("../services/packageCatalogService");
const { validateCouponForCheckout } = require("../services/couponService");

const CHECKOUT_GST_RATE = 0.18;

function publicWorkspaceUrlFromTenant(tenant) {
  if (!tenant) return null;
  const sub = String(tenant.subdomain || tenant.slug || "").trim();
  if (!sub) return null;
  const base = String(process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const useHttp = String(process.env.WORKSPACE_PUBLIC_HTTP || "").trim() === "1";
  const proto = useHttp ? "http" : "https";
  return `${proto}://${sub}.${base}`;
}

async function getWorkspaceVerificationState(tenantId) {
  if (!tenantId) {
    return { ready: true, tenant_status: null, database_status: null, reason: null };
  }
  const [[tenantRow]] = await mainPool.execute(
    "SELECT subdomain_status FROM tenants WHERE id = ? LIMIT 1",
    [tenantId]
  );
  const [[tenantDbRow]] = await mainPool.execute(
    "SELECT status FROM tenant_databases WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1",
    [tenantId]
  );
  const tenantStatus = String(tenantRow?.subdomain_status || "").toLowerCase() || null;
  const dbStatus = String(tenantDbRow?.status || "").toLowerCase() || null;
  const tenantReady = !tenantStatus || tenantStatus === "active";
  const dbReady = !dbStatus || dbStatus === "active";
  return {
    ready: tenantReady && dbReady,
    tenant_status: tenantStatus,
    database_status: dbStatus,
    reason: !tenantReady
      ? "tenant_pending_verification"
      : !dbReady
        ? "database_pending_verification"
        : null,
  };
}

/** Matches `orders.user_id` as written by orderController (clerk id string preferred, else DB user id). */
function orderUserIdCandidates(req) {
  const out = [];
  const clerk =
    req.user?.clerkUserId != null && String(req.user.clerkUserId).trim()
      ? String(req.user.clerkUserId).trim()
      : req.user?.clerk_user_id != null && String(req.user.clerk_user_id).trim()
        ? String(req.user.clerk_user_id).trim()
        : "";
  if (clerk) out.push(clerk);
  if (req.user?.id != null) {
    const id = String(req.user.id);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

let stripeSingleton = null;
let paymentSessionUserColumnsCache = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || typeof key !== "string" || !key.trim()) {
    return null;
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key.trim());
  }
  return stripeSingleton;
}

async function getPaymentSessionUserColumns() {
  if (!paymentSessionUserColumnsCache) {
    paymentSessionUserColumnsCache = (async () => {
      const [rows] = await mainPool.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'payment_sessions'
           AND COLUMN_NAME IN ('user_id', 'clerk_user_id')`
      );
      const names = new Set(rows.map((r) => String(r.COLUMN_NAME || "").toLowerCase()));
      return {
        hasUserId: names.has("user_id"),
        hasClerkUserId: names.has("clerk_user_id"),
      };
    })().catch(() => ({
      hasUserId: true,
      hasClerkUserId: false,
    }));
  }
  return paymentSessionUserColumnsCache;
}

function collectAllowedCheckoutOrigins() {
  const origins = new Set();
  const add = (raw) => {
    if (!raw || typeof raw !== "string") return;
    const t = raw.trim().replace(/\/$/, "");
    if (!t) return;
    try {
      const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      origins.add(new URL(withProto).origin);
    } catch {
      /* ignore invalid */
    }
  };
  add(process.env.FRONTEND_URL);
  for (const part of (process.env.ALLOWED_CHECKOUT_ORIGINS || "").split(",")) {
    add(part);
  }
  if (process.env.VERCEL_URL) {
    add(`https://${process.env.VERCEL_URL}`);
  }
  return origins;
}

function isAllowedReturnOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return collectAllowedCheckoutOrigins().has(parsed.origin);
}

function resolveCheckoutBaseUrl(returnOrigin) {
  const fallback = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  if (!returnOrigin || typeof returnOrigin !== "string") {
    return fallback;
  }
  try {
    const candidate = returnOrigin.trim().replace(/\/$/, "");
    const o = new URL(candidate);
    const origin = o.origin;
    if (isAllowedReturnOrigin(origin)) {
      return origin;
    }
  } catch {
    /* use fallback */
  }
  return fallback;
}

/**
 * Idempotent: upsert user's order + mark payment_sessions completed when Stripe says the checkout is paid.
 * Used by the webhook and by GET /payment/status so the success page does not depend on webhook timing alone.
 */
async function syncOrderFromPaidCheckoutSession(session) {
  const rawUserId = session.metadata?.user_id || session.metadata?.clerk_user_id;
  const packageName = session.metadata?.package_name;
  const currency = (session.metadata?.currency || "INR").toUpperCase();
  const userId = String(rawUserId || "").trim();

  if (!userId) {
    return { ok: false, reason: "no_user_in_metadata" };
  }

  await expireStaleTrials(userId).catch(() => {});

  const ps = session.payment_status;
  if (ps !== "paid" && ps !== "no_payment_required") {
    return { ok: false, reason: "not_paid" };
  }

  try {
    const [dupSess] = await mainPool.execute(
      "SELECT status FROM payment_sessions WHERE stripe_session_id = ? LIMIT 1",
      [session.id]
    );
    if (dupSess.length && String(dupSess[0].status).toLowerCase() === "completed") {
      return { ok: true, duplicate: true };
    }
    const addonsIds = JSON.parse(session.metadata?.addons_json || "[]");
    const totalPaid = session.amount_total != null ? session.amount_total / 100 : 0;

    const [existingOrders] = await mainPool.execute(
      "SELECT id, package_name FROM orders WHERE user_id = ? AND status IN ('active', 'trial') LIMIT 1",
      [userId]
    );

    if (existingOrders.length > 0) {
      const row = existingOrders[0];
      await mainPool.execute(
        `UPDATE orders SET package_name = ?, package_price = ?, currency = ?, total = ?, status = 'active', updated_at = NOW() WHERE id = ?`,
        [packageName || row.package_name || "addon_only", totalPaid, currency, totalPaid, row.id]
      );
    } else {
      await mainPool.execute(
        `INSERT INTO orders (user_id, package_name, package_price, currency, addons, subtotal, gst, total, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          userId,
          packageName || "addon_only",
          totalPaid,
          currency,
          JSON.stringify(addonsIds),
          totalPaid * 0.847,
          totalPaid * 0.153,
          totalPaid,
        ]
      );
    }

    let affected = 0;
    try {
      const [psUp] = await mainPool.execute(
        `UPDATE payment_sessions SET status = 'completed', stripe_payment_intent = ?
         WHERE stripe_session_id = ? AND status = 'pending'`,
        [session.payment_intent || "", session.id]
      );
      affected = psUp.affectedRows || 0;
    } catch (e) {
      console.error("payment_sessions update:", e.message);
    }
    if (affected > 0 && session.metadata?.coupon_id) {
      const cid = Number(session.metadata.coupon_id);
      if (cid) {
        await mainPool
          .execute(
            `UPDATE coupons SET redemptions_used = redemptions_used + 1
             WHERE id = ? AND (max_redemptions IS NULL OR redemptions_used < max_redemptions)`,
            [cid]
          )
          .catch(() => {});
      }
    }

    const paidPkg = String(packageName || "Silver").trim();
    if (!/^addon/i.test(paidPkg)) {
      await onPaidWorkspaceSubscription(userId, paidPkg).catch((e) =>
        console.error("onPaidWorkspaceSubscription:", e.message)
      );
    }

    return { ok: true, userId, packageName: paidPkg, duplicate: false };
  } catch (err) {
    console.error("syncOrderFromPaidCheckoutSession:", err.message);
    return { ok: false, reason: err.message };
  }
}

const PLAN_PRICES = {
  INR: {
    Gold: { amount: 275000, currency: "inr" },
    Diamond: { amount: 435000, currency: "inr" },
    Platinum: { amount: 780000, currency: "inr" },
  },
  USD: {
    Gold: { amount: 3300, currency: "usd" },
    Diamond: { amount: 5200, currency: "usd" },
    Platinum: { amount: 9400, currency: "usd" },
  },
};

async function resolvePlanStripeCents(package_name, package_price, curr) {
  const dbLine = await getStripePlanLineItem(package_name, package_price, curr);
  if (dbLine && dbLine.unit_amount > 0) {
    return {
      cents: dbLine.unit_amount,
      stripeCurrency: dbLine.stripeCurrency,
      displayName: dbLine.displayName,
    };
  }
  const planConfig = PLAN_PRICES[curr]?.[package_name];
  if (planConfig) {
    return {
      cents: planConfig.amount,
      stripeCurrency: planConfig.currency,
      displayName: package_name,
    };
  }
  const sanitized = Math.round(
    parseFloat(String(package_price || 0).replace(/[₹$,]/g, "")) * 100
  );
  if (sanitized > 0) {
    return {
      cents: sanitized,
      stripeCurrency: curr === "USD" ? "usd" : "inr",
      displayName: package_name,
    };
  }
  return null;
}

async function createCheckoutSession(req, res) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        code: "STRIPE_NOT_CONFIGURED",
        message:
          "Payments are not configured. Add STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks) in your API host environment — e.g. Render → Environment.",
      });
    }

    const userId = req.user?.id != null ? String(req.user.id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const {
      package_name,
      package_price,
      currency = "INR",
      addons = [],
      return_origin,
      coupon_code,
      cancel_path,
    } = req.body;

    if (!package_name && (!Array.isArray(addons) || addons.length === 0)) {
      return res.status(400).json({ success: false, message: "No items selected" });
    }

    const curr = String(currency || "INR").toUpperCase();
    const stripeCurrDefault = curr === "USD" ? "usd" : "inr";

    let couponMeta = { id: null, code: null, discount_percent: "0" };
    let discountPercent = 0;
    if (coupon_code) {
      const v = await validateCouponForCheckout(coupon_code);
      if (!v.ok) {
        return res.status(400).json({ success: false, message: v.message });
      }
      discountPercent = v.coupon.discount_percent;
      couponMeta = {
        id: v.coupon.id,
        code: v.coupon.code,
        discount_percent: String(discountPercent),
      };
    }

    const merchParts = [];

    if (package_name) {
      const plan = await resolvePlanStripeCents(package_name, package_price, curr);
      if (plan && plan.cents > 0) {
        merchParts.push({
          cents: plan.cents,
          stripeCurrency: plan.stripeCurrency,
          title: `${plan.displayName} Plan - RND CRM`,
          description: `Subscription — ${plan.displayName}`,
        });
      }
    }

    for (const addon of addons) {
      const addonPrice = Math.round(
        parseFloat(String(addon.priceRaw || addon.price || 0).replace(/[₹$,]/g, "")) * 100
      );
      if (addonPrice > 0) {
        merchParts.push({
          cents: addonPrice,
          stripeCurrency: stripeCurrDefault,
          title: `${addon.name || "Add-on"} Add-on`,
          description: "",
        });
      }
    }

    if (merchParts.length === 0) {
      return res.status(400).json({ success: false, message: "Could not calculate line items" });
    }

    const factor = discountPercent > 0 ? (100 - discountPercent) / 100 : 1;
    const origMerchTotal = merchParts.reduce((s, p) => s + p.cents, 0);
    const targetMerchTotal = Math.round(origMerchTotal * factor);

    const discounted = merchParts.map((p) => ({
      ...p,
      cents: Math.max(0, Math.round(p.cents * factor)),
    }));
    let sumDisc = discounted.reduce((s, p) => s + p.cents, 0);
    if (discounted.length > 0) {
      const drift = targetMerchTotal - sumDisc;
      discounted[0].cents = Math.max(0, discounted[0].cents + drift);
    }

    const lineItems = discounted.map((p) => ({
      price_data: {
        currency: p.stripeCurrency,
        product_data: {
          name: p.title,
          ...(p.description ? { description: p.description } : {}),
        },
        unit_amount: p.cents,
      },
      quantity: 1,
    }));

    const gstCents = Math.round(targetMerchTotal * CHECKOUT_GST_RATE);
    if (gstCents > 0) {
      lineItems.push({
        price_data: {
          currency: stripeCurrDefault,
          product_data: { name: "GST (18%)" },
          unit_amount: gstCents,
        },
        quantity: 1,
      });
    }

    const totalMajor = (targetMerchTotal + gstCents) / 100;

    const frontendBase = resolveCheckoutBaseUrl(return_origin);
    const cp = String(cancel_path || "").trim();
    const cancelUrl =
      cp.startsWith("/") && !cp.startsWith("//") && !cp.includes(":")
        ? `${frontendBase.replace(/\/$/, "")}${cp}`
        : `${frontendBase}/cart?cancelled=true`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: curr === "INR" ? ["card"] : ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${frontendBase}/payment/success?session_id={CHECKOUT_SESSION_ID}&billing=paid`,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId,
        package_name: package_name || "",
        currency: curr,
        addons_json: JSON.stringify((addons || []).map((a) => a.id)),
        coupon_id: couponMeta.id != null ? String(couponMeta.id) : "",
        coupon_code: couponMeta.code || "",
        discount_percent: couponMeta.discount_percent,
      },
      customer_email: req.user?.email || undefined,
    });

    const userColumns = await getPaymentSessionUserColumns();
    const clerkUserId =
      req.user?.clerkUserId != null && String(req.user.clerkUserId).trim()
        ? String(req.user.clerkUserId).trim()
        : req.user?.clerk_user_id != null && String(req.user.clerk_user_id).trim()
          ? String(req.user.clerk_user_id).trim()
          : userId;
    const insertColumns = [];
    const insertValues = [];
    if (userColumns.hasUserId) {
      insertColumns.push("user_id");
      insertValues.push(userId);
    }
    if (userColumns.hasClerkUserId) {
      insertColumns.push("clerk_user_id");
      insertValues.push(clerkUserId || userId);
    }
    if (insertColumns.length === 0) {
      return res.status(500).json({ success: false, message: "payment_sessions schema is missing user columns." });
    }
    insertColumns.push(
      "stripe_session_id",
      "package_name",
      "currency",
      "total_amount",
      "status",
      "coupon_code",
      "coupon_id"
    );
    insertValues.push(
      session.id,
      package_name || "addon_only",
      curr,
      Math.round(totalMajor * 100) / 100,
      "pending",
      couponMeta.code || null,
      couponMeta.id != null ? Number(couponMeta.id) : null
    );
    const placeholders = insertColumns.map(() => "?").join(", ");
    await mainPool.execute(
      `INSERT INTO payment_sessions (${insertColumns.join(", ")})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE status = 'pending',
         coupon_code = VALUES(coupon_code), coupon_id = VALUES(coupon_id), total_amount = VALUES(total_amount)`,
      insertValues
    );

    res.json({ success: true, checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("createCheckoutSession error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function handleStripeWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    console.error("STRIPE_SECRET_KEY not set");
    return res.status(500).json({ message: "Stripe not configured" });
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).json({ message: "Stripe webhook secret not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook verification failed:", err.message);
    return res.status(400).json({ message: `Webhook error: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sync = await syncOrderFromPaidCheckoutSession(session);

    if (!sync.ok && sync.reason !== "not_paid") {
      if (sync.reason === "no_user_in_metadata") {
        console.error("No user_id in stripe metadata");
      } else {
        console.error("Webhook order sync failed:", sync.reason);
      }
    } else if (sync.ok && !sync.duplicate) {
      console.log(
        `Payment completed for user ${session.metadata?.user_id}, plan: ${session.metadata?.package_name}`
      );
      /* Welcome email is sent from syncOrderFromPaidCheckoutSession when payment_sessions first completes */
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    await mainPool
      .execute("UPDATE payment_sessions SET status = 'expired' WHERE stripe_session_id = ?", [
        session.id,
      ])
      .catch(() => {});
  }

  res.status(200).json({ received: true });
}

async function getPaymentStatus(req, res) {
  try {
    const { session_id, order_id } = req.query;
    const userId = req.user?.id != null ? String(req.user.id) : null;

    if (!session_id && !order_id) {
      return res.status(400).json({ success: false, message: "Missing payment reference" });
    }

    if (session_id && !userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (order_id && !session_id) {
      const candidates = orderUserIdCandidates(req);
      const orderQuery = candidates.length
        ? `SELECT * FROM orders WHERE id = ? AND user_id IN (${candidates.map(() => "?").join(",")}) LIMIT 1`
        : `SELECT * FROM orders WHERE id = ? LIMIT 1`;
      const orderArgs = candidates.length ? [order_id, ...candidates] : [order_id];
      const [orders] = await mainPool.execute(orderQuery, orderArgs);
      const order = orders[0] || null;
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      let tenantId = req.user?.tenant_id || req.user?.tenantId || null;
      if (!tenantId) {
        const [userRows] = await mainPool.execute(
          "SELECT tenant_id FROM users WHERE id = ? LIMIT 1",
          [order.user_id]
        );
        tenantId = userRows[0]?.tenant_id || null;
      }

      const [tenantRows] = tenantId
        ? await mainPool.execute(
            "SELECT company_name, subdomain, slug FROM tenants WHERE id = ? LIMIT 1",
            [tenantId]
          )
        : [[]];
      const [ownerRows] = tenantId
        ? await mainPool.execute(
            `SELECT email FROM users WHERE tenant_id = ? AND id = (
               SELECT owner_user_id FROM tenants WHERE id = ? LIMIT 1
             ) LIMIT 1`,
            [tenantId, tenantId]
          )
        : [[]];
      const tenant = tenantRows[0] || {};
      const workspaceVerification = await getWorkspaceVerificationState(tenantId);

      const ost = String(order.status || "").toLowerCase();
      order.user_email = ownerRows[0]?.email || req.user?.email || null;
      return res.json({
        success: ["active", "trial", "paid"].includes(ost),
        status: order.status,
        payment_status: "completed",
        billing_mode: ost === "trial" ? "trial" : "paid",
        package_name: order.package_name || null,
        company_name: tenant.company_name || null,
        subdomain: tenant.subdomain || tenant.slug || null,
        user_email: ownerRows[0]?.email || req.user?.email || null,
        workspace_url: publicWorkspaceUrlFromTenant(tenant),
        workspace_verification: workspaceVerification,
        workspace_access_ready: workspaceVerification.ready,
        registration_complete: true,
        order,
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        code: "STRIPE_NOT_CONFIGURED",
        message:
          "Payments are not configured. Add STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks) in your API host environment — e.g. Render → Environment.",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (String(session.metadata?.user_id || "") !== userId) {
      return res.status(403).json({ success: false, message: "Not your session" });
    }

    const stripePaymentStatus = String(session.payment_status || "").toLowerCase();
    const isPaid = ["paid", "no_payment_required"].includes(stripePaymentStatus);

    // If Stripe confirms payment, sync order.
    // NOTE: syncOrderFromPaidCheckoutSession already handles calling onPaidWorkspaceSubscription internally
    // if it's not a duplicate order. We do not need to call it again here.
    if (isPaid) {
      await syncOrderFromPaidCheckoutSession(session).catch((err) => {
        console.error("getPaymentStatus sync failed:", err.message);
        return { ok: false, reason: err.message };
      });
    }

    const [psRows] = await mainPool.execute(
      "SELECT status FROM payment_sessions WHERE stripe_session_id = ? LIMIT 1",
      [session_id]
    );
    const persistedStatus = psRows[0]?.status || "pending";

    // If Stripe says it's paid but our DB says pending, treat as success anyway
    // (webhook may still be in flight)
    const effectiveStatus = isPaid && persistedStatus === "pending" ? "completed" : persistedStatus;

    if (effectiveStatus !== "completed") {
      return res.json({
        success: false,
        payment_status: effectiveStatus,
        message: "Payment is processing. Waiting for verification.",
        order: null,
      });
    }

    const [orders] = await mainPool.execute(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    const order = orders[0] || null;

    let tenantId = req.user?.tenant_id || req.user?.tenantId || null;
    if (!tenantId) {
      const [userRows] = await mainPool.execute(
        "SELECT tenant_id FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      tenantId = userRows[0]?.tenant_id || null;
    }

    const [subscriptionRows] = tenantId
      ? await mainPool.execute(
          `SELECT s.status, p.name AS package_name
           FROM subscriptions s
           LEFT JOIN subscription_packages p ON p.id = s.package_id
           WHERE s.tenant_id = ?
           ORDER BY s.created_at DESC
           LIMIT 1`,
          [tenantId]
        )
      : [[]];
    const subscription = subscriptionRows[0] || {};

    const [tenantRows] = tenantId
      ? await mainPool.execute(
          "SELECT company_name, subdomain, slug FROM tenants WHERE id = ? LIMIT 1",
          [tenantId]
        )
      : [[]];
    const [ownerRows] = tenantId
      ? await mainPool.execute(
          `SELECT email FROM users WHERE tenant_id = ? AND id = (
             SELECT owner_user_id FROM tenants WHERE id = ? LIMIT 1
           ) LIMIT 1`,
          [tenantId, tenantId]
        )
      : [[]];
    const tenant = tenantRows[0] || {};
    const workspaceVerification = await getWorkspaceVerificationState(tenantId);

    const orderSt = String(order?.status || "").toLowerCase();
    const subSt = String(subscription.status || "").toLowerCase();
    const billingMode = subSt === "trial" || orderSt === "trial" ? "trial" : "paid";

    res.json({
      success: true,
      status: subscription.status || order?.status || "active",
      payment_status: persistedStatus,
      billing_mode: billingMode,
      package_name: subscription.package_name || order?.package_name || null,
      company_name: tenant.company_name || null,
      subdomain: tenant.subdomain || tenant.slug || null,
      user_email: ownerRows[0]?.email || req.user?.email || null,
      workspace_url: publicWorkspaceUrlFromTenant(tenant),
      workspace_verification: workspaceVerification,
      workspace_access_ready: workspaceVerification.ready,
      registration_complete: true,
      order,
    });
  } catch (err) {
    console.error("getPaymentStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { createCheckoutSession, handleStripeWebhook, getPaymentStatus };
