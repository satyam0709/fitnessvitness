require("dotenv").config();
const { pool } = require("../src/config/database");

(async () => {
  const tables = ["tasks", "reminders", "crm_todos", "tickets", "leads", "meetings"];
  for (const t of tables) {
    const [r] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         AND COLUMN_NAME IN ('is_deleted', 'tenant_id')`,
      [t]
    );
    console.log(t, r.map((x) => x.COLUMN_NAME).join(", ") || "(missing cols)");
  }
  const [[leads]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'leads'`
  );
  console.log("leads table exists:", Number(leads.c) > 0);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
