require("dotenv").config();
const { pool } = require("../src/config/database");

async function main() {
  const params = [2, 2];
  const sql = `SELECT c.*,
            fc.full_name AS client_name,
            eb.full_name AS external_buyer_name,
            TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS assignee_name
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE 1=1 AND (c.assigned_to = ? OR c.created_by = ?) AND c.status IN ('open','partial')
     ORDER BY c.updated_at DESC
     LIMIT 100 OFFSET 0`;
  const [rows] = await pool.execute(sql, [2, 2]);
  console.log("list ok", rows.length);

  const today = new Date().toISOString().slice(0, 10);
  const [sum] = await pool.execute(
    `SELECT
       SUM(CASE WHEN c.status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count
     FROM fitness_collections c
     WHERE 1=1 AND (c.assigned_to = ? OR c.created_by = ?)`,
    [2, 2]
  );
  console.log("summary ok", sum[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
