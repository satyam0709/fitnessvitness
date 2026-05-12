const { mainPool: pool } = require("./database");
const { INTEGRATIONS } = require("./integrationsCatalog");

let schemaEnsured = false;
const CURRENT_SCHEMA_VERSION = 4;

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

  // ── contacts table (company-wise contact directory) ───────────────────────
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
      KEY idx_contacts_created_by (created_by)
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
      product_category    ENUM('Hardware','Software','Services') DEFAULT NULL,
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
    { column: "product_category", definition: "ENUM('Hardware','Software','Services') DEFAULT NULL" },
    { column: "quantity", definition: "INT UNSIGNED NOT NULL DEFAULT 0" },
    { column: "external_quotation_url", definition: "VARCHAR(500) DEFAULT NULL" },
    { column: "followup_at", definition: "DATETIME DEFAULT NULL" },
    { column: "followup_type", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "opportunity_type", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "lead_source", definition: "VARCHAR(80) DEFAULT NULL" },
    { column: "team", definition: "VARCHAR(160) DEFAULT NULL" },
    { column: "comments_history", definition: "TEXT DEFAULT NULL" },
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
        'qualification_done','quotation_given','negotiation_review','on_hold',
        'closed_won','closed_lost'
      ) NOT NULL DEFAULT 'qualification_done'`
    );
  } catch (e) {
    console.warn("Migration: could not extend opportunities.stage enum:", e.message);
  }

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

  const { seedSubscriptionCatalogIfEmpty } = require("../services/packageCatalogService");
  await seedSubscriptionCatalogIfEmpty();

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

  // ── multi-tenant SaaS foundation ───────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenants (
      id              CHAR(36)     NOT NULL,
      company_name    VARCHAR(180) NOT NULL,
      owner_user_id   INT UNSIGNED DEFAULT NULL,
      status          ENUM('active','trial','suspended','cancelled') NOT NULL DEFAULT 'trial',
      trial_ends_at   DATETIME     DEFAULT NULL,
      settings_json   JSON         DEFAULT NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenants_owner (owner_user_id),
      KEY idx_tenants_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                        CHAR(36)     NOT NULL,
      tenant_id                 CHAR(36)     NOT NULL,
      package_id                INT UNSIGNED DEFAULT NULL,
      status                    ENUM('trial','active','expired','cancelled','suspended') NOT NULL DEFAULT 'trial',
      starts_at                 DATETIME     DEFAULT NULL,
      ends_at                   DATETIME     DEFAULT NULL,
      payment_gateway           VARCHAR(40)  DEFAULT NULL,
      gateway_subscription_id   VARCHAR(180) DEFAULT NULL,
      coupon_id                 INT UNSIGNED DEFAULT NULL,
      created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_subscriptions_tenant (tenant_id),
      KEY idx_subscriptions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_addons (
      id            CHAR(36)     NOT NULL,
      tenant_id     CHAR(36)     NOT NULL,
      addon_type    ENUM('extra_staff_seat','extra_storage','extra_feature') NOT NULL,
      quantity      INT UNSIGNED NOT NULL DEFAULT 1,
      price_paid    DECIMAL(12,2) NOT NULL DEFAULT 0,
      active_until  DATETIME     DEFAULT NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenant_addons_tenant (tenant_id),
      KEY idx_tenant_addons_type (addon_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS staff_permissions (
      id           CHAR(36)     NOT NULL,
      tenant_id    CHAR(36)     NOT NULL,
      user_id      INT UNSIGNED NOT NULL,
      feature      VARCHAR(80)  NOT NULL,
      can_view     TINYINT(1)   NOT NULL DEFAULT 1,
      can_create   TINYINT(1)   NOT NULL DEFAULT 0,
      can_edit     TINYINT(1)   NOT NULL DEFAULT 0,
      can_delete   TINYINT(1)   NOT NULL DEFAULT 0,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_staff_permissions_tenant_user (tenant_id, user_id),
      UNIQUE KEY uk_staff_permissions_scope (tenant_id, user_id, feature),
      KEY idx_staff_permissions_feature (feature)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── RBAC: global permission catalog + per-tenant roles + members (organization = tenant) ──
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS acl_permissions (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code         VARCHAR(120) NOT NULL,
      module_name  VARCHAR(80)  NOT NULL,
      action_name  VARCHAR(80)  NOT NULL,
      description  VARCHAR(255) DEFAULT NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_acl_permissions_code (code),
      KEY idx_acl_permissions_module (module_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS org_roles (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id  CHAR(36)     NOT NULL,
      slug             VARCHAR(40)  NOT NULL,
      name             VARCHAR(120) NOT NULL,
      is_system        TINYINT(1)   NOT NULL DEFAULT 1,
      created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_org_roles_scope (organization_id, slug),
      KEY idx_org_roles_org (organization_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS org_role_permissions (
      role_id        INT UNSIGNED NOT NULL,
      permission_id  INT UNSIGNED NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      KEY idx_orp_permission (permission_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS organization_members (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id  CHAR(36)     NOT NULL,
      user_id          INT UNSIGNED NOT NULL,
      role_id          INT UNSIGNED NOT NULL,
      is_active        TINYINT(1)   NOT NULL DEFAULT 1,
      invited_by       INT UNSIGNED DEFAULT NULL,
      joined_at        DATETIME     DEFAULT NULL,
      created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_org_members_user_org (organization_id, user_id),
      KEY idx_org_members_user (user_id),
      KEY idx_org_members_role (role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS rbac_audit_log (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id  CHAR(36)     NOT NULL,
      actor_user_id    INT UNSIGNED NOT NULL,
      target_user_id   INT UNSIGNED DEFAULT NULL,
      action           VARCHAR(80)  NOT NULL,
      detail_json      JSON         DEFAULT NULL,
      created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_rbac_audit_org (organization_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [usersTbl] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'users'`
  );
  if (usersTbl.length) {
    const jwtAuthUserCols = [
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

  const [tenTbl] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'tenants'`
  );
  if (tenTbl.length) {
    const [slugCol] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'slug'`
    );
    if (!slugCol.length) {
      await pool.execute(`ALTER TABLE tenants ADD COLUMN slug VARCHAR(120) DEFAULT NULL`);
      try {
        await pool.execute(`ALTER TABLE tenants ADD UNIQUE KEY uk_tenants_slug (slug)`);
      } catch {
        /* unique may exist */
      }
      console.log("Migration: added tenants.slug");
    }
    for (const { column, definition } of [
      { column: "is_active", definition: "TINYINT(1) NOT NULL DEFAULT 1" },
      { column: "owner_clerk_user_id", definition: "VARCHAR(100) DEFAULT NULL" },
      { column: "subdomain", definition: "VARCHAR(64) DEFAULT NULL" },
      {
        column: "subdomain_status",
        definition: "ENUM('pending','active','failed') NOT NULL DEFAULT 'pending'",
      },
    ]) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = ?`,
        [column]
      );
      if (!c.length) {
        await pool.execute(`ALTER TABLE tenants ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Migration: added tenants.${column}`);
      }
    }
    try {
      await pool.execute(`ALTER TABLE tenants ADD KEY idx_tenants_is_active (is_active)`);
    } catch {
      /* exists */
    }
    try {
      await pool.execute(`ALTER TABLE tenants ADD UNIQUE KEY uk_tenants_subdomain (subdomain)`);
    } catch {
      /* exists */
    }
    try {
      await pool.execute(
        `UPDATE tenants SET subdomain = slug WHERE (subdomain IS NULL OR TRIM(subdomain) = '') AND slug IS NOT NULL`
      );
    } catch (e) {
      console.warn("Migration: backfill tenants.subdomain:", e.message);
    }

    // Migration: Add 'pending_payment' to tenants.status ENUM if not present
    try {
      const [enumRows] = await pool.execute(`
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tenants'
          AND COLUMN_NAME = 'status'
      `);
      if (enumRows.length > 0) {
        const columnType = enumRows[0].COLUMN_TYPE;
        // Check if 'pending_payment' is not in the ENUM values
        if (!columnType.includes("'pending_payment'")) {
          console.log("Migration: Adding 'pending_payment' to tenants.status ENUM");
          // Modify the ENUM to include pending_payment
          await pool.execute(`
            ALTER TABLE tenants
            MODIFY COLUMN status ENUM('active','trial','suspended','cancelled','pending_payment')
            NOT NULL DEFAULT 'trial'
          `);
        }
      }
    } catch (e) {
      console.warn("Migration: modifying tenants.status ENUM:", e.message);
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_features (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id    CHAR(36)     NOT NULL,
      feature_key  VARCHAR(80)  NOT NULL,
      is_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_tenant_features_scope (tenant_id, feature_key),
      KEY idx_tenant_features_tenant (tenant_id),
      CONSTRAINT fk_tenant_features_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_marketplace_addons (
      id          CHAR(36)     NOT NULL,
      tenant_id   CHAR(36)     NOT NULL,
      addon_key   VARCHAR(100) NOT NULL,
      is_active   TINYINT(1)   NOT NULL DEFAULT 0,
      valid_from  DATETIME     DEFAULT NULL,
      valid_until DATETIME     DEFAULT NULL,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_tma_scope (tenant_id, addon_key),
      KEY idx_tma_tenant (tenant_id),
      CONSTRAINT fk_tma_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_invitations (
      id           CHAR(36)     NOT NULL,
      tenant_id    CHAR(36)     NOT NULL,
      email        VARCHAR(180) NOT NULL,
      role         VARCHAR(20)  NOT NULL DEFAULT 'staff',
      invited_by   INT UNSIGNED DEFAULT NULL,
      status       ENUM('pending','accepted','expired','cancelled') NOT NULL DEFAULT 'pending',
      expires_at   DATETIME     NOT NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tinv_tenant (tenant_id),
      KEY idx_tinv_email (email),
      CONSTRAINT fk_tinv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_tinv_inviter FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_invitations (
      id           CHAR(36)     NOT NULL,
      user_id      INT UNSIGNED NOT NULL,
      tenant_id    CHAR(36)     DEFAULT NULL,
      invited_by   INT UNSIGNED DEFAULT NULL,
      email        VARCHAR(180) NOT NULL,
      role         VARCHAR(20)  NOT NULL DEFAULT 'staff',
      token        VARCHAR(255) NOT NULL,
      status       ENUM('pending','accepted','expired','cancelled') NOT NULL DEFAULT 'pending',
      expires_at   DATETIME     NOT NULL,
      accepted_at  DATETIME     DEFAULT NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_user_invitations_token (token),
      KEY idx_user_invitations_user (user_id),
      KEY idx_user_invitations_email (email),
      KEY idx_user_invitations_tenant (tenant_id),
      CONSTRAINT fk_user_invitations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_invitations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
      CONSTRAINT fk_user_invitations_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Legacy-compatible package registry per tenant (additive; does not alter existing subscription model)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_packages (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id     CHAR(36)     NOT NULL,
      package_name  VARCHAR(100) NOT NULL,
      max_users     INT          NOT NULL DEFAULT 5,
      valid_from    DATE         DEFAULT NULL,
      valid_until   DATE         DEFAULT NULL,
      status        ENUM('trial','active','expired','cancelled') NOT NULL DEFAULT 'trial',
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tenant_packages_tenant (tenant_id),
      CONSTRAINT fk_tenant_packages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Backward-compatible invitation token support
  const [tinvTokenCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_invitations' AND COLUMN_NAME = 'token'`
  );
  if (!tinvTokenCol.length) {
    await pool.execute(`ALTER TABLE tenant_invitations ADD COLUMN token VARCHAR(255) DEFAULT NULL`);
    console.log("Migration: added tenant_invitations.token");
  }
  try {
    await pool.execute(`ALTER TABLE tenant_invitations ADD UNIQUE KEY uk_tinv_token (token)`);
  } catch {
    // index may already exist
  }

  // Optional legacy column parity for tenants.name while keeping existing company_name usage
  const [tenantNameCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'name'`
  );
  if (!tenantNameCol.length) {
    await pool.execute(`ALTER TABLE tenants ADD COLUMN name VARCHAR(255) DEFAULT NULL`);
    try {
      await pool.execute(`UPDATE tenants SET name = company_name WHERE name IS NULL`);
    } catch {
      // tolerate partial/legacy shape differences
    }
    console.log("Migration: added tenants.name");
  }

  const tenantColumnsByTable = {
    users: "CHAR(36) DEFAULT NULL",
    leads: "CHAR(36) DEFAULT NULL",
    tasks: "CHAR(36) DEFAULT NULL",
    reminders: "CHAR(36) DEFAULT NULL",
    meetings: "CHAR(36) DEFAULT NULL",
    notes: "CHAR(36) DEFAULT NULL",
    contacts: "CHAR(36) DEFAULT NULL",
    companies: "CHAR(36) DEFAULT NULL",
    customers: "CHAR(36) DEFAULT NULL",
    invoices: "CHAR(36) DEFAULT NULL",
    crm_todos: "CHAR(36) DEFAULT NULL",
    opportunities: "CHAR(36) DEFAULT NULL",
    tickets: "CHAR(36) DEFAULT NULL",
  };
  for (const [table, definition] of Object.entries(tenantColumnsByTable)) {
    const [tbl] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    if (!tbl.length) continue;
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'tenant_id'`,
      [table]
    );
    if (!cols.length) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN tenant_id ${definition}`);
      console.log(`Migration: added ${table}.tenant_id`);
    }
    try {
      await pool.execute(`ALTER TABLE \`${table}\` ADD INDEX idx_${table}_tenant_id (tenant_id)`);
    } catch {
      // index may already exist
    }
  }

  // Add FK users.tenant_id -> tenants.id if both tables/column exist and FK is missing
  const [usersTblForFk] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'users'`
  );
  const [usersTenantColForFk] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'tenant_id'`
  );
  if (usersTblForFk.length && usersTenantColForFk.length) {
    const [usersTenantFk] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND CONSTRAINT_NAME = 'fk_users_tenant'`
    );
    if (!usersTenantFk.length) {
      try {
        await pool.execute(
          `ALTER TABLE users
           ADD CONSTRAINT fk_users_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL`
        );
        console.log("Migration: added users.fk_users_tenant");
      } catch (e) {
        console.warn("Migration: could not add users.fk_users_tenant:", e.message);
      }
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

  // ── per-tenant MySQL databases (metadata in main DB) ───────────────────────
  try {
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_databases (
      id CHAR(36) NOT NULL,
      tenant_id CHAR(36) NOT NULL,
      subdomain VARCHAR(100) NOT NULL,
      db_name VARCHAR(64) NOT NULL,
      db_host VARCHAR(255) NOT NULL,
      db_port INT NOT NULL DEFAULT 3306,
      db_user VARCHAR(100) DEFAULT NULL,
      db_pass_encrypted TEXT DEFAULT NULL,
      use_main_credentials TINYINT(1) NOT NULL DEFAULT 1,
      provision_mode ENUM('platform_shared','superadmin_assigned','tenant_provided') NOT NULL DEFAULT 'platform_shared',
      status ENUM('provisioning','active','suspended','failed','pending_review') NOT NULL DEFAULT 'provisioning',
      provision_error TEXT DEFAULT NULL,
      provisioned_at DATETIME DEFAULT NULL,
      provisioned_by INT UNSIGNED DEFAULT NULL,
      storage_bytes BIGINT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_td_tenant (tenant_id),
      UNIQUE KEY uk_td_subdomain (subdomain),
      UNIQUE KEY uk_td_db_name (db_name),
      KEY idx_td_status (status),
      CONSTRAINT fk_td_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  } catch (e) {
    console.warn("ensureSchema: tenant_databases (try without FK):", e.message);
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_databases (
      id CHAR(36) NOT NULL,
      tenant_id CHAR(36) NOT NULL,
      subdomain VARCHAR(100) NOT NULL,
      db_name VARCHAR(64) NOT NULL,
      db_host VARCHAR(255) NOT NULL,
      db_port INT NOT NULL DEFAULT 3306,
      db_user VARCHAR(100) DEFAULT NULL,
      db_pass_encrypted TEXT DEFAULT NULL,
      use_main_credentials TINYINT(1) NOT NULL DEFAULT 1,
      provision_mode ENUM('platform_shared','superadmin_assigned','tenant_provided') NOT NULL DEFAULT 'platform_shared',
      status ENUM('provisioning','active','suspended','failed','pending_review') NOT NULL DEFAULT 'provisioning',
      provision_error TEXT DEFAULT NULL,
      provisioned_at DATETIME DEFAULT NULL,
      provisioned_by INT UNSIGNED DEFAULT NULL,
      storage_bytes BIGINT UNSIGNED DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_td_tenant (tenant_id),
      UNIQUE KEY uk_td_subdomain (subdomain),
      UNIQUE KEY uk_td_db_name (db_name),
      KEY idx_td_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  }
  const [tdUseMainCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_databases' AND COLUMN_NAME = 'use_main_credentials'`
  );
  if (!tdUseMainCol.length) {
    await pool.execute(
      `ALTER TABLE tenant_databases
       ADD COLUMN use_main_credentials TINYINT(1) NOT NULL DEFAULT 1 AFTER db_pass_encrypted`
    );
    console.log("Migration: added tenant_databases.use_main_credentials");
  }

  const provisioningCols = [
    {
      column: "provision_mode",
      definition:
        "ENUM('platform_shared','superadmin_assigned','tenant_provided') NOT NULL DEFAULT 'platform_shared'",
    },
    { column: "provision_error", definition: "TEXT DEFAULT NULL" },
    { column: "provisioned_at", definition: "DATETIME DEFAULT NULL" },
    { column: "provisioned_by", definition: "INT UNSIGNED DEFAULT NULL" },
  ];
  for (const { column, definition } of provisioningCols) {
    const [c] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_databases' AND COLUMN_NAME = ?`,
      [column]
    );
    if (!c.length) {
      await pool.execute(`ALTER TABLE tenant_databases ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration: added tenant_databases.${column}`);
    }
  }

  try {
    await pool.execute(`
      ALTER TABLE tenant_databases MODIFY COLUMN status
        ENUM('provisioning','active','suspended','failed','pending_review')
        NOT NULL DEFAULT 'provisioning'
    `);
  } catch (e) {
    console.warn("Migration: tenant_databases status enum extend:", e.message);
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_db_requests (
      id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      tenant_id           CHAR(36)      NOT NULL,
      db_host             VARCHAR(255)  NOT NULL,
      db_port             SMALLINT UNSIGNED NOT NULL DEFAULT 3306,
      db_name             VARCHAR(100)  NOT NULL,
      db_user             VARCHAR(100)  NOT NULL,
      db_pass_encrypted   VARCHAR(512)  NOT NULL,
      status              ENUM('pending','testing','approved','rejected') NOT NULL DEFAULT 'pending',
      test_result         TEXT          DEFAULT NULL,
      reviewed_by         INT UNSIGNED  DEFAULT NULL,
      reviewed_at         DATETIME      DEFAULT NULL,
      reject_reason       VARCHAR(255)  DEFAULT NULL,
      created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tdbr_tenant (tenant_id),
      KEY idx_tdbr_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscription_package_db_policy (
      package_id      INT UNSIGNED NOT NULL,
      allowed_modes   JSON         NOT NULL,
      default_mode    ENUM('platform_shared','superadmin_assigned','tenant_provided') NOT NULL DEFAULT 'platform_shared',
      auto_approve    TINYINT(1)   NOT NULL DEFAULT 0,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (package_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const { ensureMasterPlatformTables } = require("./masterDatabase");
  try {
    await ensureMasterPlatformTables(pool);
  } catch (e) {
    console.warn("ensureSchema: ensureMasterPlatformTables:", e.message);
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

  await pool.execute(
    `INSERT INTO _schema_meta (\`key\`, value) VALUES ('version', ?)
     ON DUPLICATE KEY UPDATE value = ?`,
    [String(CURRENT_SCHEMA_VERSION), String(CURRENT_SCHEMA_VERSION)]
  );
  schemaEnsured = true;
  console.log(`Schema ensured. Tables ready.`);
}

/**
 * Log dedicated-tenant database registry stats at startup.
 */
async function validateTenantDatabases() {
  try {
    const { mainPool } = require("./database");
    const [rows] = await mainPool.execute(
      `SELECT status, COUNT(*) c FROM tenant_databases GROUP BY status`
    );
    if (!rows.length) {
      console.log("[tenant_databases] (none registered — all tenants on shared main DB)");
      return;
    }
    const parts = rows.map((r) => `${r.status}=${r.c}`).join(", ");
    console.log(`[tenant_databases] ${parts}`);
  } catch (e) {
    console.warn("validateTenantDatabases:", e.message);
  }
}

module.exports = { ensureSchema, validateTenantDatabases };
