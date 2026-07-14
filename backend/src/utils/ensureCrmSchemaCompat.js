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

async function ensureColumnDefinition(pool, table, column, definition) {
  if (!(await tableExists(pool, table))) return;
  if (!(await columnExists(pool, table, column))) {
    await addColumn(pool, table, column, definition);
    return;
  }
  try {
    await pool.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
  } catch {
    /* ignore if identical / unsupported */
  }
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
        phone_dial      VARCHAR(10)  DEFAULT NULL,
        email           VARCHAR(150) DEFAULT NULL,
        source          VARCHAR(50)  NOT NULL DEFAULT 'other',
        status          ENUM('new','processing','close_by','confirm','cancel') NOT NULL DEFAULT 'new',
        label           VARCHAR(50)  DEFAULT NULL,
        cancel_reason   VARCHAR(255) DEFAULT NULL,
        assigned_to     INT UNSIGNED DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        follow_up_date  DATE DEFAULT NULL,
        address         TEXT DEFAULT NULL,
        reference       VARCHAR(255) DEFAULT NULL,
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
  }

  await addColumn(pool, "leads", "is_deleted", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(pool, "leads", "deleted_at", "DATETIME DEFAULT NULL");
  await addColumn(pool, "leads", "attachments_json", "JSON DEFAULT NULL");
  await addColumn(pool, "leads", "tenant_id", "INT UNSIGNED DEFAULT NULL");
  await addColumn(pool, "leads", "phone_dial", "VARCHAR(10) DEFAULT NULL");
  await addColumn(pool, "leads", "address", "TEXT DEFAULT NULL");
  await addColumn(pool, "leads", "reference", "VARCHAR(255) DEFAULT NULL");
  await addColumn(pool, "leads", "label", "VARCHAR(50) DEFAULT NULL");
  await addColumn(pool, "leads", "cancel_reason", "VARCHAR(255) DEFAULT NULL");
  await addColumn(pool, "leads", "follow_up_date", "DATE DEFAULT NULL");
  await addColumn(pool, "leads", "company_name", "VARCHAR(150) DEFAULT NULL");

  const refCols = [
    ["first_name", "VARCHAR(100) DEFAULT NULL"],
    ["last_name", "VARCHAR(100) DEFAULT NULL"],
    ["designation", "VARCHAR(120) DEFAULT NULL"],
    ["company_id", "INT UNSIGNED DEFAULT NULL"],
    ["phones_json", "JSON DEFAULT NULL"],
    ["emails_json", "JSON DEFAULT NULL"],
    ["followup_at", "DATETIME DEFAULT NULL"],
    ["followup_type", "VARCHAR(80) DEFAULT NULL"],
    ["comments_history", "TEXT DEFAULT NULL"],
    ["account_relationship", "VARCHAR(32) DEFAULT NULL"],
    ["industry", "VARCHAR(120) DEFAULT NULL"],
    ["department", "VARCHAR(120) DEFAULT NULL"],
    ["product_category", "VARCHAR(80) DEFAULT NULL"],
    ["team", "VARCHAR(160) DEFAULT NULL"],
    ["contact_id", "INT UNSIGNED DEFAULT NULL"],
    ["lead_number", "INT UNSIGNED DEFAULT NULL"],
    ["amount", "DECIMAL(12,2) DEFAULT 0"],
    ["currency", "VARCHAR(8) DEFAULT 'INR'"],
    ["address_line1", "VARCHAR(255) DEFAULT NULL"],
    ["address_line2", "VARCHAR(255) DEFAULT NULL"],
    ["city", "VARCHAR(120) DEFAULT NULL"],
    ["state", "VARCHAR(120) DEFAULT NULL"],
    ["country", "VARCHAR(120) DEFAULT NULL"],
    ["postal_code", "VARCHAR(32) DEFAULT NULL"],
    ["converted_opportunity_id", "INT UNSIGNED DEFAULT NULL"],
    ["last_touched_at", "DATETIME DEFAULT NULL"],
    ["updated_by", "INT UNSIGNED DEFAULT NULL"],
    ["status_v2", "VARCHAR(100) DEFAULT NULL"],
  ];
  for (const [col, def] of refCols) {
    if (col === "status_v2") {
      await ensureColumnDefinition(pool, "leads", col, def);
    } else {
      await addColumn(pool, "leads", col, def);
    }
  }
}

async function ensureLeadFollowupsTable(pool) {
  if (!(await tableExists(pool, "leads"))) return;
  if (!(await tableExists(pool, "lead_followups"))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS lead_followups (
        id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
        lead_id             INT UNSIGNED NOT NULL,
        note                TEXT NOT NULL,
        next_follow_up_date DATE DEFAULT NULL,
        next_follow_up_at   DATETIME DEFAULT NULL,
        attachments_json    JSON DEFAULT NULL,
        created_by          INT UNSIGNED DEFAULT NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_followups_lead (lead_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
  await addColumn(pool, "lead_followups", "next_follow_up_at", "DATETIME DEFAULT NULL");
  await addColumn(pool, "lead_followups", "attachments_json", "JSON DEFAULT NULL");
}

async function ensureLeadChangeLogTable(pool) {
  if (!(await tableExists(pool, "leads"))) return;
  if (!(await tableExists(pool, "lead_change_log"))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS lead_change_log (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        lead_id     INT UNSIGNED NOT NULL,
        field_name  VARCHAR(80) NOT NULL,
        old_value   TEXT DEFAULT NULL,
        new_value   TEXT DEFAULT NULL,
        user_id     INT UNSIGNED DEFAULT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_change_log_lead (lead_id),
        KEY idx_lead_change_log_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("ensureCrmSchemaCompat: created lead_change_log table");
  }
}

async function ensureTenantLeadCountersTable(pool) {
  if (!(await tableExists(pool, "tenant_lead_counters"))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS tenant_lead_counters (
        tenant_id         INT UNSIGNED NOT NULL,
        next_lead_number  INT UNSIGNED NOT NULL DEFAULT 1,
        updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("ensureCrmSchemaCompat: created tenant_lead_counters table");
  }
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

async function ensureDropdownOptionsTable(pool) {
  if (await tableExists(pool, "dropdown_options")) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dropdown_options (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      field_name VARCHAR(50) NOT NULL,
      option_value VARCHAR(100) NOT NULL,
      option_label VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_dropdown_opt (field_name, option_value),
      KEY idx_dropdown_field (field_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("ensureCrmSchemaCompat: created dropdown_options table");
}

async function ensureCrmSchemaCompat(pool) {
  if (compatReady) return;
  await ensureCalendarCrmTables(pool);
  await ensureLeadsTable(pool);
  await ensureLeadFollowupsTable(pool);
  await ensureLeadChangeLogTable(pool);
  await ensureTenantLeadCountersTable(pool);
  await ensureTicketsTable(pool);
  await ensureDropdownOptionsTable(pool);
  await patchCrmColumns(pool);
  compatReady = true;
}

function resetCrmSchemaCompatCache() {
  compatReady = false;
}

module.exports = { ensureCrmSchemaCompat, resetCrmSchemaCompatCache, tableExists, columnExists };
