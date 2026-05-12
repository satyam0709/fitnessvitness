require("dotenv").config();
const { pool } = require("../src/config/database");

const EXPECTED = [
  ["users", "idx_email"],
  ["subscription_packages", "uk_subscription_packages_slug"],
  ["subscription_addons", "uk_subscription_addons_slug"],
  ["subscriptions", "idx_subscriptions_tenant"],
  ["subscriptions", "idx_subscriptions_status"],
  ["tenant_addons", "idx_tenant_addons_tenant"],
  ["staff_permissions", "idx_staff_permissions_tenant_user"],
  ["staff_permissions", "uk_staff_permissions_scope"],
  ["leads", "idx_leads_tenant_id"],
  ["tasks", "idx_tasks_tenant_id"],
  ["reminders", "idx_reminders_tenant_id"],
  ["meetings", "idx_meetings_tenant_id"],
  ["notes", "idx_notes_tenant_id"],
  ["customers", "idx_customers_tenant_id"],
  ["invoices", "idx_invoices_tenant_id"],
  ["crm_todos", "idx_crm_todos_tenant_id"],
];

async function main() {
  const [rows] = await pool.execute(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()`
  );
  const present = new Set(rows.map((r) => `${r.TABLE_NAME}:${r.INDEX_NAME}`));

  let missing = 0;
  for (const [table, index] of EXPECTED) {
    const key = `${table}:${index}`;
    if (present.has(key)) {
      console.log(`OK    ${table}.${index}`);
    } else {
      console.log(`MISS  ${table}.${index}`);
      missing += 1;
    }
  }

  if (missing) {
    console.error(`\nMissing ${missing} expected indexes. Run the app once so ensureSchema can migrate them.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll expected indexes are present.");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("DB index audit failed:", err);
  process.exit(1);
});

