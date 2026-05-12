/**
 * 365 RND platform operators (not tenant workspace admins).
 * Tenant workspace admins: users.role admin/manager with a non-null tenant_id (see requireTenantAdmin).
 */
function isPlatformSuperAdmin(user) {
  if (!user) return false;
  // Treat explicit platform-admin flag as primary source of truth.
  if (Number(user.is_platform_admin) === 1) return true;
  // Backward compatibility: legacy datasets may encode platform admin in role.
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

function requireTenantAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const tid = req.user.tenant_id ?? req.user.tenantId ?? null;
  if (!tid) {
    return res.status(403).json({ success: false, message: "No workspace found" });
  }
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Workspace admin access required" });
  }
  next();
}

module.exports = { isPlatformSuperAdmin, requirePlatformAdmin, requireTenantAdmin };
