export const GST_RATE = 0.18;

export const SYMBOL = { INR: "₹", USD: "$" };

/**
 * @param {{ plan?: { priceRaw?: number } | null, addons?: Array<{ priceRaw?: number }>, currency?: string }} cart
 */
export function computeCartTotals(cart) {
  const currency = cart?.currency || "INR";
  const sym = SYMBOL[currency] || "₹";
  const planPrice = Number(cart?.plan?.priceRaw) || 0;
  const addonsTotal = (cart?.addons || []).reduce(
    (sum, a) => sum + Number(a.priceRaw || 0),
    0
  );
  const merchandiseSubtotal = planPrice + addonsTotal;
  const pct = Number(cart?.coupon?.discount_percent);
  const hasCoupon =
    Boolean(cart?.coupon?.code) && !Number.isNaN(pct) && pct >= 10 && pct <= 99;
  const factor = hasCoupon ? (100 - pct) / 100 : 1;
  const subtotal = +(merchandiseSubtotal * factor).toFixed(2);
  const gst = +(subtotal * GST_RATE).toFixed(2);
  const total = +(subtotal + gst).toFixed(2);
  const discountAmount = hasCoupon
    ? +(merchandiseSubtotal - subtotal).toFixed(2)
    : 0;
  return {
    currency,
    sym,
    planPrice,
    addonsTotal,
    merchandiseSubtotal,
    subtotal,
    gst,
    total,
    couponPercent: hasCoupon ? pct : null,
    discountAmount,
  };
}
