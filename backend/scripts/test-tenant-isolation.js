/**
 * Verifies main vs tenant pool resolution (requires DB env). Skips if no DB.
 */
require("dotenv").config();
const { getTenantDataPoolForTenantId } = require("../src/services/tenantDatabaseService");
const { getMainPool } = require("../src/config/database");

async function run() {
  if (!process.env.DB_HOST) {
    console.log("test-tenant-isolation: skip (no DB env)");
    process.exit(0);
  }
  const main = getMainPool();
  const t1 = await getTenantDataPoolForTenantId(null);
  const t2 = await getTenantDataPoolForTenantId("00000000-0000-0000-0000-000000000000");
  if (main !== t1 || main !== t2) {
    console.error("expected main pool for null/unknown tenant");
    process.exit(1);
  }
  console.log("test-tenant-isolation: ok (shared main for unknown tenant)");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
