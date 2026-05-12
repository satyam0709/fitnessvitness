const { runWithCrmPool } = require("../config/database");
const { resolveTenantPool } = require("../services/tenantDatabaseService");

async function tenantDbMiddleware(req, _res, next) {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return next();
    const pool = await resolveTenantPool(tenantId);
    return runWithCrmPool(pool, () => next());
  } catch (error) {
    console.error("tenantDbMiddleware:", error.message);
    return next();
  }
}

module.exports = { tenantDbMiddleware };
