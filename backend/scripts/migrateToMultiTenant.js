/**
 * One-time: ensure platform schema, then backfill `tenant_user_map` from `users.tenant_id`.
 * Run: node backend/scripts/migrateToMultiTenant.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { ensureSchema } = require("../src/config/ensureSchema");
const { backfillFromUsers } = require("../src/services/tenantUserMapService");
const { mainPool } = require("../src/config/database");

async function main() {
  await ensureSchema();
  const n = await backfillFromUsers(mainPool);
  // eslint-disable-next-line no-console
  console.log(`tenant_user_map: upserted ${n} user↔tenant links from users.tenant_id`);
  try {
    await mainPool.end();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
