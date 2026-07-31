const prisma = require("../config/prisma");

const tableExistsCache = new Map();

async function tableExists(tableName) {
  const key = String(tableName || "").toLowerCase();
  if (!key) return false;
  let dbKey = "";
  try {
    const rows = await prisma.$queryRaw`SELECT DATABASE() AS db`;
    dbKey = rows?.[0]?.db != null ? String(rows[0].db).toLowerCase() : "";
  } catch {
    dbKey = "";
  }
  const cacheKey = `${dbKey}::${key}`;
  if (tableExistsCache.has(cacheKey)) return tableExistsCache.get(cacheKey);
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1 AS ok FROM information_schema.tables
      WHERE table_schema = DATABASE() AND LOWER(table_name) = ${key}
      LIMIT 1`;
    const ok = Array.isArray(rows) && rows.length > 0;
    tableExistsCache.set(cacheKey, ok);
    return ok;
  } catch {
    tableExistsCache.set(cacheKey, false);
    return false;
  }
}

module.exports = { tableExists };
