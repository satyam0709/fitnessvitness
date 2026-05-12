const { getRbacContext, hasPermission } = require("../services/rbacService");
const { isPlatformSuperAdmin } = require("./platformAdmin");
const { isTenantWorkspaceLead } = require("./tenantWorkspace");
const { authDebug } = require("./authDebug");

/** RBAC reads `req.user` set by JWT `verifyToken` (same shape as legacy Clerk bridge). */

/**
 * Populates req.rbac after resolveTenantContext (needs req.user.tenantId).
 */
async function attachRbacToRequest(req) {
  req.rbac = {
    permissions: new Set(),
    roleSlug: null,
    organizationId: null,
    fromMembership: false,
  };
  if (!req.user) return;
  try {
    const u = {
      ...req.user,
      tenant_id: req.user.tenantId || req.user.tenant_id || null,
      tenantId: req.user.tenantId || req.user.tenant_id || null,
      is_platform_admin: Boolean(req.user.is_platform_admin),
    };
    const ctx = await getRbacContext(u);
    req.rbac = {
      permissions: ctx.permissions,
      roleSlug: ctx.roleSlug,
      organizationId: ctx.organizationId,
      fromMembership: ctx.fromMembership,
    };
  } catch (e) {
    console.error("attachRbacToRequest:", e.message);
  }
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (isPlatformSuperAdmin(req.user)) {
      authDebug("requirePermission:BYPASS", req, { rule: "platform_super_admin", code });
      return next();
    }
    if (isTenantWorkspaceLead(req.user)) {
      authDebug("requirePermission:BYPASS", req, { rule: "tenant_workspace_lead", code });
      return next();
    }
    if (hasPermission(req.rbac, code)) {
      authDebug("requirePermission:OK", req, { code });
      return next();
    }
    authDebug("requirePermission:BLOCK", req, { reason: "missing_rbac_permission", code });
    return res.status(403).json({
      success: false,
      message: `Missing permission: ${code}`,
    });
  };
}

/** Tenant primary admin (org role) or legacy workspace admin/manager for /admin/staff routes */
function requireTenantAdminRbac(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (isPlatformSuperAdmin(req.user)) return next();
  const slug = req.rbac?.roleSlug;
  if (slug === "tenant_admin" || req.user.role === "admin" || req.user.role === "manager") {
    return next();
  }
  return res.status(403).json({ success: false, message: "Tenant admin access required" });
}

module.exports = {
  attachRbacToRequest,
  requirePermission,
  requireTenantAdminRbac,
};
