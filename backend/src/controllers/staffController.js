const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { hashPassword } = require("../services/authService");
const { upsertTenantUserMap } = require("../services/tenantUserMapService");

async function createStaffUser(req, res) {
  try {
    const { email, password, first_name, last_name, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const tenantId = req.user?.tenantId || null;
    const isPlatformAdmin = req.user?.is_platform_admin;
    const userEmail = String(email).trim().toLowerCase();
    const assignedRole = role || "staff";
    const passwordHash = await hashPassword(password);

    const [[existing]] = await mainPool.execute(
      "SELECT id, clerk_user_id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [userEmail]
    );
    const clerkUserId =
      existing?.clerk_user_id && !String(existing.clerk_user_id).startsWith("pending:")
        ? String(existing.clerk_user_id)
        : `local:${crypto.randomUUID()}`;

    await mainPool.execute(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, role, tenant_id, is_active, must_change_password, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         role = VALUES(role),
         tenant_id = VALUES(tenant_id),
         is_active = 1,
         must_change_password = 1,
         password_hash = VALUES(password_hash),
         updated_at = NOW()`,
      [clerkUserId, userEmail, first_name || "", last_name || "", assignedRole, isPlatformAdmin ? null : tenantId, passwordHash]
    );

    const [[newUser]] = await mainPool.execute(
      "SELECT id, email, first_name, last_name, role, is_active, tenant_id FROM users WHERE clerk_user_id = ? LIMIT 1",
      [clerkUserId]
    );
    if (newUser?.tenant_id) {
      try {
        await upsertTenantUserMap({
          clerkUserId,
          tenantId: newUser.tenant_id,
          role: newUser.role,
          email: newUser.email,
        });
      } catch (e) {
        console.warn("createStaffUser tenant_user_map:", e.message);
      }
    }

    res.status(201).json({ success: true, data: newUser });
  } catch (err) {
    console.error("createStaffUser error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function clearMustChangePassword(req, res) {
  try {
    await mainPool.execute("UPDATE users SET must_change_password = 0 WHERE id = ?", [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { createStaffUser, clearMustChangePassword };