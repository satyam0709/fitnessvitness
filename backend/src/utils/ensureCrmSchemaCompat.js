/**
 * Fitness / partial CRM databases: ensure tables + columns expected by list routes exist.
 */
const { ensureCalendarCrmTables } = require("./ensureCalendarCrmTables");

let compatReady = false;

async function tableExists(pool, table) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND LOWER(table_name) = ? LIMIT 1`,
    [String(table).toLowerCase()]
  );
  return rows.length > 0;
}

async function columnExists(pool, table, column) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(pool, table, column, definition) {
  if (!(await tableExists(pool, table))) return;
  if (await columnExists(pool, table, column)) return;
  await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`ensureCrmSchemaCompat: added ${table}.${column}`);
}

async function ensureLeadsTable(pool) {
  if (!(await tableExists(pool, "users"))) return;

  if (!(await tableExists(pool, "leads"))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS leads (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name            VARCHAR(100) NOT NULL,
        company_name    VARCHAR(150) DEFAULT NULL,
        phone           VARCHAR(20)  NOT NULL DEFAULT '',
        email           VARCHAR(150) DEFAULT NULL,
        source          VARCHAR(50)  NOT NULL DEFAULT 'other',
        status          ENUM('new','processing','close_by','confirm','cancel') NOT NULL DEFAULT 'new',
        label           VARCHAR(50)  DEFAULT NULL,
        cancel_reason   VARCHAR(255) DEFAULT NULL,
        assigned_to     INT UNSIGNED DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        follow_up_date  DATE DEFAULT NULL,
        notes           TEXT DEFAULT NULL,
        is_deleted      TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at      DATETIME DEFAULT NULL,
        attachments_json JSON DEFAULT NULL,
        tenant_id       INT UNSIGNED DEFAULT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_status (status),
        KEY idx_follow_up (follow_up_date),
        KEY idx_assigned (assigned_to),
        KEY idx_leads_is_deleted (is_deleted),
        CONSTRAINT fk_lead_creator FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_lead_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("ensureCrmSchemaCompat: created leads table");
    return;
  }

  await addColumn(pool, "leads", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(pool, "leads", "deleted_at", "DATETIME DEFAULT NULL");
  await addColumn(pool, "leads", "attachments_json", "JSON DEFAULT NULL");
  await addColumn(pool, "leads", "tenant_id", "INT UNSIGNED DEFAULT NULL");
}

async function ensureTicketsTable(pool) {
  if (!(await tableExists(pool, "tickets"))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS tickets (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id     INT UNSIGNED DEFAULT NULL,
        subject       VARCHAR(220) NOT NULL,
        description   TEXT DEFAULT NULL,
        priority      ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
        status        ENUM('open','in_progress','resolved','closed','reopened') NOT NULL DEFAULT 'open',
        source        VARCHAR(40) NOT NULL DEFAULT 'crm',
        contact_id    INT UNSIGNED DEFAULT NULL,
        lead_id       INT UNSIGNED DEFAULT NULL,
        assigned_to   INT UNSIGNED DEFAULT NULL,
        created_by    INT UNSIGNED DEFAULT NULL,
        due_at        DATETIME DEFAULT NULL,
        closed_at     DATETIME DEFAULT NULL,
        is_deleted    TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at    DATETIME DEFAULT NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_tickets_status (status),
        KEY idx_tickets_assigned (assigned_to),
        KEY idx_tickets_is_deleted (is_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("ensureCrmSchemaCompat: created tickets table");
    return;
  }

  await addColumn(pool, "tickets", "tenant_id", "INT UNSIGNED DEFAULT NULL");
  await addColumn(pool, "tickets", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(pool, "tickets", "deleted_at", "DATETIME DEFAULT NULL");
}

async function patchCrmColumns(pool) {
  const softDelete = [
    ["tasks", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["tasks", "deleted_at", "DATETIME DEFAULT NULL"],
    ["reminders", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["reminders", "deleted_at", "DATETIME DEFAULT NULL"],
    ["meetings", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["meetings", "deleted_at", "DATETIME DEFAULT NULL"],
    ["crm_todos", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["crm_todos", "deleted_at", "DATETIME DEFAULT NULL"],
  ];
  for (const [table, col, def] of softDelete) {
    await addColumn(pool, table, col, def);
  }

  const tenantCols = [
    ["tasks", "tenant_id", "INT UNSIGNED DEFAULT NULL"],
    ["reminders", "tenant_id", "INT UNSIGNED DEFAULT NULL"],
    ["crm_todos", "tenant_id", "INT UNSIGNED DEFAULT NULL"],
    ["tasks", "label", "VARCHAR(120) DEFAULT NULL"],
    ["tasks", "client_id", "INT UNSIGNED DEFAULT NULL"],
    ["tasks", "task_category", "VARCHAR(50) DEFAULT 'general'"],
    ["tasks", "task_type", "VARCHAR(20) DEFAULT 'client'"],
    ["crm_todos", "client_id", "VARCHAR(20) DEFAULT NULL"],
    ["crm_todos", "todo_category", "VARCHAR(50) DEFAULT NULL"],
  ];
  for (const [table, col, def] of tenantCols) {
    await addColumn(pool, table, col, def);
  }
}

async function ensureCrmSchemaCompat(pool) {
  if (compatReady) return;
  await ensureCalendarCrmTables(pool);
  await ensureLeadsTable(pool);
  await ensureTicketsTable(pool);
  await patchCrmColumns(pool);
  compatReady = true;
}

function resetCrmSchemaCompatCache() {
  compatReady = false;
}

module.exports = { ensureCrmSchemaCompat, resetCrmSchemaCompatCache, tableExists, columnExists };
