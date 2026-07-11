require("dotenv").config();
const { pool } = require("../src/config/database");

async function checkTable(tableName) {
  try {
    const [rows] = await pool.execute(`DESCRIBE \`${tableName}\``);
    console.log(`\nTable ${tableName} columns:`);
    console.log(rows.map(r => `${r.Field}: ${r.Type} (Null: ${r.Null})`).join('\n'));
  } catch (e) {
    console.error(`Error describing ${tableName}:`, e.message);
  }
}

async function testQuery(label, sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    console.log(`OK ${label}: queried ${rows.length} rows`);
  } catch (e) {
    console.error(`FAIL ${label} query:`, e.message);
  }
}

(async () => {
  await checkTable("contacts");
  await checkTable("companies");

  // Let's see if querying them like the routes do fails
  await testQuery("contacts GET", "SELECT c.* FROM contacts c WHERE c.tenant_id = ?", [null]);
  await testQuery("companies GET", "SELECT c.* FROM companies c WHERE c.is_deleted = 0 AND c.tenant_id = ?", [null]);

  process.exit(0);
})();
