const prisma = require("../config/prisma");
const {
  fetchUserRowById,
  mapUserRowToProfile,
  clearUserCache,
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

    // Since last_login is not in Prisma schema, we can safely use $executeRaw
    prisma.$executeRaw`UPDATE users SET last_login = NOW() WHERE id = ${row.id}`
      .catch((err) => console.error("last_login update error:", err.message));

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
    
    await prisma.users.update({
      where: { id: uid },
      data: {
        must_change_password: false,
        updated_at: new Date()
      }
    });
    
    clearUserCache(uid);
    return res.json({ success: true });
  } catch (err) {
    console.error("clearMustChangePassword error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function listUsers(req, res) {
  try {
    const users = await prisma.users.findMany({
      orderBy: { created_at: "desc" }
    });
    
    const data = users.map(u => ({
      id: u.id,
      email: u.email,
      full_name: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
      role: u.role,
      is_active: u.is_active,
      last_login: null,
      created_at: u.created_at
    }));

    res.json({ success: true, total: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { firstName, lastName, full_name } = req.body;
    
    const updateData = { updated_at: new Date() };

    let computedFullName = full_name;
    if (!computedFullName && (firstName !== undefined || lastName !== undefined)) {
      computedFullName = `${firstName || ""} ${lastName || ""}`.trim();
    }
    
    // We update first_name and last_name since full_name isn't in schema
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    
    // If full_name is provided but not first/last name, try to split it
    if (computedFullName && firstName === undefined && lastName === undefined) {
      const parts = computedFullName.split(" ");
      updateData.first_name = parts[0] || "";
      updateData.last_name = parts.slice(1).join(" ") || "";
    }

    if (Object.keys(updateData).length > 1) { // more than just updated_at
      await prisma.users.update({
        where: { id: userId },
        data: updateData
      });
      clearUserCache(userId);
    }

    res.json({ success: true, message: "Profile updated successfully." });
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update profile." });
  }
}

module.exports = { getMe, listUsers, syncCurrentUser, clearMustChangePassword, updateProfile };
