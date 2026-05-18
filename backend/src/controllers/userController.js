const { mainPool } = require("../config/database");
const {
  fetchUserRowById,
  mapUserRowToProfile,
  getUsersColumns,
  userNameSelectSql,
} = require("../utils/userSchema");

async function getMe(req, res) {
  try {
    if (req.user?.id == null) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    const row = await fetchUserRowById(req.user.id);
    if (!row?.id) {
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

    const cols = await getUsersColumns();
    if (cols.has("last_login")) {
      mainPool
        .query("UPDATE users SET last_login = NOW() WHERE id = ?", [row.id])
        .catch((err) => console.error("last_login update error:", err.message));
    }

    return res.json({
      success: true,
      data: mapUserRowToProfile(row, req.user?.role),
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
    const row = await fetchUserRowById(req.user.id);
    if (!row) {
      return res.json({
        success: true,
        message: "User synced successfully",
        data: null,
      });
    }
    return res.json({
      success: true,
      message: "User synced successfully",
      data: mapUserRowToProfile(row, req.user?.role),
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
    const cols = await getUsersColumns();
    if (cols.has("must_change_password")) {
      await mainPool.query(
        "UPDATE users SET must_change_password = 0, updated_at = NOW() WHERE id = ?",
        [uid]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("clearMustChangePassword error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function listUsers(req, res) {
  try {
    const cols = await getUsersColumns();
    const nameSel = userNameSelectSql(cols);
    const lastLogin = cols.has("last_login") ? "last_login" : "NULL AS last_login";
    const [rows] = await mainPool.query(
      `SELECT id, email, ${nameSel}, role, is_active, ${lastLogin}, created_at
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
    const cols = await getUsersColumns();
    const updates = [];
    const params = [];

    let computedFullName = full_name;
    if (!computedFullName && (firstName !== undefined || lastName !== undefined)) {
      computedFullName = `${firstName || ""} ${lastName || ""}`.trim();
    }

    if (cols.has("full_name") && computedFullName !== undefined) {
      updates.push("full_name = ?");
      params.push(computedFullName);
    } else if (cols.has("first_name")) {
      if (firstName !== undefined) {
        updates.push("first_name = ?");
        params.push(firstName);
      }
      if (lastName !== undefined && cols.has("last_name")) {
        updates.push("last_name = ?");
        params.push(lastName);
      }
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
