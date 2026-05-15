const { mainPool } = require("../config/database");

async function getMe(req, res) {
  try {
    if (req.user?.id == null) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    const [rows] = await mainPool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active,
              u.last_login, u.created_at
       FROM users u
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
    const effectiveRole = String(req.user?.role || row.role || "staff").toLowerCase();

    mainPool.query("UPDATE users SET last_login = NOW() WHERE id = ?", [row.id]).catch((err) => {
      console.error("last_login update error:", err.message);
    });
    const nameParts = (row.full_name || "").split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    return res.json({
      success: true,
      data: {
        ...row,
        first_name: firstName,
        last_name: lastName,
        role: effectiveRole,
        is_platform_admin: 0,
        mustChangePassword: false,
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
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active,
              u.last_login, u.created_at
       FROM users u
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
    const effectiveRole = String(req.user?.role || row.role || "staff").toLowerCase();
    const nameParts = (row.full_name || "").split(" ");
    const user = {
      ...row,
      first_name: nameParts[0] || "",
      last_name: nameParts.slice(1).join(" ") || "",
      role: effectiveRole,
      is_platform_admin: 0,
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
      `SELECT id, email, full_name,
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

    const { firstName, lastName, full_name } = req.body;
    let updates = [];
    let params = [];

    // Allow updating full_name directly, or combining firstName + lastName if passed
    let computedFullName = full_name;
    if (!computedFullName && (firstName !== undefined || lastName !== undefined)) {
      computedFullName = `${firstName || ''} ${lastName || ''}`.trim();
    }

    if (computedFullName !== undefined) {
      updates.push("full_name = ?");
      params.push(computedFullName);
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
