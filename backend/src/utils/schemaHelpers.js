const { pool } = require("../config/database");

const tableExistsCache = new Map();

async function tableExists(tableName) {
  const key = String(tableName || "").toLowerCase();
  if (!key) return false;
  let dbKey = "";
  try {
    const [[row]] = await pool.execute("SELECT DATABASE() AS db");
    dbKey = row && row.db != null ? String(row.db).toLowerCase() : "";
  } catch {
    dbKey = "";
  }
  const cacheKey = `${dbKey}::${key}`;
  if (tableExistsCache.has(cacheKey)) return tableExistsCache.get(cacheKey);
  try {
    const [rows] = await pool.execute(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND LOWER(table_name) = ?
       LIMIT 1`,
      [key]
    );
    const ok = rows.length > 0;
    tableExistsCache.set(cacheKey, ok);
    return ok;
  } catch {
    tableExistsCache.set(cacheKey, false);
    return false;
  }
}

module.exports = { tableExists };
