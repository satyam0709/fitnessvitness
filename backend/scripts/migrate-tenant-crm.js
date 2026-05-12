#!/usr/bin/env node
require("dotenv").config();

const { mainPool } = require("../src/config/database");
const { resolveTenantPool } = require("../src/services/tenantDatabaseService");

const CRM_TABLES = [
  "leads",
  "contacts",
  "companies",
  "tasks",
  "reminders",
  "meetings",
  "notes",
  "opportunities",
  "tickets",
  "crm_todos",
  "notifications",
];

function getArg(name, fallback = "") {
  const p = `--${name}=`;
  const hit = process.argv.find((x) => x.startsWith(p));
  return hit ? hit.slice(p.length) : fallback;
}

async function ensureAuditTable() {
  await mainPool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_migration_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id CHAR(36) NOT NULL,
      table_name VARCHAR(128) NOT NULL,
      mode ENUM('backfill','delta','rollback') NOT NULL,
      copied_rows INT UNSIGNED NOT NULL DEFAULT 0,
      note TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenant_migration_audit_tenant (tenant_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function copyTableForTenant(tenantId, tableName, since) {
  const where = since ? "tenant_id = ? AND updated_at >= ?" : "tenant_id = ?";
  const params = since ? [tenantId, since] : [tenantId];
  const [rows] = await mainPool.execute(`SELECT * FROM \`${tableName}\` WHERE ${where}`, params);
  if (!rows.length) return 0;

  const tenantPool = await resolveTenantPool(tenantId);
  const conn = await tenantPool.getConnection();
  try {
    await conn.beginTransaction();
    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(", ");
      const updateClause = cols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
      await conn.query(
        `INSERT INTO \`${tableName}\` (${cols.map((c) => `\`${c}\``).join(", ")})
         VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE ${updateClause}`,
        cols.map((c) => row[c])
      );
    }
    await conn.commit();
    return rows.length;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function rollbackTenant(tenantId) {
  await mainPool.execute(
    "UPDATE tenant_databases SET status = 'suspended', updated_at = NOW() WHERE tenant_id = ?",
    [tenantId]
  );
  await mainPool.execute(
    `INSERT INTO tenant_migration_audit (tenant_id, table_name, mode, copied_rows, note)
     VALUES (?, 'tenant_databases', 'rollback', 0, 'mapping suspended for fallback')`,
    [tenantId]
  );
}

async function run() {
  const tenantId = getArg("tenant-id");
  const mode = getArg("mode", "backfill");
  const since = getArg("since", "");

  if (!tenantId) {
    throw new Error("Missing --tenant-id=<tenant_uuid>");
  }
  if (!["backfill", "delta", "rollback"].includes(mode)) {
    throw new Error("Invalid --mode. Use backfill | delta | rollback");
  }

  await ensureAuditTable();

  if (mode === "rollback") {
    await rollbackTenant(tenantId);
    console.log(`[migration] rollback applied for tenant ${tenantId}`);
    return;
  }

  for (const tableName of CRM_TABLES) {
    const copied = await copyTableForTenant(tenantId, tableName, mode === "delta" ? since : "");
    await mainPool.execute(
      `INSERT INTO tenant_migration_audit (tenant_id, table_name, mode, copied_rows, note)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, tableName, mode, copied, since ? `since=${since}` : null]
    );
    console.log(`[migration] ${mode} ${tableName}: ${copied} rows`);
  }
}

run()
  .then(async () => {
    await mainPool.end().catch(() => {});
  })
  .catch(async (error) => {
    console.error("[migration] failed:", error.message);
    await mainPool.end().catch(() => {});
    process.exit(1);
  });
