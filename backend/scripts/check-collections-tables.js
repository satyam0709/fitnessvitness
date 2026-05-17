require("dotenv").config();
const { ensureSchema } = require("../src/config/ensureSchema");
const { pool } = require("../src/config/database");

(async () => {
  await ensureSchema();
  const [rows] = await pool.query("SHOW TABLES LIKE 'fitness_collection%'");
  console.log(
    rows.map((r) => Object.values(r)[0]).join(", ") || "(none)"
  );
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
