const { runWithCrmPool, getMainPool } = require("../config/database");

/**
 * Binds the CRM data pool (shared main or dedicated tenant MySQL) for the rest of the request.
 * Run after `resolveTenantContext` so `req.user.tenantId` is set (`req.user` from JWT `verifyToken`).
 */
function bindTenantCrmPool(req, res, next) {
  (async () => {
    try {
      const pool = getMainPool();
      req.tenantDb = pool;
      return runWithCrmPool(pool, next);
    } catch (e) {
      next(e);
    }
  })();
}

module.exports = { bindTenantCrmPool };
