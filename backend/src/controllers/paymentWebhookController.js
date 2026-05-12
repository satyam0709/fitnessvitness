const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { invalidateSubscriptionCache } = require("../services/tenantAccessService");

function safeJsonBody(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function verifyRazorpaySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function handleRazorpayWebhook(req, res) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const sig = req.headers["x-razorpay-signature"];
    if (!secret) {
      return res.status(500).json({ success: false, message: "RAZORPAY_WEBHOOK_SECRET missing." });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyRazorpaySignature(raw, sig, secret)) {
      return res.status(400).json({ success: false, message: "Invalid Razorpay webhook signature." });
    }

    const event = safeJsonBody(raw);
    const eventType = String(event?.event || "");
    const notes = event?.payload?.payment?.entity?.notes || event?.payload?.subscription?.entity?.notes || {};
    const tenantId = notes.tenant_id ? String(notes.tenant_id) : "";

    if (eventType === "payment.captured" && tenantId) {
      const addonType = String(notes.addon_type || "extra_staff_seat");
      const qty = Math.max(1, Number(notes.quantity) || 1);
      const amountPaise = Number(event?.payload?.payment?.entity?.amount) || 0;
      const paid = Number((amountPaise / 100).toFixed(2));
      await mainPool.execute(
        `INSERT INTO tenant_addons (id, tenant_id, addon_type, quantity, price_paid, active_until)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
        [crypto.randomUUID(), tenantId, addonType, qty, paid]
      );
      invalidateSubscriptionCache(tenantId);
    }

    if (eventType === "subscription.activated" && tenantId) {
      await mainPool.execute(
        `UPDATE subscriptions
         SET status = 'active', updated_at = NOW()
         WHERE tenant_id = ? AND status IN ('trial','expired','suspended')`,
        [tenantId]
      );
      invalidateSubscriptionCache(tenantId);
    }

    return res.json({ success: true, received: true });
  } catch (err) {
    console.error("handleRazorpayWebhook:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { handleRazorpayWebhook };

