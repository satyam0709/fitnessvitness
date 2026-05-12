const { mainPool } = require("../config/database");

/**
 * MySQL DATETIME has no timezone. We treat values as **UTC** so hosted APIs (e.g. Render UTC)
 * match what the admin UI saves (converted from the browser to UTC).
 */
function parseDbDateTimeUtc(mysqlVal) {
  if (!mysqlVal) return null;
  const s = String(mysqlVal).trim();
  if (!s) return null;
  if (s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * @returns {Promise<{ ok: boolean, coupon?: object, message?: string }>}
 */
async function validateCouponForCheckout(code) {
  const c = normalizeCode(code);
  if (!c || c.length < 2) {
    return { ok: false, message: "Enter a coupon code." };
  }
  if (c.length > 40) {
    return { ok: false, message: "Invalid coupon code." };
  }

  const [rows] = await mainPool.execute(
    `SELECT id, code, discount_percent, max_redemptions, redemptions_used,
            valid_from, valid_until, is_active
     FROM coupons
     WHERE code = ?
     LIMIT 1`,
    [c]
  );

  if (rows.length === 0) {
    return { ok: false, message: "This coupon code is not valid." };
  }

  const row = rows[0];
  if (!row.is_active) {
    return { ok: false, message: "This coupon is no longer active." };
  }

  const now = new Date();
  if (row.valid_from) {
    const from = parseDbDateTimeUtc(row.valid_from);
    if (from && now < from) {
      return {
        ok: false,
        message: `This coupon is not valid yet — it opens ${from.toISOString().slice(0, 16)} UTC (server clock).`,
      };
    }
  }
  if (row.valid_until) {
    const until = parseDbDateTimeUtc(row.valid_until);
    if (until && now > until) {
      return {
        ok: false,
        message: `This coupon expired at ${until.toISOString().slice(0, 16)} UTC.`,
      };
    }
  }

  if (row.max_redemptions != null && Number(row.redemptions_used) >= Number(row.max_redemptions)) {
    return { ok: false, message: "This coupon has reached its maximum number of uses." };
  }

  const pct = Number(row.discount_percent);
  if (pct < 10 || pct > 99 || Number.isNaN(pct)) {
    return { ok: false, message: "Coupon configuration error." };
  }

  return {
    ok: true,
    coupon: {
      id: row.id,
      code: row.code,
      discount_percent: pct,
    },
  };
}

module.exports = { normalizeCode, validateCouponForCheckout, parseDbDateTimeUtc };
