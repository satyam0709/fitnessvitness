require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ensureSchema } = require("../src/config/ensureSchema");
const { pool } = require("../src/config/database");

async function main() {
  await ensureSchema();
  const [rows] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'invoices'`
  );
  if (rows.length) {
    console.log("OK: invoices table exists in", process.env.DB_NAME || "database");
    process.exit(0);
  }
  console.error("FAIL: invoices table still missing after ensureSchema");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
