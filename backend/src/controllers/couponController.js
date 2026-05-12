const { mainPool } = require("../config/database");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");
const { normalizeCode, validateCouponForCheckout } = require("../services/couponService");

async function validateCoupon(req, res) {
  try {
    const code = req.body?.code ?? req.query?.code;
    const result = await validateCouponForCheckout(code);
    if (!result.ok) {
      return res.json({ success: true, valid: false, message: result.message });
    }
    res.json({
      success: true,
      valid: true,
      code: result.coupon.code,
      discount_percent: result.coupon.discount_percent,
    });
  } catch (err) {
    console.error("validateCoupon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminListCoupons(_req, res) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT id, code, discount_percent, description, max_redemptions, redemptions_used,
              valid_from, valid_until, is_active, created_at, updated_at
       FROM coupons
       ORDER BY created_at DESC`
    );
    res.json({ success: true, coupons: rows });
  } catch (err) {
    console.error("adminListCoupons:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminCreateCoupon(req, res) {
  try {
    const {
      code,
      discount_percent,
      description = null,
      max_redemptions = null,
      valid_from = null,
      valid_until = null,
      is_active = 1,
    } = req.body || {};

    const norm = normalizeCode(code);
    if (!norm || norm.length < 2) {
      return res.status(400).json({ success: false, message: "Code must be at least 2 characters (letters/numbers)." });
    }
    if (norm.length > 40) {
      return res.status(400).json({ success: false, message: "Code must be at most 40 characters." });
    }

    const pct = Math.round(Number(discount_percent));
    if (Number.isNaN(pct) || pct < 10 || pct > 99) {
      return res.status(400).json({
        success: false,
        message: "Discount must be 10–99% (percent off merchandise before GST; Stripe needs a non-zero total).",
      });
    }

    let maxR = null;
    if (max_redemptions !== undefined && max_redemptions !== null && max_redemptions !== "") {
      maxR = Math.max(1, Math.min(99999999, parseInt(String(max_redemptions), 10)));
      if (Number.isNaN(maxR)) maxR = null;
    }

    const [r] = await mainPool.execute(
      `INSERT INTO coupons
        (code, discount_percent, description, max_redemptions, redemptions_used, valid_from, valid_until, is_active)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        norm,
        pct,
        description,
        maxR,
        valid_from || null,
        valid_until || null,
        is_active ? 1 : 0,
      ]
    );

    emitAdminChanged({ scope: "coupons", action: "create", id: r.insertId });
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "A coupon with this code already exists." });
    }
    console.error("adminCreateCoupon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminUpdateCoupon(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });

    const body = req.body || {};
    const fields = [];
    const params = [];

    if (body.code !== undefined) {
      const norm = normalizeCode(body.code);
      if (!norm || norm.length < 2) {
        return res.status(400).json({ success: false, message: "Invalid code." });
      }
      fields.push("code = ?");
      params.push(norm);
    }
    if (body.discount_percent !== undefined) {
      const pct = Math.round(Number(body.discount_percent));
      if (Number.isNaN(pct) || pct < 10 || pct > 99) {
        return res.status(400).json({ success: false, message: "Discount must be 10–99." });
      }
      fields.push("discount_percent = ?");
      params.push(pct);
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      params.push(body.description);
    }
    if (body.max_redemptions !== undefined) {
      if (body.max_redemptions === null || body.max_redemptions === "") {
        fields.push("max_redemptions = NULL");
      } else {
        const maxR = Math.max(1, parseInt(String(body.max_redemptions), 10));
        fields.push("max_redemptions = ?");
        params.push(Number.isNaN(maxR) ? null : maxR);
      }
    }
    if (body.valid_from !== undefined) {
      fields.push("valid_from = ?");
      params.push(body.valid_from || null);
    }
    if (body.valid_until !== undefined) {
      fields.push("valid_until = ?");
      params.push(body.valid_until || null);
    }
    if (body.is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(body.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }

    params.push(id);
    const [result] = await mainPool.execute(`UPDATE coupons SET ${fields.join(", ")} WHERE id = ?`, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Coupon not found." });
    }
    emitAdminChanged({ scope: "coupons", action: "update", id });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Code already in use." });
    }
    console.error("adminUpdateCoupon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminDeleteCoupon(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id." });
    const [r] = await mainPool.execute("DELETE FROM coupons WHERE id = ?", [id]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Coupon not found." });
    }
    emitAdminChanged({ scope: "coupons", action: "delete", id });
    res.json({ success: true });
  } catch (err) {
    console.error("adminDeleteCoupon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  validateCoupon,
  adminListCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
};
