/**
 * Lists tenant_databases rows (requires DB).
 */
require("dotenv").config();
const { listAllTenantDatabases } = require("../src/services/tenantDatabaseService");

async function run() {
  if (!process.env.DB_HOST) {
    console.log("tenant-db-audit: skip (no DB env)");
    process.exit(0);
  }
  const rows = await listAllTenantDatabases();
  console.log("tenant_databases count:", rows.length);
  for (const r of rows) {
    console.log("-", r.subdomain, r.db_name, r.status, r.company_name);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
