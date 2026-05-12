const { authDebug } = require("./authDebug");
const { mainPool } = require("../config/database");
const { isPlatformSuperAdmin } = require("./platformAdmin");

/**
 * CRM data routes must never run without a tenant scope (prevents cross-tenant reads when tenant_id is null).
 */
async function requireCrmTenant(req, res, next) {
  if (isPlatformSuperAdmin(req.user)) {
    authDebug("requireCrmTenant:BYPASS", req, { rule: "platform_super_admin" });
    return next();
  }
  const tid = req.user?.tenantId ?? req.user?.tenant_id ?? null;
  if (!tid) {
    authDebug("requireCrmTenant:BLOCK", req, {
      reason: "missing_tenant_id",
      message: "No tenant workspace assigned. Sign in with a company user or contact 365 RND support.",
    });
    return res.status(403).json({
      success: false,
      message: "No tenant workspace assigned. Sign in with a company user or contact 365 RND support.",
    });
  }
  try {
    const [[tenantRow]] = await mainPool.execute(
      "SELECT subdomain_status FROM tenants WHERE id = ? LIMIT 1",
      [tid]
    );
    const [[tenantDbRow]] = await mainPool.execute(
      "SELECT status FROM tenant_databases WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1",
      [tid]
    );
    const tenantStatus = String(tenantRow?.subdomain_status || "").toLowerCase();
    const dbStatus = String(tenantDbRow?.status || "").toLowerCase();
    const tenantReady = !tenantStatus || tenantStatus === "active";
    const dbReady = !dbStatus || dbStatus === "active";

    if (!tenantReady || !dbReady) {
      return res.status(423).json({
        success: false,
        code: "WORKSPACE_PENDING_VERIFICATION",
        message:
          "Workspace setup is pending super-admin verification. You will receive email once it is ready.",
        data: {
          tenant_status: tenantStatus || null,
          database_status: dbStatus || null,
          workspace_access_ready: false,
        },
      });
    }
  } catch (err) {
    authDebug("requireCrmTenant:WARN", req, {
      reason: "workspace_verification_lookup_failed",
      message: err.message,
    });
  }
  authDebug("requireCrmTenant:OK", req, { tenant_id: tid });
  next();
}

module.exports = { requireCrmTenant };
