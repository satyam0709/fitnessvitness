const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { sendEmailWithRetry } = require("../services/emailService");
const { hashPassword } = require("../services/authService");
const {
  featureKey,
  getTenantContextForUser,
  invalidateSubscriptionCache,
} = require("../services/tenantAccessService");

async function getTenantAdminContext(req) {
  const role = String(req.user?.role || "");
  const rbacSlug = req.rbac?.roleSlug;
  const allowed =
    role === "admin" ||
    role === "manager" ||
    rbacSlug === "tenant_admin" ||
    rbacSlug === "manager";
  if (!allowed) return { ok: false, code: 403, message: "Tenant admin access required." };
  const ctx = await getTenantContextForUser(req.user);
  if (!ctx?.tenantId) return { ok: false, code: 400, message: "Tenant not configured." };
  return { ok: true, ctx };
}

async function listStaff(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const tenantId = gate.ctx.tenantId;

    const [rows] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, role, is_active, tenant_id, last_login, created_at, updated_at
       FROM users
       WHERE tenant_id = ?
       ORDER BY FIELD(role, 'admin','manager','staff'), created_at DESC`,
      [tenantId]
    );
    res.json({ success: true, total: rows.length, data: rows, seats: gate.ctx.seats });
  } catch (err) {
    console.error("listStaff:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createStaff(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const { ctx } = gate;

    const packageUserLimit = Number(ctx.seats?.total) || 0;
    const [[activeUsersRow]] = await mainPool.execute(
      "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND is_active = 1",
      [ctx.tenantId]
    );
    const activeUsers = Number(activeUsersRow?.cnt) || 0;

    if (packageUserLimit > 0 && activeUsers >= packageUserLimit) {
      return res.status(409).json({
        success: false,
        code: "SEAT_LIMIT_REACHED",
        message: `You've used all ${packageUserLimit} users allowed in your package.`,
      });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "staff").trim();
    const password = String(req.body?.password || "").trim();
    if (!email) return res.status(400).json({ success: false, message: "email is required" });
    if (!["staff", "manager"].includes(role)) {
      return res.status(400).json({ success: false, message: "role must be staff or manager" });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ success: false, message: "Temporary password must be at least 8 characters." });
    }

    const [existingRows] = await mainPool.execute(
      "SELECT id, tenant_id, role, is_active, clerk_user_id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!existingRows.length) {
      return res.status(404).json({
        success: false,
        message:
          "User not found in system for this email. Ask the staff member to sign in once first, then assign them.",
      });
    }
    const existing = existingRows[0];
    if (existing.tenant_id && existing.tenant_id !== ctx.tenantId) {
      return res.status(409).json({ success: false, message: "This user already belongs to another tenant." });
    }

    await mainPool.execute(
      `UPDATE users
       SET role = ?, tenant_id = ?, is_active = 1, must_change_password = 1, updated_at = NOW()
       WHERE id = ?`,
      [role, ctx.tenantId, existing.id]
    );
    if (password) {
      const ph = await hashPassword(password);
      await mainPool.execute(`UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`, [
        ph,
        existing.id,
      ]);
    }
    const [[staff]] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, role, is_active, tenant_id, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [existing.id]
    );

    let mailStatus = null;
    if (staff?.email) {
      const [[tenantRow]] = await mainPool.execute(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), company_name) AS workspace_name
         FROM tenants
         WHERE id = ?
         LIMIT 1`,
        [ctx.tenantId]
      );
      const workspaceName = tenantRow?.workspace_name || "your workspace";
      const loginUrl = `${process.env.FRONTEND_URL ? String(process.env.FRONTEND_URL).replace(/\/+$/, "") : ""}/login`;
      const safeLoginUrl = loginUrl.startsWith("http") ? loginUrl : `${req.protocol}://${req.get("host")}/login`;
      mailStatus = await sendEmailWithRetry({
        to: staff.email,
        subject: `You were added to ${workspaceName} on 365 RND CRM`,
        text: `Hi ${staff.first_name || "there"},\n\nYou were added to ${workspaceName} as ${staff.role}.\nLogin: ${safeLoginUrl}\nUse "Forgot password" if needed.\n\n- 365 RND CRM`,
        html: `<p>Hi ${staff.first_name || "there"},</p>
<p>You were added to <strong>${workspaceName}</strong> as <strong>${staff.role}</strong>.</p>
<p>Login: <a href="${safeLoginUrl}">${safeLoginUrl}</a></p>
<p>Use <strong>Forgot password</strong> if needed.</p>
<p>- 365 RND CRM</p>`,
        meta: { type: "tenant_admin_staff_added", tenant_id: ctx.tenantId, user_id: staff.id },
      }).catch((err) => ({ ok: false, reason: err?.message || "send_failed" }));
      if (!mailStatus?.ok) {
        console.warn("createStaff welcome email failed:", {
          to: staff.email,
          reason: mailStatus?.reason || "unknown",
        });
      }
    }

    res.status(201).json({
      success: true,
      data: staff,
      mail: mailStatus || { ok: false, reason: "missing_email" },
    });
  } catch (err) {
    console.error("createStaff:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getStaffPermissions(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const staffId = Number(req.params.id);
    if (!staffId) return res.status(400).json({ success: false, message: "Invalid staff id." });

    const [[staff]] = await mainPool.execute(
      "SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'staff' LIMIT 1",
      [staffId, gate.ctx.tenantId]
    );
    if (!staff) return res.status(404).json({ success: false, message: "Staff user not found." });

    const [rows] = await mainPool.execute(
      `SELECT feature, can_view, can_create, can_edit, can_delete
       FROM staff_permissions
       WHERE tenant_id = ? AND user_id = ?
       ORDER BY feature ASC`,
      [gate.ctx.tenantId, staffId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getStaffPermissions:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function upsertStaffPermissions(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const staffId = Number(req.params.id);
    if (!staffId) return res.status(400).json({ success: false, message: "Invalid staff id." });
    const rows = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "permissions array is required." });

    const [[staff]] = await mainPool.execute(
      "SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'staff' LIMIT 1",
      [staffId, gate.ctx.tenantId]
    );
    if (!staff) return res.status(404).json({ success: false, message: "Staff user not found." });

    for (const p of rows) {
      const feature = featureKey(p?.feature);
      if (!feature) continue;
      const id = crypto.randomUUID();
      await mainPool.execute(
        `INSERT INTO staff_permissions
          (id, tenant_id, user_id, feature, can_view, can_create, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          can_view = VALUES(can_view),
          can_create = VALUES(can_create),
          can_edit = VALUES(can_edit),
          can_delete = VALUES(can_delete),
          updated_at = NOW()`,
        [
          id,
          gate.ctx.tenantId,
          staffId,
          feature,
          p?.can_view ? 1 : 0,
          p?.can_create ? 1 : 0,
          p?.can_edit ? 1 : 0,
          p?.can_delete ? 1 : 0,
        ]
      );
    }

    const [updated] = await mainPool.execute(
      `SELECT feature, can_view, can_create, can_edit, can_delete
       FROM staff_permissions
       WHERE tenant_id = ? AND user_id = ?
       ORDER BY feature ASC`,
      [gate.ctx.tenantId, staffId]
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("upsertStaffPermissions:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listStaff,
  createStaff,
  getStaffPermissions,
  upsertStaffPermissions,
  getTenantSubscription,
  getTenantUsage,
  purchaseAddon,
};

async function getTenantSubscription(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const { ctx } = gate;
    const sub = ctx.subscription;

    res.json({
      success: true,
      data: {
        tenant_id: ctx.tenantId,
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              starts_at: sub.starts_at,
              ends_at: sub.ends_at,
              package_id: sub.package_id,
              package_slug: sub.package_slug,
              package_name: sub.package_name,
            }
          : null,
        seats: ctx.seats,
        features: ctx.features,
      },
    });
  } catch (err) {
    console.error("getTenantSubscription:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTenantUsage(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const tenantId = gate.ctx.tenantId;

    const [[staffCount]] = await mainPool.execute(
      "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND role IN ('manager','staff') AND is_active = 1",
      [tenantId]
    );
    const [[leadsCount]] = await mainPool.execute("SELECT COUNT(*) AS cnt FROM leads WHERE tenant_id = ?", [
      tenantId,
    ]);
    const [[tasksCount]] = await mainPool.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE tenant_id = ?", [
      tenantId,
    ]);

    res.json({
      success: true,
      data: {
        seats: {
          ...gate.ctx.seats,
          used: Number(staffCount.cnt) || 0,
          addons: 0,
        },
        records: {
          leads: Number(leadsCount.cnt) || 0,
          tasks: Number(tasksCount.cnt) || 0,
        },
      },
    });
  } catch (err) {
    console.error("getTenantUsage:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function purchaseAddon(req, res) {
  try {
    const gate = await getTenantAdminContext(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const tenantId = gate.ctx.tenantId;

    const addonSlug = String(req.body?.addon_slug || req.body?.addon || "").trim().toLowerCase();
    if (!addonSlug) {
      return res.status(400).json({ success: false, message: "addon_slug is required." });
    }
    if (addonSlug === "staff" || addonSlug === "users" || addonSlug === "extra-staff-seat") {
      return res.status(403).json({
        success: false,
        message: "User seat add-on is no longer available.",
      });
    }
    const quantity = Math.max(1, Math.min(9999, Number(req.body?.quantity) || 1));
    const currency = String(req.body?.currency || "INR").toUpperCase() === "USD" ? "USD" : "INR";
    const gateway = String(req.body?.payment_gateway || "manual").trim().toLowerCase();
    const paymentStatus = String(req.body?.payment_status || "success").toLowerCase();
    if (paymentStatus !== "success") {
      return res.status(400).json({ success: false, message: "Payment not completed for add-on purchase." });
    }

    const [addons] = await mainPool.execute(
      `SELECT slug, price_inr, price_usd
       FROM subscription_addons
       WHERE is_active = 1 AND slug = ?
       LIMIT 1`,
      [addonSlug]
    );
    if (!addons.length) {
      return res.status(404).json({ success: false, message: "Add-on definition not found." });
    }
    const addon = addons[0];
    const perUnit = currency === "USD" ? Number(addon.price_usd) || 0 : Number(addon.price_inr) || 0;
    const total = perUnit * quantity;

    let addonType = "extra_feature";
    if (addonSlug === "staff") addonType = "extra_staff_seat";
    else if (addonSlug.includes("storage")) addonType = "extra_storage";

    const id = crypto.randomUUID();
    const activeUntil = req.body?.active_until
      ? new Date(req.body.active_until)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await mainPool.execute(
      `INSERT INTO tenant_addons (id, tenant_id, addon_type, quantity, price_paid, active_until)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        addonType,
        quantity,
        Number(total.toFixed(2)),
        Number.isNaN(activeUntil.getTime())
          ? null
          : activeUntil.toISOString().slice(0, 19).replace("T", " "),
      ]
    );

    invalidateSubscriptionCache(tenantId);
    const refreshed = await getTenantContextForUser(req.user);
    res.status(201).json({
      success: true,
      data: {
        id,
        tenant_id: tenantId,
        addon_type: addonType,
        quantity,
        currency,
        payment_gateway: gateway,
        amount_paid: Number(total.toFixed(2)),
        seats: refreshed.seats,
      },
      message: "Add-on purchased successfully. Seats/features unlocked immediately.",
    });
  } catch (err) {
    console.error("purchaseAddon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

