/**
 * DDL-only mysql2-style helpers over Prisma raw SQL.
 * Used exclusively by ensureSchema / ensureCalendarCrmTables / ensureCrmSchemaCompat.
 * Application request paths must use Prisma Client ORM — not this module.
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

function needsInsertIdTxn(sql) {
  return String(sql || "")
    .trim()
    .toLowerCase()
    .startsWith("insert");
}

async function execute(sql, params = []) {
  if (isReadSql(sql)) {
    return runOnClient(prisma, sql, params);
  }
  if (needsInsertIdTxn(sql)) {
    return prisma.$transaction(async (tx) => runOnClient(tx, sql, params));
  }
  return runOnClient(prisma, sql, params);
}

async function query(sql, params = []) {
  return execute(sql, params);
}

const pool = {
  execute,
  query,
  async getConnection() {
    throw new Error("ddlPool.getConnection is not supported");
  },
};

module.exports = {
  prisma,
  pool,
  execute,
  query,
};
