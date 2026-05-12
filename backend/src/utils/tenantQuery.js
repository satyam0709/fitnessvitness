const { getCrmPool, getMainPool } = require("../config/database");
const { getTenantDataPoolForTenantId } = require("../services/tenantDatabaseService");

/**
 * @param {import("express").Request} req
 */
function getCrmPoolFromRequest(_req) {
  return getCrmPool();
}

/**
 * @param {string} tenantId
 * @param {string} [tableAlias]
 * @returns {{ clause: string, param: string }}
 */
function addTenantScope(tenantId, tableAlias = "t") {
  if (!tenantId) {
    throw new Error("addTenantScope: missing tenantId");
  }
  const a = String(tableAlias || "t").trim() || "t";
  return { clause: `${a}.tenant_id = ?`, param: tenantId };
}

module.exports = {
  getCrmPoolFromRequest,
  getMainPool,
  getTenantDataPoolForTenantId,
  addTenantScope,
};
