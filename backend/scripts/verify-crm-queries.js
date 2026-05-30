require("dotenv").config();
const { pool } = require("../src/config/database");

async function run(label, sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    console.log(`OK ${label}: ${rows.length} rows`);
  } catch (e) {
    console.error(`FAIL ${label}:`, e.message);
    process.exitCode = 1;
  }
}

(async () => {
  await run(
    "tasks",
    `SELECT t.* FROM tasks t WHERE t.is_deleted = 0 AND (t.created_by = ? OR t.assigned_to = ?) LIMIT 5`,
    [1, 1]
  );
  await run(
    "reminders",
    `SELECT r.* FROM reminders r WHERE r.is_deleted = 0 AND (r.user_id = ? OR r.assigned_to_user_id = ?) LIMIT 5`,
    [1, 1]
  );
  await run(
    "todos",
    `SELECT t.* FROM crm_todos t
     WHERE t.is_deleted = 0 AND (? IS NULL OR t.tenant_id = ?) LIMIT 5`,
    [null, null]
  );
  await run("leads", `SELECT l.* FROM leads l WHERE l.is_deleted = 0 LIMIT 5`);
  await run(
    "tickets",
    `SELECT t.* FROM tickets t WHERE t.is_deleted = 0 AND (t.tenant_id IS NULL OR t.tenant_id = ?) LIMIT 5`,
    [null]
  );
  await run(
    "meetings",
    `SELECT m.* FROM meetings m WHERE m.is_deleted = 0 LIMIT 5`
  );
  process.exit(process.exitCode || 0);
})();
