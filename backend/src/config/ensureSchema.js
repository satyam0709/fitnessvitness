const { mainPool: pool } = require("./database");
const { INTEGRATIONS } = require("./integrationsCatalog");

let schemaEnsured = false;
const CURRENT_SCHEMA_VERSION = 9;

async function ensureSchema() {
  if (schemaEnsured) return;
  // FIXED: 5 schema version gate to skip expensive startup checks
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value VARCHAR(64)
    )
  `);
  const [schemaRows] = await pool.execute(
    "SELECT value FROM _schema_meta WHERE `key` = 'version' LIMIT 1"
  );
  if (schemaRows[0]?.value == String(CURRENT_SCHEMA_VERSION)) {
    schemaEnsured = true;
    return;
  }

  // ── integrations ──────────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS integrations (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`key\`    VARCHAR(100) NOT NULL UNIQUE,
      name       VARCHAR(200) NOT NULL,
      is_active  TINYINT(1)   NOT NULL DEFAULT 0,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS integration_webhooks (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_key    VARCHAR(100) NOT NULL,
      status        ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
      payload_json  JSON         DEFAULT NULL,
      headers_json  JSON         DEFAULT NULL,
      lead_id       INT UNSIGNED DEFAULT NULL,
      error_message TEXT         DEFAULT NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_source_key (source_key),
      KEY idx_status (status),
      KEY idx_lead_id (lead_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS payment_sessions (
      id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id               VARCHAR(100)  NOT NULL,
      stripe_session_id     VARCHAR(200)  NOT NULL UNIQUE,
      stripe_payment_intent VARCHAR(200)  DEFAULT NULL,
      package_name          VARCHAR(100)  DEFAULT NULL,
      currency              VARCHAR(10)   DEFAULT 'INR',
      total_amount          DECIMAL(10,2) DEFAULT 0,
      status                ENUM('pending','completed','expired','failed') NOT NULL DEFAULT 'pending',
      created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_payment_sessions_user (user_id),
      KEY idx_stripe_session (stripe_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id       VARCHAR(255)  NOT NULL,
      package_name  VARCHAR(100)  DEFAULT NULL,
      package_price DECIMAL(10,2) DEFAULT 0,
      currency      VARCHAR(10)   DEFAULT 'INR',
      addons        JSON          DEFAULT NULL,
      subtotal      DECIMAL(10,2) DEFAULT 0,
      gst           DECIMAL(10,2) DEFAULT 0,
      total         DECIMAL(10,2) DEFAULT 0,
      status        VARCHAR(50)   DEFAULT 'trial',
      created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_id (user_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── customers table (needed for lead convert) ─────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS customers (
      id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      name         VARCHAR(200)  NOT NULL,
      email        VARCHAR(200)  DEFAULT NULL,
      phone        VARCHAR(50)   DEFAULT NULL,
      company      VARCHAR(200)  DEFAULT NULL,
      city         VARCHAR(100)  DEFAULT NULL,
      country      VARCHAR(100)  DEFAULT 'India',
      lead_id      INT UNSIGNED  DEFAULT NULL UNIQUE,
      created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_lead_id (lead_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── users table ───────────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      email             VARCHAR(180) NOT NULL,
      password_hash     VARCHAR(255) DEFAULT NULL,
      first_name        VARCHAR(100) DEFAULT NULL,
      last_name         VARCHAR(100) DEFAULT NULL,
      role              ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
      is_active         TINYINT(1)   NOT NULL DEFAULT 1,
      email_verified    TINYINT(1)   NOT NULL DEFAULT 0,
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      mobile_number     VARCHAR(20)  DEFAULT NULL,
      profile_image     VARCHAR(255) DEFAULT NULL,
      password_reset_token VARCHAR(255) DEFAULT NULL,
      password_reset_expires DATETIME   DEFAULT NULL,
      created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── contacts table ───────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_name         VARCHAR(180) NOT NULL,
      contact_name         VARCHAR(150) NOT NULL,
      designation          VARCHAR(120) DEFAULT NULL,
      account_relationship VARCHAR(80)  DEFAULT NULL,
      department           VARCHAR(120) DEFAULT NULL,
      email                VARCHAR(180) DEFAULT NULL,
      phone                VARCHAR(30)  DEFAULT NULL,
      street               VARCHAR(255) DEFAULT NULL,
      city                 VARCHAR(120) DEFAULT NULL,
      state                VARCHAR(120) DEFAULT NULL,
      country              VARCHAR(120) DEFAULT NULL,
      postal_code          VARCHAR(20)  DEFAULT NULL,
      website              VARCHAR(255) DEFAULT NULL,
      notes                TEXT         DEFAULT NULL,
      assigned_to          INT UNSIGNED DEFAULT NULL,
      created_by           INT UNSIGNED DEFAULT NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_contacts_company (company_name),
      KEY idx_contacts_designation (designation),
      KEY idx_contacts_relationship (account_relationship),
      KEY idx_contacts_department (department),
      KEY idx_contacts_assigned (assigned_to),
      KEY idx_contacts_created_by (created_by),
      CONSTRAINT fk_contacts_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_contacts_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [contactTbl] = await pool.execute("SHOW TABLES LIKE 'contacts'");
  if (contactTbl.length > 0) {
    const contactExtra = [
      { column: "company_id", definition: "INT UNSIGNED DEFAULT NULL" },
    ];
    for (const { column, definition } of contactExtra) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE contacts ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added contacts.${column}`);
      }
    }
  }

  // ── companies table ────────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS companies (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      account_name         VARCHAR(180) NOT NULL,
      account_relationship VARCHAR(80)  DEFAULT 'Customer',
      phone                VARCHAR(30)  DEFAULT NULL,
      email                VARCHAR(180) DEFAULT NULL,
      industry             VARCHAR(120) DEFAULT NULL,
      street               VARCHAR(255) DEFAULT NULL,
      city                 VARCHAR(120) DEFAULT NULL,
      state                VARCHAR(120) DEFAULT NULL,
      country              VARCHAR(120) DEFAULT NULL,
      postal_code          VARCHAR(20)  DEFAULT NULL,
      website              VARCHAR(255) DEFAULT NULL,
      notes                TEXT         DEFAULT NULL,
      assigned_to          INT UNSIGNED DEFAULT NULL,
      created_by           INT UNSIGNED DEFAULT NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_companies_name (account_name),
      KEY idx_companies_rel (account_relationship),
      KEY idx_companies_city (city),
      KEY idx_companies_state (state),
      KEY idx_companies_assigned (assigned_to),
      KEY idx_companies_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [fkCoAfter] = await pool.execute(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND CONSTRAINT_NAME = 'fk_contacts_company'`
  );
  if (!fkCoAfter.length) {
    try {
      await pool.execute(`
        ALTER TABLE contacts
        ADD CONSTRAINT fk_contacts_company
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      `);
      console.log("Migration: added contacts.fk_contacts_company");
    } catch (_) {
      /* column or referenced type mismatch on legacy DBs */
    }
  }

  // ── opportunities table ─────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title               VARCHAR(220) NOT NULL,
      lead_id             INT UNSIGNED DEFAULT NULL,
      contact_id          INT UNSIGNED DEFAULT NULL,
      company_name        VARCHAR(180) DEFAULT NULL,
      amount              DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency            VARCHAR(10) NOT NULL DEFAULT 'INR',
      stage               ENUM(
        'open','proposal','negotiation',
        'qualification_done','quotation_given','negotiation_review','on_hold',
        'closed_won','closed_lost'
      ) NOT NULL DEFAULT 'qualification_done',
      expected_close_date DATE DEFAULT NULL,
      owner_user_id       INT UNSIGNED DEFAULT NULL,
      created_by          INT UNSIGNED DEFAULT NULL,
      notes               TEXT DEFAULT NULL,
      product_category    VARCHAR(80) DEFAULT NULL,
      quantity            INT UNSIGNED NOT NULL DEFAULT 0,
      external_quotation_url VARCHAR(500) DEFAULT NULL,
      followup_at         DATETIME DEFAULT NULL,
      followup_type       VARCHAR(80) DEFAULT NULL,
      opportunity_type    VARCHAR(80) DEFAULT NULL,
      lead_source         VARCHAR(80) DEFAULT NULL,
      team                VARCHAR(160) DEFAULT NULL,
      comments_history    TEXT DEFAULT NULL,
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_opps_stage (stage),
      KEY idx_opps_owner (owner_user_id),
      KEY idx_opps_created_by (created_by),
      KEY idx_opps_lead (lead_id),
      KEY idx_opps_contact (contact_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const opportunityExtraColumns = [
    { column: "product_category", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "quantity", definition: "INT UNSIGNED NOT NULL DEFAULT 0" },
    { column: "external_quotation_url", definition: "VARCHAR(500) DEFAULT NULL" },
    { column: "followup_at", definition: "DATETIME DEFAULT NULL" },
    { column: "followup_type", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "opportunity_type", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "lead_source", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "team", definition: "VARCHAR(160) DEFAULT NULL" },
    { column: "comments_history", definition: "TEXT DEFAULT NULL" },
    { column: "consultation_at", definition: "DATETIME DEFAULT NULL" },
    { column: "consultation_notes", definition: "TEXT DEFAULT NULL" },
    { column: "closed_won_at", definition: "DATETIME DEFAULT NULL" },
    { column: "final_amount", definition: "DECIMAL(12,2) DEFAULT NULL" },
    { column: "closed_lost_at", definition: "DATETIME DEFAULT NULL" },
    { column: "loss_reason", definition: "VARCHAR(255) DEFAULT NULL" },
  ];
  for (const { column, definition } of opportunityExtraColumns) {
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opportunities' AND COLUMN_NAME = ?`,
      [column]
    );
    if (cols.length === 0) {
      await pool.execute(`ALTER TABLE opportunities ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration: added opportunities.${column}`);
    }
  }
  try {
    await pool.execute(
      `ALTER TABLE opportunities MODIFY COLUMN stage ENUM(
        'open','proposal','negotiation',
        'qualification_done','consultation_done','quotation_given','negotiation_review','on_hold',
        'closed_won','closed_lost'
      ) NOT NULL DEFAULT 'qualification_done'`
    );
  } catch (e) {
    console.warn("Migration: could not extend opportunities.stage enum:", e.message);
  }

  // Intake / service detail (column still named product_category for API compatibility)
  try {
    const [pcRows] = await pool.execute(
      `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opportunities' AND COLUMN_NAME = 'product_category'`
    );
    const pc = pcRows[0];
    if (pc && String(pc.DATA_TYPE).toLowerCase() === "enum") {
      await pool.execute(
        `ALTER TABLE opportunities MODIFY COLUMN product_category VARCHAR(80) DEFAULT NULL`
      );
      await pool.execute(`
        UPDATE opportunities SET product_category = CASE LOWER(TRIM(product_category))
          WHEN 'hardware' THEN 'general_inquiry'
          WHEN 'software' THEN 'general_inquiry'
          WHEN 'services' THEN 'membership_or_program'
          ELSE LOWER(REPLACE(TRIM(product_category), ' ', '_'))
        END
        WHERE product_category IS NOT NULL AND TRIM(product_category) <> ''
      `);
      console.log("Migration: opportunities.product_category ENUM -> VARCHAR (intake types)");
    }
  } catch (e) {
    console.warn("Migration: opportunities.product_category type change:", e.message);
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS opportunity_activities (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      opportunity_id INT UNSIGNED NOT NULL,
      tenant_id INT UNSIGNED DEFAULT NULL,
      activity_type ENUM('consultation','stage_change','close_won','close_lost','note') NOT NULL,
      notes TEXT DEFAULT NULL,
      metadata JSON DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_opp_act_opp (opportunity_id, created_at),
      KEY idx_opp_act_tenant (tenant_id, created_at),
      CONSTRAINT fk_opp_act_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── support tickets table ──────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tickets (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
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
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tickets_status (status),
      KEY idx_tickets_priority (priority),
      KEY idx_tickets_assigned (assigned_to),
      KEY idx_tickets_created_by (created_by),
      KEY idx_tickets_lead (lead_id),
      KEY idx_tickets_contact (contact_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── lead_followups table ───────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS lead_followups (
      id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
      lead_id             INT UNSIGNED NOT NULL,
      note                TEXT         NOT NULL,
      next_follow_up_date DATE         DEFAULT NULL,
      next_follow_up_at   DATETIME     DEFAULT NULL,
      attachments_json    JSON         DEFAULT NULL,
      created_by          INT UNSIGNED DEFAULT NULL,
      created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_lead_id (lead_id),
      KEY idx_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── notes table ────────────────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      lead_id    INT UNSIGNED DEFAULT NULL,
      title      VARCHAR(200) DEFAULT NULL,
      content    TEXT         NOT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_lead_id (lead_id),
      KEY idx_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [noteCols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notes' AND COLUMN_NAME = 'title'`
  );
  if (noteCols.length === 0) {
    try {
      await pool.execute("ALTER TABLE notes ADD COLUMN title VARCHAR(200) DEFAULT NULL AFTER lead_id");
      console.log("Migration: added notes.title");
    } catch (_) {}
  }
  const [noteLead] = await pool.execute(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notes' AND COLUMN_NAME = 'lead_id'`
  );
  if (noteLead.length && noteLead[0].IS_NULLABLE === "NO") {
    try {
      await pool.execute("ALTER TABLE notes MODIFY COLUMN lead_id INT UNSIGNED DEFAULT NULL");
      console.log("Migration: notes.lead_id nullable for sticky notes");
    } catch (_) {}
  }

  // ── orders: missing columns guard ─────────────────────────────────────────
  const ordersMissingCols = [
    { column: "updated_at",   table: "orders", definition: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
    { column: "package_price", table: "orders", definition: "DECIMAL(10,2) DEFAULT 0" },
    { column: "subtotal",     table: "orders", definition: "DECIMAL(10,2) DEFAULT 0" },
    { column: "gst",          table: "orders", definition: "DECIMAL(10,2) DEFAULT 0" },
  ];
  for (const { column, table, definition } of ordersMissingCols) {
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (cols.length === 0) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration: added ${table}.${column}`);
    }
  }

  // ── leads: fix source column type ─────────────────────────────────────────
  const [leadTables] = await pool.execute("SHOW TABLES LIKE 'leads'");
  if (leadTables.length > 0) {
    try {
      await pool.execute(
        "ALTER TABLE leads MODIFY COLUMN source VARCHAR(50) NOT NULL DEFAULT 'other'"
      );
    } catch (_) {}

    const leadExtraColumns = [
      { column: "address",          definition: "TEXT DEFAULT NULL" },
      { column: "reference",        definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "attachments_json", definition: "JSON DEFAULT NULL" },
      { column: "phone_dial",       definition: "VARCHAR(10) DEFAULT NULL" },
      { column: "label",            definition: "VARCHAR(50) DEFAULT NULL" },
      { column: "cancel_reason",    definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "follow_up_date",   definition: "DATE DEFAULT NULL" },
      { column: "company_name",     definition: "VARCHAR(150) DEFAULT NULL" },
      { column: "created_by",       definition: "INT UNSIGNED DEFAULT NULL" },
      { column: "updated_at",       definition: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
    ];

    for (const { column, definition } of leadExtraColumns) {
      const [cols] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = ?`,
        [column]
      );
      if (cols.length === 0) {
        await pool.execute(`ALTER TABLE leads ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added leads.${column}`);
      }
    }
  }

  // ── lead_followups: extra columns guard ────────────────────────────────────
  const [fuTables] = await pool.execute("SHOW TABLES LIKE 'lead_followups'");
  if (fuTables.length > 0) {
    const fuCols = [
      { column: "next_follow_up_at", definition: "DATETIME DEFAULT NULL" },
      { column: "attachments_json",  definition: "JSON DEFAULT NULL" },
    ];
    for (const { column, definition } of fuCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead_followups' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE lead_followups ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added lead_followups.${column}`);
      }
    }
  }

  // ── reminders & meetings (Render / DBs that only run ensureSchema need these) ──
  const [[{ ucnt }]] = await pool.execute(
    "SELECT COUNT(*) AS ucnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'"
  );
  const [[{ lcnt }]] = await pool.execute(
    "SELECT COUNT(*) AS lcnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'leads'"
  );
  // ── chat (requires users) ───────────────────────────────────────────────────
  if (Number(ucnt) > 0) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_threads (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        thread_type ENUM('direct','group') NOT NULL DEFAULT 'direct',
        title       VARCHAR(200) DEFAULT NULL,
        created_by  INT UNSIGNED DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_thread_type (thread_type),
        KEY idx_created_by (created_by),
        CONSTRAINT fk_chat_thread_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_thread_members (
        thread_id   INT UNSIGNED NOT NULL,
        user_id     INT UNSIGNED NOT NULL,
        member_role ENUM('member','admin') NOT NULL DEFAULT 'member',
        joined_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_read_message_id INT UNSIGNED DEFAULT NULL,
        last_read_at DATETIME DEFAULT NULL,
        PRIMARY KEY (thread_id, user_id),
        KEY idx_ctm_user (user_id),
        CONSTRAINT fk_ctm_thread FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
        CONSTRAINT fk_ctm_user   FOREIGN KEY (user_id)   REFERENCES users(id)        ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_thread_messages (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        thread_id   INT UNSIGNED NOT NULL,
        sender_id   INT UNSIGNED NOT NULL,
        body        TEXT         NOT NULL,
        attachments_json JSON    DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_ctm_thread (thread_id, id),
        KEY idx_ctm_sender (sender_id),
        CONSTRAINT fk_chat_msg_thread FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // direct thread uniqueness helper (optional, safe to attempt)
    try {
      await pool.execute(
        "CREATE TABLE IF NOT EXISTS chat_direct_pairs (pair_key VARCHAR(64) NOT NULL PRIMARY KEY, thread_id INT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_cdp_thread FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
      );
    } catch (_) {}
  }

  if (Number(ucnt) > 0 && Number(lcnt) > 0) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS reminders (
      id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id               INT UNSIGNED NOT NULL,
      title                 VARCHAR(200) NOT NULL,
      note                  TEXT         DEFAULT NULL,
      remind_at             DATETIME     NOT NULL,
      lead_id               INT UNSIGNED DEFAULT NULL,
      assigned_to_user_id   INT UNSIGNED DEFAULT NULL,
      reminder_type         VARCHAR(50)  NOT NULL DEFAULT 'general',
      is_done               TINYINT(1)   NOT NULL DEFAULT 0,
      created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_id (user_id),
      KEY idx_remind_at (remind_at),
      KEY idx_assigned_to (assigned_to_user_id),
      KEY idx_reminder_type (reminder_type),
      CONSTRAINT fk_reminder_user FOREIGN KEY (user_id)  REFERENCES users(id),
      CONSTRAINT fk_reminder_lead FOREIGN KEY (lead_id)  REFERENCES leads(id) ON DELETE SET NULL,
      CONSTRAINT fk_reminder_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [reminderTable] = await pool.execute("SHOW TABLES LIKE 'reminders'");
  if (reminderTable.length > 0) {
    const reminderCols = [
      { column: "assigned_to_user_id", definition: "INT UNSIGNED DEFAULT NULL" },
      { column: "reminder_type", definition: "VARCHAR(50) NOT NULL DEFAULT 'general'" },
    ];
    for (const { column, definition } of reminderCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE reminders ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added reminders.${column}`);
      }
    }
    const [fkRem] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders' AND CONSTRAINT_NAME = 'fk_reminder_assignee'`
    );
    if (fkRem.length === 0) {
      try {
        await pool.execute(
          "ALTER TABLE reminders ADD INDEX idx_assigned_to (assigned_to_user_id)"
        );
      } catch {
        /* index may already exist */
      }
      try {
        await pool.execute(
          `ALTER TABLE reminders ADD CONSTRAINT fk_reminder_assignee
           FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL`
        );
        console.log("Migration: added reminders.fk_reminder_assignee");
      } catch (e) {
        console.warn("Migration: could not add fk_reminder_assignee:", e.message);
      }
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS meetings (
      id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title                 VARCHAR(200) NOT NULL,
      description           TEXT         DEFAULT NULL,
      start_time            DATETIME     NOT NULL,
      end_time              DATETIME     DEFAULT NULL,
      location              VARCHAR(300) DEFAULT NULL,
      meet_link             VARCHAR(500) DEFAULT NULL,
      meeting_type          VARCHAR(50)  NOT NULL DEFAULT 'virtual',
      status                VARCHAR(50)  NOT NULL DEFAULT 'scheduled',
      organizer_id          INT UNSIGNED NOT NULL,
      assigned_to_user_id   INT UNSIGNED DEFAULT NULL,
      lead_id               INT UNSIGNED DEFAULT NULL,
      recurrence            VARCHAR(50)  NOT NULL DEFAULT 'once',
      created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_organizer (organizer_id),
      KEY idx_meeting_assignee (assigned_to_user_id),
      KEY idx_start_time (start_time),
      KEY idx_meeting_type (meeting_type),
      KEY idx_meeting_status (status),
      KEY idx_meeting_recurrence (recurrence),
      CONSTRAINT fk_meeting_organizer FOREIGN KEY (organizer_id) REFERENCES users(id),
      CONSTRAINT fk_meeting_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_meeting_lead      FOREIGN KEY (lead_id)      REFERENCES leads(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS meeting_attendees (
      meeting_id INT UNSIGNED NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      PRIMARY KEY (meeting_id, user_id),
      CONSTRAINT fk_ma_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      CONSTRAINT fk_ma_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [meetTbl] = await pool.execute("SHOW TABLES LIKE 'meetings'");
  if (meetTbl.length > 0) {
    const meetingCols = [
      { column: "meeting_type", definition: "VARCHAR(50) NOT NULL DEFAULT 'virtual'" },
      { column: "status", definition: "VARCHAR(50) NOT NULL DEFAULT 'scheduled'" },
      { column: "assigned_to_user_id", definition: "INT UNSIGNED DEFAULT NULL" },
      { column: "recurrence", definition: "VARCHAR(50) NOT NULL DEFAULT 'once'" },
    ];
    for (const { column, definition } of meetingCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE meetings ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added meetings.${column}`);
      }
    }
    try {
      await pool.execute("ALTER TABLE meetings ADD INDEX idx_meeting_assignee (assigned_to_user_id)");
    } catch {
      /* index may exist */
    }
    const [fkMa] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND CONSTRAINT_NAME = 'fk_meeting_assignee'`
    );
    if (fkMa.length === 0) {
      try {
        await pool.execute(
          `ALTER TABLE meetings ADD CONSTRAINT fk_meeting_assignee
           FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL`
        );
        console.log("Migration: added meetings.fk_meeting_assignee");
      } catch (e) {
        console.warn("Migration: could not add fk_meeting_assignee:", e.message);
      }
    }
    try {
      await pool.execute("ALTER TABLE meetings ADD INDEX idx_meeting_recurrence (recurrence)");
    } catch {
      /* index may exist */
    }
  }
  } else {
    console.warn(
      "ensureSchema: skipped reminders/meetings tables (users or leads table missing — run full DB setup)."
    );
  }

  // ── company_settings: invoice payment fields ─────────────────────────────
  const [csTables] = await pool.execute(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'company_settings'"
  );
  if (csTables.length > 0) {
    const csCols = [
      { column: "invoice_bank_name", definition: "VARCHAR(200) DEFAULT NULL" },
      { column: "invoice_account_no", definition: "VARCHAR(64) DEFAULT NULL" },
      { column: "invoice_ifsc", definition: "VARCHAR(20) DEFAULT NULL" },
      { column: "invoice_currency", definition: "VARCHAR(10) NOT NULL DEFAULT 'INR'" },
      { column: "invoice_gst_mode", definition: "VARCHAR(20) NOT NULL DEFAULT 'none'" },
    ];
    for (const { column, definition } of csCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_settings' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE company_settings ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added company_settings.${column}`);
      }
    }
  }

  // ── invoices: line items + GST + customer link ────────────────────────────
  const [invTables] = await pool.execute(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'invoices'"
  );
  if (invTables.length > 0) {
    const invCols = [
      { column: "gst_mode", definition: "VARCHAR(20) NOT NULL DEFAULT 'none'" },
      { column: "currency", definition: "VARCHAR(10) NOT NULL DEFAULT 'INR'" },
      { column: "customer_id", definition: "INT UNSIGNED DEFAULT NULL" },
      { column: "line_items_json", definition: "JSON DEFAULT NULL" },
    ];
    for (const { column, definition } of invCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = ?`,
        [column]
      );
      if (c.length === 0) {
        await pool.execute(`ALTER TABLE invoices ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added invoices.${column}`);
      }
    }
  }

  // ── subscription catalog (admin-managed packages & add-ons) ────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscription_packages (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug            VARCHAR(80)  NOT NULL,
      name            VARCHAR(120) NOT NULL,
      description     TEXT         DEFAULT NULL,
      price_inr       DECIMAL(12,2) NOT NULL DEFAULT 0,
      price_usd       DECIMAL(12,2) NOT NULL DEFAULT 0,
      staff_seats     INT UNSIGNED NOT NULL DEFAULT 3,
      billing_period  VARCHAR(40)  NOT NULL DEFAULT 'Year',
      features_json   JSON         NOT NULL,
      sort_order      INT          NOT NULL DEFAULT 0,
      is_active       TINYINT(1)   NOT NULL DEFAULT 1,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_subscription_packages_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscription_addons (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug            VARCHAR(80)  NOT NULL,
      name            VARCHAR(120) NOT NULL,
      period_label    VARCHAR(160) DEFAULT NULL,
      price_inr       DECIMAL(12,2) NOT NULL DEFAULT 0,
      price_usd       DECIMAL(12,2) NOT NULL DEFAULT 0,
      icon            VARCHAR(120) DEFAULT 'fas fa-circle',
      sort_order      INT          NOT NULL DEFAULT 0,
      is_active       TINYINT(1)   NOT NULL DEFAULT 1,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_subscription_addons_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Subscription catalog seeding removed

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS coupons (
      id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code               VARCHAR(40)  NOT NULL,
      discount_percent   TINYINT UNSIGNED NOT NULL,
      description        VARCHAR(255) DEFAULT NULL,
      max_redemptions    INT UNSIGNED DEFAULT NULL,
      redemptions_used   INT UNSIGNED NOT NULL DEFAULT 0,
      valid_from         DATETIME     DEFAULT NULL,
      valid_until        DATETIME     DEFAULT NULL,
      is_active          TINYINT(1)   NOT NULL DEFAULT 1,
      created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_coupons_code (code),
      KEY idx_coupons_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const psCouponCols = [
    { column: "user_id", definition: "VARCHAR(100) DEFAULT NULL" },
    { column: "coupon_code", definition: "VARCHAR(40) DEFAULT NULL" },
    { column: "coupon_id", definition: "INT UNSIGNED DEFAULT NULL" },
  ];
  for (const { column, definition } of psCouponCols) {
    const [c] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_sessions' AND COLUMN_NAME = ?`,
      [column]
    );
    if (c.length === 0) {
      await pool.execute(`ALTER TABLE payment_sessions ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration: added payment_sessions.${column}`);
    }
  }
  const [legacyClerkCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_sessions' AND COLUMN_NAME = 'clerk_user_id'`
  );
  const [psUserCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_sessions' AND COLUMN_NAME = 'user_id'`
  );
  if (legacyClerkCol.length && psUserCol.length) {
    try {
      await pool.execute(
        `UPDATE payment_sessions
         SET user_id = COALESCE(NULLIF(TRIM(user_id), ''), clerk_user_id)
         WHERE user_id IS NULL OR TRIM(user_id) = ''`
      );
    } catch (e) {
      console.warn("Migration: payment_sessions backfill user_id:", e.message);
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS crm_todos (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      body            TEXT         NOT NULL,
      frequency       ENUM('once','daily','weekly','monthly','quarterly','half_yearly','yearly') NOT NULL DEFAULT 'once',
      todo_date       DATE         NOT NULL,
      priority        ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
      carry_forward   TINYINT(1)   NOT NULL DEFAULT 0,
      status          ENUM('pending','completed') NOT NULL DEFAULT 'pending',
      completed_at    DATETIME     DEFAULT NULL,
      attachment_json JSON        DEFAULT NULL,
      created_by      INT UNSIGNED NOT NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_todo_date (todo_date),
      KEY idx_status (status),
      KEY idx_frequency (frequency),
      KEY idx_created_by (created_by),
      CONSTRAINT fk_crm_todo_creator FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS crm_todo_assignees (
      todo_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (todo_id, user_id),
      CONSTRAINT fk_todo_asg_todo FOREIGN KEY (todo_id) REFERENCES crm_todos(id) ON DELETE CASCADE,
      CONSTRAINT fk_todo_asg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id       INT UNSIGNED NOT NULL,
      actor_user_id INT UNSIGNED DEFAULT NULL,
      entity_type   VARCHAR(50) NOT NULL DEFAULT 'general',
      entity_id     BIGINT UNSIGNED DEFAULT NULL,
      title         VARCHAR(220) NOT NULL,
      body          TEXT DEFAULT NULL,
      is_read       TINYINT(1) NOT NULL DEFAULT 0,
      read_at       DATETIME DEFAULT NULL,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notifications_user_read (user_id, is_read, created_at),
      KEY idx_notifications_entity (entity_type, entity_id),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS crm_calendar_events (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id       INT UNSIGNED NOT NULL,
      title         VARCHAR(220) NOT NULL,
      description   TEXT DEFAULT NULL,
      start_at      DATETIME NOT NULL,
      end_at        DATETIME DEFAULT NULL,
      all_day       TINYINT(1) NOT NULL DEFAULT 0,
      category      VARCHAR(32) NOT NULL DEFAULT 'event',
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cal_user_range (user_id, start_at),
      CONSTRAINT fk_cal_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);


  const [usersTbl] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'users'`
  );
  if (usersTbl.length) {
    const jwtAuthUserCols = [
      { column: "first_name", definition: "VARCHAR(100) DEFAULT NULL" },
      { column: "last_name", definition: "VARCHAR(100) DEFAULT NULL" },
      { column: "password_hash", definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "email_verified", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
      { column: "password_reset_token", definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "password_reset_expires", definition: "DATETIME DEFAULT NULL" },
      { column: "is_active", definition: "TINYINT(1) NOT NULL DEFAULT 1" },
    ];
    for (const { column, definition } of jwtAuthUserCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
        [column]
      );
      if (!c.length) {
        await pool.execute(`ALTER TABLE users ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added users.${column}`);
      }
    }

    const [uniqClerk] = await pool.execute(
      `SELECT DISTINCT INDEX_NAME AS n FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND COLUMN_NAME = 'clerk_user_id' AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'`
    );
    for (const row of uniqClerk) {
      const name = String(row.n || "");
      if (/^[a-zA-Z0-9_]+$/.test(name)) {
        try {
          await pool.execute(`ALTER TABLE users DROP INDEX \`${name}\``);
          console.log(`Migration: dropped users unique index on clerk_user_id (${name})`);
        } catch (e) {
          console.warn(`Migration: drop users index ${name}:`, e.message);
        }
      }
    }

    const [clerkNullRows] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'clerk_user_id'`
    );
    if (clerkNullRows.length && clerkNullRows[0].IS_NULLABLE === "NO") {
      try {
        await pool.execute(
          "ALTER TABLE users MODIFY COLUMN clerk_user_id VARCHAR(100) DEFAULT NULL"
        );
        console.log("Migration: users.clerk_user_id nullable");
      } catch (e) {
        console.warn("Migration: users.clerk_user_id modify:", e.message);
      }
    }

    const [ukEmailRows] = await pool.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_email' LIMIT 1`
    );
    if (!ukEmailRows.length) {
      try {
        await pool.execute("ALTER TABLE users ADD UNIQUE KEY uk_email (email)");
        console.log("Migration: added users.uk_email");
      } catch (e) {
        console.warn("Migration: users.uk_email:", e.message);
      }
    }

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id      INT UNSIGNED NOT NULL,
        token_hash   VARCHAR(255) NOT NULL,
        expires_at   DATETIME     NOT NULL,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_refresh_tokens_user (user_id),
        KEY idx_refresh_tokens_expires (expires_at),
        CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [platCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_platform_admin'`
    );
    if (!platCol.length) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log("Migration: added users.is_platform_admin");
    }

    const [mobileCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mobile_number'`
    );
    if (!mobileCol.length) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN mobile_number VARCHAR(20) DEFAULT NULL`
      );
      console.log("Migration: added users.mobile_number");
    }

    const [mustChangeCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_password'`
    );
    if (!mustChangeCol.length) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log("Migration: added users.must_change_password");
    }
  }


  const starredTables = ["opportunities", "companies"];
  for (const table of starredTables) {
    const [tbl] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    if (!tbl.length) continue;
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'is_starred'`,
      [table]
    );
    if (!cols.length) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN is_starred TINYINT(1) NOT NULL DEFAULT 0`);
      console.log(`Migration: added ${table}.is_starred`);
    }
    try {
      await pool.execute(`ALTER TABLE \`${table}\` ADD INDEX idx_${table}_is_starred (is_starred)`);
    } catch {
      // index may exist
    }
  }

  const softDeleteTables = [
    "leads",
    "tasks",
    "reminders",
    "meetings",
    "notes",
    "companies",
    "customers",
    "invoices",
    "crm_todos",
    "opportunities",
    "tickets",
  ];
  for (const table of softDeleteTables) {
    const [tbl] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    if (!tbl.length) continue;
    const [isDeletedCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'is_deleted'`,
      [table]
    );
    if (!isDeletedCol.length) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0`);
      console.log(`Migration: added ${table}.is_deleted`);
    }
    const [deletedAtCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'deleted_at'`,
      [table]
    );
    if (!deletedAtCol.length) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN deleted_at DATETIME DEFAULT NULL`);
      console.log(`Migration: added ${table}.deleted_at`);
    }
    try {
      await pool.execute(`ALTER TABLE \`${table}\` ADD INDEX idx_${table}_is_deleted (is_deleted)`);
    } catch {
      // index may exist
    }
  }


  const [tPlan] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'plan'`
  );
  if (!tPlan.length) {
    const [tExists] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'tenants'`
    );
    if (tExists.length) {
      try {
        await pool.execute(
          `ALTER TABLE tenants ADD COLUMN plan VARCHAR(50) NOT NULL DEFAULT 'trial'`
        );
        console.log("Migration: added tenants.plan");
      } catch (e) {
        console.warn("ensureSchema: tenants.plan:", e.message);
      }
    }
  }

  // ── seed integrations ──────────────────────────────────────────────────────
  for (const integration of INTEGRATIONS) {
    await pool.execute(
      `INSERT INTO integrations (\`key\`, name, is_active)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [integration.key, integration.name]
    );
  }

  // ── fitness layer tables ───────────────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_clients (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) UNIQUE NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      status ENUM('Active','Hold','Inactive') DEFAULT 'Active',
      progress ENUM('Very Good','Good','Neutral','Poor','Very Poor') DEFAULT 'Neutral',
      phone VARCHAR(20),
      email VARCHAR(255),
      age INT,
      city VARCHAR(100),
      address TEXT,
      occupation VARCHAR(100),
      emergency_contact VARCHAR(255),
      referred_by_client_id VARCHAR(20),
      referred_by_name VARCHAR(255),
      source ENUM('BNI','Instagram','Facebook','Referral - Existing Client','Friend / Family','Walk-in','Online / Website','Corporate / Company') DEFAULT 'Walk-in',
      tier TINYINT DEFAULT 3,
      health_goal VARCHAR(255),
      plan_type ENUM('1 Month Plan','3 Month Plan','6 Month Plan','1 Year Plan'),
      plan_start_date DATE,
      plan_expiry_date DATE,
      follow_up_freq_days INT DEFAULT 14,
      last_consultation_date DATE,
      next_due_date DATE,
      medical_conditions TEXT,
      allergies TEXT,
      activity_level VARCHAR(100),
      current_medications TEXT,
      height_cm DECIMAL(5,2),
      start_weight_kg DECIMAL(5,2),
      current_weight_kg DECIMAL(5,2),
      target_weight_kg DECIMAL(5,2),
      bmi DECIMAL(5,2),
      coach_notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_clients_client_id (client_id),
      KEY idx_fitness_clients_status (status),
      KEY idx_fitness_clients_next_due (next_due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_consultations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NOT NULL,
      consult_date DATE NOT NULL,
      consult_type ENUM('Onboarding','Diet Review','Check-in','Follow-up','Other') NOT NULL,
      weight_kg DECIMAL(5,2),
      key_observations TEXT,
      diet_changes TEXT,
      next_steps TEXT,
      next_appointment VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_consultations_client (client_id),
      KEY idx_fitness_consultations_date (consult_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_body_stats (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NOT NULL,
      recorded_date DATE NOT NULL,
      weight_kg DECIMAL(5,2),
      body_fat_pct DECIMAL(5,2),
      muscle_mass_kg DECIMAL(5,2),
      waist_cm DECIMAL(5,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_body_stats_client (client_id),
      KEY idx_fitness_body_stats_date (recorded_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_supplements (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      prescribed_date DATE,
      quantity INT,
      mrp_inr DECIMAL(10,2),
      rate_inr DECIMAL(10,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_supplements_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_external_buyers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      referred_by_client_id VARCHAR(20) DEFAULT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_fitness_external_buyers_phone (phone),
      KEY idx_feb_referred (referred_by_client_id),
      CONSTRAINT fk_feb_referred_client FOREIGN KEY (referred_by_client_id) REFERENCES fitness_clients(client_id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_transactions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NULL,
      external_buyer_id INT UNSIGNED NULL,
      transaction_date DATE NOT NULL,
      product_plan VARCHAR(255) NOT NULL,
      type ENUM('Membership','Supplement','Other') NOT NULL,
      mrp_inr DECIMAL(10,2),
      rate_inr DECIMAL(10,2),
      received_inr DECIMAL(10,2) DEFAULT 0,
      pending_inr DECIMAL(10,2) DEFAULT 0,
      cost_inr DECIMAL(10,2) DEFAULT 0,
      profit_inr DECIMAL(10,2) GENERATED ALWAYS AS (received_inr - cost_inr) STORED,
      pay_mode ENUM('GPay','Cash','Online Transfer','Cheque','UPI','NEFT') DEFAULT 'GPay',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_transactions_client (client_id),
      KEY idx_fitness_transactions_external (external_buyer_id),
      KEY idx_fitness_transactions_date (transaction_date),
      KEY idx_fitness_transactions_type (type),
      CONSTRAINT fk_fitness_transactions_external FOREIGN KEY (external_buyer_id) REFERENCES fitness_external_buyers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT chk_ft_client_xor_external CHECK (
        (client_id IS NOT NULL AND external_buyer_id IS NULL)
        OR (client_id IS NULL AND external_buyer_id IS NOT NULL)
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migrate existing DBs created before external walk-in support (CREATE IF NOT EXISTS leaves old fitness_transactions shape)
  const [txExtCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_transactions' AND COLUMN_NAME = 'external_buyer_id'`
  );
  if (txExtCol.length === 0) {
    try {
      await pool.execute(
        `ALTER TABLE fitness_transactions MODIFY COLUMN client_id VARCHAR(20) NULL`
      );
      console.log("Migration: fitness_transactions.client_id nullable");
    } catch (e) {
      console.warn("ensureSchema: nullable client_id:", e.message);
    }
    await pool.execute(
      `ALTER TABLE fitness_transactions ADD COLUMN external_buyer_id INT UNSIGNED NULL AFTER client_id`
    );
    console.log("Migration: added fitness_transactions.external_buyer_id");
    await pool.execute(
      `ALTER TABLE fitness_transactions ADD KEY idx_fitness_transactions_external (external_buyer_id)`
    );
    try {
      await pool.execute(
        `ALTER TABLE fitness_transactions ADD CONSTRAINT fk_fitness_transactions_external FOREIGN KEY (external_buyer_id) REFERENCES fitness_external_buyers(id) ON DELETE RESTRICT ON UPDATE CASCADE`
      );
    } catch (e) {
      console.warn("ensureSchema: fk_fitness_transactions_external:", e.message);
    }
    try {
      await pool.execute(`
        ALTER TABLE fitness_transactions ADD CONSTRAINT chk_ft_client_xor_external CHECK (
          (client_id IS NOT NULL AND external_buyer_id IS NULL)
          OR (client_id IS NULL AND external_buyer_id IS NOT NULL)
        )
      `);
    } catch (e) {
      console.warn("ensureSchema: chk_ft_client_xor_external (needs MySQL 8.0.16+):", e.message);
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_referrals (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      referrer_client_id VARCHAR(20) NOT NULL,
      referred_client_id VARCHAR(20) NOT NULL,
      referral_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_referrals_referrer (referrer_client_id),
      KEY idx_fitness_referrals_referred (referred_client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_client_tasks (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NOT NULL,
      task_description TEXT NOT NULL,
      due_date DATE,
      priority ENUM('High','Medium','Low') DEFAULT 'Medium',
      status ENUM('Open','In Progress','Done','Carried Forward','Overdue') DEFAULT 'Open',
      period VARCHAR(50),
      completed_on DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_client_tasks_client (client_id),
      KEY idx_fitness_client_tasks_status (status),
      KEY idx_fitness_client_tasks_due (due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fitness_meal_plans (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id VARCHAR(20) NOT NULL,
      plan_name VARCHAR(255) NOT NULL,
      start_date DATE,
      end_date DATE,
      calories INT,
      protein_g INT,
      carbs_g INT,
      fats_g INT,
      plan_pdf_url TEXT,
      notes TEXT,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fitness_meal_plans_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Seed default fitness settings
  const defaultFitnessSettings = [
    { key: 'progress_options', value: ['Very Good', 'Good', 'Neutral', 'Poor', 'Very Poor'] },
    { key: 'status_options', value: ['Active', 'Hold', 'Inactive'] },
    { key: 'source_options', value: ['BNI', 'Instagram', 'Facebook', 'Referral - Existing Client', 'Friend / Family', 'Walk-in', 'Online / Website', 'Corporate / Company'] },
    { key: 'plan_types', value: [{ type: '1 Month Plan', duration_days: 30 }, { type: '3 Month Plan', duration_days: 90 }, { type: '6 Month Plan', duration_days: 180 }, { type: '1 Year Plan', duration_days: 365 }] },
    { key: 'consult_type_options', value: ['Onboarding', 'Diet Review', 'Check-in', 'Follow-up', 'Other'] },
    { key: 'task_status_options', value: ['Open', 'In Progress', 'Done', 'Carried Forward', 'Overdue'] },
    { key: 'priority_options', value: ['High', 'Medium', 'Low'] },
    { key: 'pay_mode_options', value: ['GPay', 'Cash', 'Online Transfer', 'Cheque', 'UPI', 'NEFT'] },
    { key: 'transaction_type_options', value: ['Membership', 'Supplement', 'Other'] },
  ];

  for (const setting of defaultFitnessSettings) {
    await pool.execute(
      `INSERT INTO fitness_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [setting.key, JSON.stringify(setting.value)]
    );
  }

  await pool.execute(
    `INSERT INTO _schema_meta (\`key\`, value) VALUES ('version', ?)
     ON DUPLICATE KEY UPDATE value = ?`,
    [String(CURRENT_SCHEMA_VERSION), String(CURRENT_SCHEMA_VERSION)]
  );
  schemaEnsured = true;
  console.log(`Schema ensured. Tables ready.`);
}


module.exports = { ensureSchema };
