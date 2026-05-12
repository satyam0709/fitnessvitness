const { createTenantDatabase, validateTenantSubdomain } = require("./tenantDatabaseService");

/**
 * Provisions a dedicated MySQL database for an existing `tenants` row and registers `tenant_databases`.
 * @param {string} tenantId
 * @param {string} companySlug
 * @param {object} [opt]
 * @returns {Promise<object>}
 */
async function provisionTenantDatabase(tenantId, companySlug, opt) {
  return createTenantDatabase(tenantId, companySlug, opt);
}

module.exports = { provisionTenantDatabase, createTenantDatabase, validateTenantSubdomain };
