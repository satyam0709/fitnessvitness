/**
 * Smokes createTenantDatabase prerequisites (validates slug). Full provisioning needs MySQL CREATE privilege.
 */
const { validateTenantSubdomain } = require("../src/services/tenantDatabaseService");

const good = validateTenantSubdomain("acme-corp");
const bad = validateTenantSubdomain("A");
if (!good.ok || bad.ok) {
  console.error("validateTenantSubdomain failed");
  process.exit(1);
}
console.log("test-db-provisioning: slug validation ok");
process.exit(0);
