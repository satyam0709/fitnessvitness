/* eslint-disable no-console */
const crypto = require("crypto");
const { mainPool } = require("../src/config/database");
const { createTenantDatabase } = require("../src/services/tenantDatabaseService");

async function run() {
  const suffix = Date.now().toString().slice(-6);
  const tenantId = crypto.randomUUID();
  const slug = `test-tenant-${suffix}`;
  const companyName = `Tenant Provisioning ${suffix}`;
  const subscriptionId = crypto.randomUUID();

  let createdDbName = null;
  try {
    await mainPool.execute(
      `INSERT INTO tenants (id, company_name, status, trial_ends_at, slug)
       VALUES (?, ?, 'trial', DATE_ADD(NOW(), INTERVAL 7 DAY), ?)`,
      [tenantId, companyName, slug]
    );

    const [pkgRows] = await mainPool.execute(
      "SELECT id FROM subscription_packages WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 1"
    );
    if (pkgRows.length) {
      await mainPool.execute(
        `INSERT INTO subscriptions (id, tenant_id, package_id, status, starts_at, ends_at)
         VALUES (?, ?, ?, 'trial', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [subscriptionId, tenantId, pkgRows[0].id]
      );
    }

    const provisioned = await createTenantDatabase(tenantId, slug);
    createdDbName = provisioned.dbName;

    const [tableRows] = await mainPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
      [createdDbName]
    );
    const tables = new Set(tableRows.map((r) => String(r.TABLE_NAME || r.table_name || "").toLowerCase()));
    const mustExist = ["leads", "tasks", "contacts"];
    const mustNotExist = ["tenants", "users", "subscriptions", "subscription_packages", "tenant_databases", "refresh_tokens"];

    for (const t of mustExist) {
      if (!tables.has(t)) {
        throw new Error(`Expected cloned table missing: ${t}`);
      }
    }
    for (const t of mustNotExist) {
      if (tables.has(t)) {
        throw new Error(`Platform table should not be cloned: ${t}`);
      }
    }

    console.log("Tenant provisioning test passed");
    console.log(`tenant_id=${tenantId}`);
    console.log(`slug=${slug}`);
    console.log(`db_name=${createdDbName}`);
  } finally {
    if (createdDbName) {
      await mainPool.query("DROP DATABASE IF EXISTS ??", [createdDbName]);
    }
    await mainPool.execute("DELETE FROM tenant_databases WHERE tenant_id = ?", [tenantId]);
    await mainPool.execute("DELETE FROM subscriptions WHERE tenant_id = ?", [tenantId]);
    await mainPool.execute("DELETE FROM tenants WHERE id = ?", [tenantId]);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("testTenantProvisioning failed:", err.message);
    process.exit(1);
  });
