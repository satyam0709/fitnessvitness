/**
 * Drop-in mysql2-style helpers backed by Prisma raw SQL.
 * Lets large controllers (dashboard/calendar/today) leave pool without a full rewrite.
 *
 * execute/query return [rows] like mysql2/promise.
 * INSERT returns [{ insertId, affectedRows }] like mysql2 ResultSetHeader.
 */
const prisma = require("./prisma");

function isReadSql(sql) {
  const s = String(sql || "")
    .trim()
    .replace(/^\/\*[\s\S]*?\*\//, "")
    .trim()
    .toLowerCase();
  return (
    s.startsWith("select") ||
    s.startsWith("with") ||
    s.startsWith("show") ||
    s.startsWith("describe") ||
    s.startsWith("desc ") ||
    s.startsWith("explain")
  );
}

async function runOnClient(client, sql, params = []) {
  const args = Array.isArray(params) ? params : [];
  if (isReadSql(sql)) {
    const rows = await client.$queryRawUnsafe(sql, ...args);
    return [Array.isArray(rows) ? rows : []];
  }

  const affected = await client.$executeRawUnsafe(sql, ...args);
  let insertId = 0;
  const head = String(sql || "")
    .trim()
    .toLowerCase();
  if (head.startsWith("insert")) {
    const idRows = await client.$queryRawUnsafe("SELECT LAST_INSERT_ID() AS id");
    insertId = Number(idRows?.[0]?.id || 0);
  }
  return [
    {
      affectedRows: Number(affected) || 0,
      insertId,
    },
  ];
}

async function execute(sql, params = []) {
  if (isReadSql(sql)) {
    return runOnClient(prisma, sql, params);
  }
  return prisma.$transaction(async (tx) => runOnClient(tx, sql, params));
}

async function query(sql, params = []) {
  return execute(sql, params);
}

const pool = {
  execute,
  query,
  /** Prefer prisma.$transaction in new code; kept for legacy call sites. */
  async getConnection() {
    throw new Error(
      "prismaPool.getConnection is not supported — use pool.execute/query or prisma.$transaction"
    );
  },
};

module.exports = {
  prisma,
  pool,
  execute,
  query,
};
