const { createCheckoutSession } = require("./paymentController");

function parseAmountMajor(body) {
  const clean = (v) => {
    if (typeof v === "number") return v;
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[₹$,]/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };
  const total = clean(body?.total);
  if (total > 0) return total;
  return clean(body?.package_price) + clean(body?.addons_total) + clean(body?.gst);
}

async function createUnifiedCheckout(req, res) {
  try {
    const currency = String(req.body?.currency || "INR").toUpperCase() === "USD" ? "USD" : "INR";
    const preferred = String(req.body?.payment_gateway || "").toLowerCase();
    const useRazorpay =
      preferred === "razorpay" ||
      (currency === "INR" && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && preferred !== "stripe");

    if (!useRazorpay) {
      return createCheckoutSession(req, res);
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return res.status(503).json({ success: false, message: "Razorpay is not configured." });
    }

    const amountMajor = parseAmountMajor(req.body);
    const amountMinor = Math.round(amountMajor * 100);
    if (!amountMinor || amountMinor < 100) {
      return res.status(400).json({ success: false, message: "Invalid checkout amount." });
    }

    const payload = {
      amount: amountMinor,
      currency: currency === "USD" ? "USD" : "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        tenant_id: req.user?.tenantId || "",
        user_id: req.user?.id != null ? String(req.user.id) : "",
        package_name: String(req.body?.package_name || ""),
        addon_type: String(req.body?.addon_type || "extra_feature"),
        quantity: String(req.body?.quantity || 1),
      },
    };

    const basic = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const rz = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await rz.json();
    if (!rz.ok) {
      return res.status(400).json({
        success: false,
        message: data?.error?.description || "Failed to create Razorpay order.",
      });
    }

    return res.json({
      success: true,
      gateway: "razorpay",
      order: data,
      key_id: keyId,
      amount: amountMinor,
      currency: payload.currency,
    });
  } catch (err) {
    console.error("createUnifiedCheckout:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { createUnifiedCheckout };

