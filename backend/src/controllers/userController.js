const { mainPool } = require("../config/database");

async function getMe(req, res) {
  try {
    if (req.user?.id == null) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    const [rows] = await mainPool.query(
      `SELECT u.id, u.clerk_user_id, u.email, u.first_name, u.last_name, u.profile_image, u.role, u.is_active,
              u.last_login, u.created_at, u.tenant_id,
              u.invited_by,
              COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
              COALESCE(u.must_change_password, 0) AS must_change_password,
              CASE
                WHEN te.owner_user_id IS NOT NULL AND te.owner_user_id = u.id THEN 1
                ELSE 0
              END AS is_workspace_owner,
              COALESCE(NULLIF(TRIM(te.name), ''), te.company_name) AS tenant_name
       FROM users u
       LEFT JOIN tenants te ON te.id = u.tenant_id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    const row = rows[0];
    if (!row || !row.id) {
      return res.status(404).json({
        success: false,
        message: "User not found in database.",
      });
    }
    if (!row.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Contact support.",
      });
    }
    const effectiveTenantId = req.user?.tenantId ?? req.user?.tenant_id ?? row.tenant_id ?? null;
    const effectiveRole = String(req.user?.role || row.role || "staff").toLowerCase();

    let effectiveTenantName = row.tenant_name || null;
    if (effectiveTenantId && String(effectiveTenantId) !== String(row.tenant_id || "")) {
      const [[t]] = await mainPool.execute(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), company_name) AS tenant_name
         FROM tenants WHERE id = ? LIMIT 1`,
        [effectiveTenantId]
      );
      effectiveTenantName = t?.tenant_name || effectiveTenantName;
    }

    mainPool.query("UPDATE users SET last_login = NOW() WHERE id = ?", [row.id]).catch((err) => {
      console.error("last_login update error:", err.message);
    });
    return res.json({
      success: true,
      data: {
        ...row,
        role: effectiveRole,
        tenant_id: effectiveTenantId,
        tenant_name: effectiveTenantName,
        is_platform_admin:
          req.user?.is_platform_admin != null
            ? Number(req.user.is_platform_admin)
            : Number(row.is_platform_admin),
        invited_by: row.invited_by ?? null,
        is_workspace_owner: Number(row.is_workspace_owner) === 1,
        mustChangePassword: Number(row?.must_change_password) === 1,
      },
    });
  } catch (err) {
    console.error("getMe error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function syncCurrentUser(req, res) {
  try {
    if (req.user?.id == null) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    const [rows] = await mainPool.execute(
      `SELECT u.id, u.clerk_user_id, u.email, u.first_name, u.last_name, u.profile_image, u.role, u.is_active,
              u.last_login, u.created_at, u.tenant_id,
              COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
              COALESCE(u.must_change_password, 0) AS must_change_password,
              COALESCE(NULLIF(TRIM(te.name), ''), te.company_name) AS tenant_name
       FROM users u
       LEFT JOIN tenants te ON te.id = u.tenant_id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.json({
        success: true,
        message: "User synced successfully",
        data: null,
      });
    }
    const effectiveTenantId = req.user?.tenantId ?? req.user?.tenant_id ?? row.tenant_id ?? null;
    const effectiveRole = String(req.user?.role || row.role || "staff").toLowerCase();
    const user = {
      ...row,
      role: effectiveRole,
      tenant_id: effectiveTenantId,
      is_platform_admin:
        req.user?.is_platform_admin != null
          ? Number(req.user.is_platform_admin)
          : Number(row.is_platform_admin),
    };
    return res.json({
      success: true,
      message: "User synced successfully",
      data: user,
    });
  } catch (err) {
    console.error("syncCurrentUser error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function clearMustChangePassword(req, res) {
  try {
    const uid = req.user?.id;
    if (uid == null) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    await mainPool.query("UPDATE users SET must_change_password = 0, updated_at = NOW() WHERE id = ?", [uid]);
    return res.json({ success: true });
  } catch (err) {
    console.error("clearMustChangePassword error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function listUsers(req, res) {
  try {
    const [rows] = await mainPool.query(
      `SELECT id, clerk_user_id, email, first_name, last_name,
              role, is_active, last_login, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { firstName, lastName, profileImage } = req.body;
    let updates = [];
    let params = [];

    if (firstName !== undefined) {
      updates.push("first_name = ?");
      params.push(firstName);
    }
    if (lastName !== undefined) {
      updates.push("last_name = ?");
      params.push(lastName);
    }
    if (profileImage !== undefined) {
      updates.push("profile_image = ?");
      params.push(profileImage);
    }

    if (updates.length > 0) {
      params.push(userId);
      await mainPool.execute(
        `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
        params
      );
    }

    res.json({ success: true, message: "Profile updated successfully." });
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update profile." });
  }
}

module.exports = { getMe, listUsers, syncCurrentUser, clearMustChangePassword, updateProfile };
