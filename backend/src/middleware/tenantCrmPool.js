const { runWithCrmPool, getMainPool } = require("../config/database");
const { getTenantDataPoolForTenantId, maybeSyncUsersToTenantCrm } = require("../services/tenantDatabaseService");

/**
 * Binds the CRM data pool (shared main or dedicated tenant MySQL) for the rest of the request.
 * Run after `resolveTenantContext` so `req.user.tenantId` is set (`req.user` from JWT `verifyToken`).
 */
function bindTenantCrmPool(req, res, next) {
  (async () => {
    try {
      const tid = req.user?.tenantId ?? req.user?.tenant_id ?? null;
      const p = await getTenantDataPoolForTenantId(tid);
      req.tenantDb = p;
      if (tid) {
        await maybeSyncUsersToTenantCrm(tid);
      }
      return runWithCrmPool(p || getMainPool(), next);
    } catch (e) {
      next(e);
    }
  })();
}

module.exports = { bindTenantCrmPool };
