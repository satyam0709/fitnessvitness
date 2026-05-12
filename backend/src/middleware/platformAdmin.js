/**
 * 365 RND platform operators (not tenant workspace admins).
 */
function isPlatformSuperAdmin(user) {
  if (!user) return false;
  if (Number(user.is_platform_admin) === 1) return true;
  const role = String(user.role || "").trim().toLowerCase();
  if (role === "super_admin" || role === "platform_admin") return true;
  return false;
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!isPlatformSuperAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Platform admin access required",
    });
  }
  next();
}

module.exports = { isPlatformSuperAdmin, requirePlatformAdmin };