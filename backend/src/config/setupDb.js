require("dotenv").config();
const mysql = require("mysql2/promise"); // Make sure to run: npm install mysql2

async function setupDb() {
  const DB = process.env.DB_NAME || "rnd_crm";
  
  // 1. Establish a raw connection (without specifying the database yet)
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || "localhost",
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    multipleStatements: false,
  });

  console.log(`\nSetting up database: ${DB}\n`);

  try {
    // 2. Create the DB and switch to it
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${DB}\``);

    // 3. Execute all table creations using 'conn'
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        clerk_user_id   VARCHAR(100)  DEFAULT NULL,
        email           VARCHAR(150)  NOT NULL,
        password_hash   VARCHAR(255)  DEFAULT NULL,
        first_name      VARCHAR(80)   DEFAULT NULL,
        last_name       VARCHAR(80)   DEFAULT NULL,
        profile_image   VARCHAR(500)  DEFAULT NULL,
        role            ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
        is_active       TINYINT(1)    NOT NULL DEFAULT 1,
        email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
        password_reset_token   VARCHAR(255)  DEFAULT NULL,
        password_reset_expires DATETIME        DEFAULT NULL,
        last_login      DATETIME      DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_email (email),
        KEY idx_clerk_id (clerk_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: users");

    // Existing deployments: additive columns, clerk_user_id nullable (non-unique), email unique, refresh_tokens
    try {
      const [ut] = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'users'`
      );
      if (ut.length) {
        const userCols = [
          { column: "password_hash", definition: "VARCHAR(255) DEFAULT NULL" },
          { column: "email_verified", definition: "TINYINT(1) NOT NULL DEFAULT 0" },
          { column: "password_reset_token", definition: "VARCHAR(255) DEFAULT NULL" },
          { column: "password_reset_expires", definition: "DATETIME DEFAULT NULL" },
          { column: "is_active", definition: "TINYINT(1) NOT NULL DEFAULT 1" },
          { column: "invited_by", definition: "INT UNSIGNED DEFAULT NULL" },
        ];
        for (const { column, definition } of userCols) {
          const [c] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
            [column]
          );
          if (!c.length) {
            await conn.query(`ALTER TABLE users ADD COLUMN \`${column}\` ${definition}`);
            console.log(`Migration: added users.${column}`);
          }
        }

        const [uniqClerk] = await conn.query(
          `SELECT DISTINCT INDEX_NAME AS n FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
             AND COLUMN_NAME = 'clerk_user_id' AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'`
        );
        for (const row of uniqClerk) {
          const name = String(row.n || "");
          if (/^[a-zA-Z0-9_]+$/.test(name)) {
            try {
              await conn.query(`ALTER TABLE users DROP INDEX \`${name}\``);
              console.log(`Migration: dropped users unique index on clerk_user_id (${name})`);
            } catch (e) {
              console.warn(`Migration: drop index ${name}:`, e.message);
            }
          }
        }

        const [clerkNull] = await conn.query(
          `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'clerk_user_id'`
        );
        if (clerkNull.length && clerkNull[0].IS_NULLABLE === "NO") {
          try {
            await conn.query(
              "ALTER TABLE users MODIFY COLUMN clerk_user_id VARCHAR(100) DEFAULT NULL"
            );
            console.log("Migration: users.clerk_user_id nullable");
          } catch (e) {
            console.warn("Migration: users.clerk_user_id modify:", e.message);
          }
        }

        const [ukEmail] = await conn.query(
          `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_email' LIMIT 1`
        );
        if (!ukEmail.length) {
          try {
            await conn.query("ALTER TABLE users ADD UNIQUE KEY uk_email (email)");
            console.log("Migration: added users.uk_email");
          } catch (e) {
            console.warn("Migration: users.uk_email:", e.message);
          }
        }
      }
    } catch (e) {
      console.warn("Migration users/JWT columns:", e.message);
    }

    await conn.query(`
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
    console.log("Table: refresh_tokens");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        name            VARCHAR(100)  NOT NULL,
        company_name    VARCHAR(150)  DEFAULT NULL,
        phone           VARCHAR(20)   NOT NULL,
        email           VARCHAR(150)  DEFAULT NULL,
        source          VARCHAR(50)   NOT NULL DEFAULT 'other',
        status          ENUM('new','processing','close_by','confirm','cancel') NOT NULL DEFAULT 'new',
        label           VARCHAR(50)   DEFAULT NULL,
        cancel_reason   VARCHAR(255)  DEFAULT NULL,
        assigned_to     INT UNSIGNED  DEFAULT NULL,
        created_by      INT UNSIGNED  NOT NULL,
        follow_up_date  DATE          DEFAULT NULL,
        notes           TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_status     (status),
        KEY idx_source     (source),
        KEY idx_assigned   (assigned_to),
        KEY idx_follow_up  (follow_up_date),
        KEY idx_created_at (created_at),
        CONSTRAINT fk_lead_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_lead_creator  FOREIGN KEY (created_by)  REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: leads");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS lead_followups (
        id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
        lead_id              INT UNSIGNED NOT NULL,
        note                 TEXT         NOT NULL,
        next_follow_up_date  DATE         DEFAULT NULL,
        created_by           INT UNSIGNED NOT NULL,
        created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_id (lead_id),
        CONSTRAINT fk_followup_lead FOREIGN KEY (lead_id)    REFERENCES leads(id) ON DELETE CASCADE,
        CONSTRAINT fk_followup_user FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: lead_followups");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name       VARCHAR(100) NOT NULL,
        phone      VARCHAR(20)  NOT NULL,
        email      VARCHAR(150) NOT NULL,
        message    TEXT         DEFAULT NULL,
        type       ENUM('contact','demo') NOT NULL DEFAULT 'contact',
        is_read    TINYINT(1)   NOT NULL DEFAULT 0,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_type    (type),
        KEY idx_is_read (is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: contact_requests");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title       VARCHAR(200) NOT NULL,
        label       VARCHAR(120)   DEFAULT NULL,
        description TEXT         DEFAULT NULL,
        lead_id     INT UNSIGNED DEFAULT NULL,
        assigned_to INT UNSIGNED DEFAULT NULL,
        created_by  INT UNSIGNED NOT NULL,
        due_date    DATE         DEFAULT NULL,
        priority    ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        status      ENUM(
          'new','in_feedback','processing','completed','rejected',
          'todo','in_progress','done'
        ) NOT NULL DEFAULT 'new',
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_assigned (assigned_to),
        KEY idx_status   (status),
        KEY idx_due_date (due_date),
        KEY idx_label    (label),
        CONSTRAINT fk_task_lead     FOREIGN KEY (lead_id)     REFERENCES leads(id) ON DELETE SET NULL,
        CONSTRAINT fk_task_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_task_creator  FOREIGN KEY (created_by)  REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: tasks");

    /* Existing databases: add label + expand status enum */
    try {
      const [labelCol] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'label'`
      );
      if (!labelCol.length) {
        await conn.query(
          `ALTER TABLE tasks ADD COLUMN label VARCHAR(120) DEFAULT NULL AFTER title`
        );
        console.log("Migration: tasks.label column added");
      }
    } catch (e) {
      console.warn("Migration tasks.label:", e.message);
    }
    try {
      await conn.query(`
        ALTER TABLE tasks MODIFY COLUMN status ENUM(
          'new','in_feedback','processing','completed','rejected',
          'todo','in_progress','done'
        ) NOT NULL DEFAULT 'new'
      `);
      console.log("Migration: tasks.status enum expanded");
    } catch (e) {
      console.warn("Migration tasks.status:", e.message);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        lead_id    INT UNSIGNED DEFAULT NULL,
        title      VARCHAR(200) DEFAULT NULL,
        content    TEXT         NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_id    (lead_id),
        KEY idx_created_by (created_by),
        CONSTRAINT fk_note_lead FOREIGN KEY (lead_id)    REFERENCES leads(id) ON DELETE CASCADE,
        CONSTRAINT fk_note_user FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: notes");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_id       VARCHAR(255) NOT NULL,
        package_name  VARCHAR(100) DEFAULT NULL,
        package_price DECIMAL(10,2) DEFAULT 0,
        currency      VARCHAR(10)  DEFAULT 'INR',
        addons        JSON,
        subtotal      DECIMAL(10,2) DEFAULT 0,
        gst           DECIMAL(10,2) DEFAULT 0,
        total         DECIMAL(10,2) DEFAULT 0,
        status        VARCHAR(50)  DEFAULT 'trial',
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: orders");

    await conn.query(`
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
    console.log("Table: reminders");

    await conn.query(`
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
    console.log("Table: meetings");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS meeting_attendees (
        meeting_id INT UNSIGNED NOT NULL,
        user_id    INT UNSIGNED NOT NULL,
        PRIMARY KEY (meeting_id, user_id),
        CONSTRAINT fk_ma_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        CONSTRAINT fk_ma_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: meeting_attendees");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS crm_todos (
        id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
        body            TEXT         NOT NULL,
        frequency       ENUM('once','daily','weekly','monthly','quarterly','half_yearly','yearly') NOT NULL DEFAULT 'once',
        todo_date       DATE         NOT NULL,
        priority        ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        carry_forward    TINYINT(1)   NOT NULL DEFAULT 0,
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
    console.log("Table: crm_todos");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS crm_todo_assignees (
        todo_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (todo_id, user_id),
        CONSTRAINT fk_todo_asg_todo FOREIGN KEY (todo_id) REFERENCES crm_todos(id) ON DELETE CASCADE,
        CONSTRAINT fk_todo_asg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: crm_todo_assignees");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name       VARCHAR(100) NOT NULL,
        email      VARCHAR(150) DEFAULT NULL,
        phone      VARCHAR(20)  DEFAULT NULL,
        company    VARCHAR(150) DEFAULT NULL,
        city       VARCHAR(100) DEFAULT NULL,
        country    VARCHAR(100) DEFAULT 'India',
        lead_id    INT UNSIGNED DEFAULT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_name (name),
        CONSTRAINT fk_customer_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: customers");

    await conn.query(`
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
    console.log("Table: contacts");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
        invoice_number VARCHAR(50)  NOT NULL UNIQUE,
        type           ENUM('sales','purchase','proforma') NOT NULL DEFAULT 'sales',
        customer_name  VARCHAR(150) DEFAULT NULL,
        customer_email VARCHAR(150) DEFAULT NULL,
        vendor_name    VARCHAR(150) DEFAULT NULL,
        invoice_date   DATE         NOT NULL,
        due_date       DATE         DEFAULT NULL,
        subtotal       DECIMAL(12,2) DEFAULT 0,
        tax            DECIMAL(12,2) DEFAULT 0,
        total          DECIMAL(12,2) DEFAULT 0,
        status         ENUM('draft','sent','paid','cancelled') NOT NULL DEFAULT 'draft',
        notes          TEXT         DEFAULT NULL,
        created_by     INT UNSIGNED DEFAULT NULL,
        created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_type   (type),
        KEY idx_status (status),
        CONSTRAINT fk_invoice_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: invoices");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        sender_id   INT UNSIGNED NOT NULL,
        receiver_id INT UNSIGNED NOT NULL,
        body        TEXT         NOT NULL,
        is_read     TINYINT(1)   NOT NULL DEFAULT 0,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_sender   (sender_id),
        KEY idx_receiver (receiver_id),
        CONSTRAINT fk_msg_sender   FOREIGN KEY (sender_id)   REFERENCES users(id),
        CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: chat_messages");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id    INT UNSIGNED NOT NULL,
        date       DATE         NOT NULL,
        check_in   TIME         DEFAULT NULL,
        check_out  TIME         DEFAULT NULL,
        status     ENUM('present','absent','half_day','leave') NOT NULL DEFAULT 'present',
        note       TEXT         DEFAULT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_date (user_id, date),
        CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: attendance");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id     INT UNSIGNED NOT NULL,
        leave_type  ENUM('annual','sick','personal','other') NOT NULL DEFAULT 'annual',
        from_date   DATE         NOT NULL,
        to_date     DATE         NOT NULL,
        days        INT          NOT NULL DEFAULT 1,
        reason      TEXT         DEFAULT NULL,
        status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        approved_by INT UNSIGNED DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_leave_user     FOREIGN KEY (user_id)     REFERENCES users(id),
        CONSTRAINT fk_leave_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: leave_requests");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS payroll (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id     INT UNSIGNED NOT NULL,
        month       TINYINT      NOT NULL,
        year        YEAR         NOT NULL,
        basic       DECIMAL(10,2) DEFAULT 0,
        allowances  DECIMAL(10,2) DEFAULT 0,
        deductions  DECIMAL(10,2) DEFAULT 0,
        net         DECIMAL(10,2) DEFAULT 0,
        paid_at     DATETIME     DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_month_year (user_id, month, year),
        CONSTRAINT fk_payroll_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: payroll");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS appraisals (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id    INT UNSIGNED NOT NULL,
        period     VARCHAR(50)  NOT NULL,
        rating     DECIMAL(3,1) NOT NULL,
        comments   TEXT         DEFAULT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_appraisal_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: appraisals");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id           INT UNSIGNED NOT NULL DEFAULT 1,
        company_name VARCHAR(200) DEFAULT NULL,
        website      VARCHAR(300) DEFAULT NULL,
        phone        VARCHAR(20)  DEFAULT NULL,
        email        VARCHAR(150) DEFAULT NULL,
        address      TEXT         DEFAULT NULL,
        city         VARCHAR(100) DEFAULT NULL,
        state        VARCHAR(100) DEFAULT NULL,
        country      VARCHAR(100) DEFAULT 'India',
        gst_number   VARCHAR(50)  DEFAULT NULL,
        pan_number   VARCHAR(50)  DEFAULT NULL,
        updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: company_settings");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS integrations (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`key\`      VARCHAR(100) NOT NULL UNIQUE,
        name       VARCHAR(200) NOT NULL,
        is_active  TINYINT(1)   NOT NULL DEFAULT 0,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: integrations");

    await conn.query(`
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
    console.log("Table: integration_webhooks");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS file_attachments (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id    INT UNSIGNED NOT NULL,
        lead_id    INT UNSIGNED DEFAULT NULL,
        file_name  VARCHAR(300) NOT NULL,
        file_url   VARCHAR(1000) NOT NULL,
        size_bytes INT UNSIGNED DEFAULT 0,
        mime_type  VARCHAR(100) DEFAULT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_fa_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_fa_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Table: file_attachments");

    await conn.query(`
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Table: payment_sessions");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   UNIQUE NOT NULL,
        full_name       VARCHAR(150)  NOT NULL,
        phone           VARCHAR(20)   DEFAULT NULL,
        email           VARCHAR(150)  DEFAULT NULL,
        age             INT           DEFAULT NULL,
        height_cm       DECIMAL(5,2)  DEFAULT NULL,
        start_weight_kg DECIMAL(5,2)  DEFAULT NULL,
        current_weight_kg DECIMAL(5,2) DEFAULT NULL,
        target_weight_kg DECIMAL(5,2) DEFAULT NULL,
        bmi             DECIMAL(5,2)  DEFAULT NULL,
        bmi_category    VARCHAR(50)   DEFAULT NULL,
        health_goal     VARCHAR(150)  DEFAULT NULL,
        plan_type       VARCHAR(100)  DEFAULT NULL,
        plan_start_date DATE          DEFAULT NULL,
        plan_expiry     DATE          DEFAULT NULL,
        follow_up_freq_days INT       DEFAULT NULL,
        client_tier     VARCHAR(50)   DEFAULT NULL,
        source          VARCHAR(100)  DEFAULT NULL,
        status          VARCHAR(50)   DEFAULT 'Active',
        progress        VARCHAR(50)   DEFAULT NULL,
        city            VARCHAR(100)  DEFAULT NULL,
        address         TEXT          DEFAULT NULL,
        occupation      VARCHAR(150)  DEFAULT NULL,
        emergency_contact VARCHAR(150) DEFAULT NULL,
        medical_conditions TEXT       DEFAULT NULL,
        allergies       TEXT          DEFAULT NULL,
        activity_level  VARCHAR(100)  DEFAULT NULL,
        current_medications TEXT      DEFAULT NULL,
        referred_by     VARCHAR(100)  DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Table: clients");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       INT UNSIGNED  NOT NULL,
        date            DATE          NOT NULL,
        type            VARCHAR(100)  NOT NULL,
        weight_kg       DECIMAL(5,2)  DEFAULT NULL,
        key_observations TEXT         DEFAULT NULL,
        diet_changes    TEXT          DEFAULT NULL,
        next_steps      TEXT          DEFAULT NULL,
        next_appt       VARCHAR(50)   DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Table: consultations");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       INT UNSIGNED  NOT NULL,
        date            DATE          NOT NULL,
        product_plan    VARCHAR(150)  NOT NULL,
        type            VARCHAR(50)   DEFAULT NULL,
        rate            DECIMAL(10,2) DEFAULT 0,
        received        DECIMAL(10,2) DEFAULT 0,
        pending         DECIMAL(10,2) DEFAULT 0,
        profit          DECIMAL(10,2) DEFAULT 0,
        mode            VARCHAR(50)   DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Table: transactions");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS supplements (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       INT UNSIGNED  NOT NULL,
        product         VARCHAR(150)  NOT NULL,
        date            DATE          NOT NULL,
        qty             INT           DEFAULT 1,
        mrp             DECIMAL(10,2) DEFAULT 0,
        rate            DECIMAL(10,2) DEFAULT 0,
        notes           TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Table: supplements");
    console.log("\nAll tables created. Database is ready!\n");

  } catch (error) {
    console.error("Error executing queries:", error.message);
  } finally {
    // 4. Always close the connection when you're done
    await conn.end();
  }
}

setupDb().catch((err) => {
  console.error("Setup failed:", err.message, "\n");
  process.exit(1);
});