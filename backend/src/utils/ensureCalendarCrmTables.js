/**
 * Ensures CRM tables used by the calendar feed and POST /calendar/quick-add exist.
 * Fitness-only DBs often have `users` but no `leads`; older ensureSchema skipped
 * reminders/meetings/tasks in that case, causing "Table doesn't exist" 500s.
 */
async function tableCount(pool, tableName) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(row?.c) || 0;
}

async function ensureCalendarCrmTables(pool) {
  const hasUsers = (await tableCount(pool, "users")) > 0;
  if (!hasUsers) return;

  const hasLeads = (await tableCount(pool, "leads")) > 0;

  await pool.execute(`
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
        'todo','in_progress','done','carried_forward'
      ) NOT NULL DEFAULT 'new',
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_assigned (assigned_to),
      KEY idx_status   (status),
      KEY idx_due_date (due_date),
      KEY idx_label    (label),
      CONSTRAINT fk_task_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_task_creator  FOREIGN KEY (created_by)  REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (hasLeads) {
    const [fkTaskLead] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND CONSTRAINT_NAME = 'fk_task_lead'`
    );
    if (!fkTaskLead.length) {
      try {
        await pool.execute(
          `ALTER TABLE tasks ADD CONSTRAINT fk_task_lead
           FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL`
        );
      } catch (e) {
        console.warn("ensureCalendarCrmTables: fk_task_lead:", e.message);
      }
    }
  }

  const [tenantCol] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'tenant_id'`
  );
  if (!tenantCol.length) {
    try {
      await pool.execute(
        "ALTER TABLE tasks ADD COLUMN tenant_id INT UNSIGNED DEFAULT NULL AFTER id"
      );
    } catch (e) {
      console.warn("ensureCalendarCrmTables: tasks.tenant_id:", e.message);
    }
  }

  const remindersSqlWithLeads = `
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
  `;

  const remindersSqlNoLeads = `
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
      CONSTRAINT fk_reminder_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  const [remExists] = await pool.execute("SHOW TABLES LIKE 'reminders'");
  if (!remExists.length) {
    await pool.execute(hasLeads ? remindersSqlWithLeads : remindersSqlNoLeads);
  } else if (hasLeads) {
    const [fkRl] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders' AND CONSTRAINT_NAME = 'fk_reminder_lead'`
    );
    if (!fkRl.length) {
      try {
        await pool.execute(
          `ALTER TABLE reminders ADD CONSTRAINT fk_reminder_lead
           FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL`
        );
      } catch (e) {
        console.warn("ensureCalendarCrmTables: fk_reminder_lead:", e.message);
      }
    }
  }

  const meetingsSqlWithLeads = `
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
      is_deleted            TINYINT(1)   NOT NULL DEFAULT 0,
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
  `;

  const meetingsSqlNoLeads = `
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
      is_deleted            TINYINT(1)   NOT NULL DEFAULT 0,
      created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_organizer (organizer_id),
      KEY idx_meeting_assignee (assigned_to_user_id),
      KEY idx_start_time (start_time),
      KEY idx_meeting_type (meeting_type),
      KEY idx_meeting_status (status),
      KEY idx_meeting_recurrence (recurrence),
      CONSTRAINT fk_meeting_organizer FOREIGN KEY (organizer_id) REFERENCES users(id),
      CONSTRAINT fk_meeting_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  const [meetExists] = await pool.execute("SHOW TABLES LIKE 'meetings'");
  if (!meetExists.length) {
    await pool.execute(hasLeads ? meetingsSqlWithLeads : meetingsSqlNoLeads);
  } else {
    const [isDel] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'is_deleted'`
    );
    if (!isDel.length) {
      try {
        await pool.execute(
          "ALTER TABLE meetings ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0"
        );
      } catch (e) {
        console.warn("ensureCalendarCrmTables: meetings.is_deleted:", e.message);
      }
    }
    if (hasLeads) {
      const [fkMl] = await pool.execute(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND CONSTRAINT_NAME = 'fk_meeting_lead'`
      );
      if (!fkMl.length) {
        try {
          await pool.execute(
            `ALTER TABLE meetings ADD CONSTRAINT fk_meeting_lead
             FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL`
          );
        } catch (e) {
          console.warn("ensureCalendarCrmTables: fk_meeting_lead:", e.message);
        }
      }
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS meeting_attendees (
      meeting_id INT UNSIGNED NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      PRIMARY KEY (meeting_id, user_id),
      CONSTRAINT fk_ma_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      CONSTRAINT fk_ma_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
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
      }
    }
    const [fkRem] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reminders' AND CONSTRAINT_NAME = 'fk_reminder_assignee'`
    );
    if (!fkRem.length) {
      try {
        await pool.execute("ALTER TABLE reminders ADD INDEX idx_assigned_to (assigned_to_user_id)");
      } catch {
        /* exists */
      }
      try {
        await pool.execute(
          `ALTER TABLE reminders ADD CONSTRAINT fk_reminder_assignee
           FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL`
        );
      } catch (e) {
        console.warn("ensureCalendarCrmTables: fk_reminder_assignee:", e.message);
      }
    }
  }

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
      }
    }
    try {
      await pool.execute("ALTER TABLE meetings ADD INDEX idx_meeting_assignee (assigned_to_user_id)");
    } catch {
      /* exists */
    }
    const [fkMa] = await pool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND CONSTRAINT_NAME = 'fk_meeting_assignee'`
    );
    if (!fkMa.length) {
      try {
        await pool.execute(
          `ALTER TABLE meetings ADD CONSTRAINT fk_meeting_assignee
           FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL`
        );
      } catch (e) {
        console.warn("ensureCalendarCrmTables: fk_meeting_assignee:", e.message);
      }
    }
    try {
      await pool.execute("ALTER TABLE meetings ADD INDEX idx_meeting_recurrence (recurrence)");
    } catch {
      /* exists */
    }
  }
}

module.exports = { ensureCalendarCrmTables };
