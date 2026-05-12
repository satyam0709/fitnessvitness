async function ensureMasterPlatformTables(pool) {
  // ── tenants table columns ──────────────────────────────────────────────────
  const [tenantsExists] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'tenants'`
  );

  if (tenantsExists.length) {
    const tenantCols = [
      { column: "subdomain",   definition: "VARCHAR(100) DEFAULT NULL" },
      { column: "slug",        definition: "VARCHAR(100) DEFAULT NULL" },
      { column: "plan",        definition: "VARCHAR(50) NOT NULL DEFAULT 'trial'" },
      {
        column: "status",
        definition: "ENUM('trial','active','suspended','cancelled') NOT NULL DEFAULT 'trial'",
      },
    ];

    for (const { column, definition } of tenantCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = ?`,
        [column]
      );
      if (!c.length) {
        try {
          await pool.execute(`ALTER TABLE tenants ADD COLUMN \`${column}\` ${definition}`);
          console.log(`[masterDb] Migration: added tenants.${column}`);
        } catch (e) {
          console.warn(`[masterDb] Could not add tenants.${column}:`, e.message);
        }
      }
    }
  }

  // ── subscriptions table ────────────────────────────────────────────────────
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id          CHAR(36)     NOT NULL,
        tenant_id   CHAR(36)     NOT NULL,
        package_id  INT UNSIGNED DEFAULT NULL,
        status      VARCHAR(50)  NOT NULL DEFAULT 'trial',
        starts_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ends_at     DATETIME     DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_sub_tenant (tenant_id),
        KEY idx_sub_status (status),
        KEY idx_sub_ends (ends_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    console.warn("[masterDb] subscriptions table:", e.message);
  }

  // ── subscriptions extra columns ────────────────────────────────────────────
  const [subExists] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'subscriptions'`
  );

  if (subExists.length) {
    const subCols = [
      { column: "package_id", definition: "INT UNSIGNED DEFAULT NULL" },
      { column: "ends_at",    definition: "DATETIME DEFAULT NULL" },
      { column: "starts_at",  definition: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP" },
      { column: "updated_at", definition: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
    ];

    for (const { column, definition } of subCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions' AND COLUMN_NAME = ?`,
        [column]
      );
      if (!c.length) {
        try {
          await pool.execute(`ALTER TABLE subscriptions ADD COLUMN \`${column}\` ${definition}`);
          console.log(`[masterDb] Migration: added subscriptions.${column}`);
        } catch (e) {
          console.warn(`[masterDb] Could not add subscriptions.${column}:`, e.message);
        }
      }
    }
  }

  // ── users table extra columns ─────────────────────────────────────────────
  const [usersExists] = await pool.execute(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'users'`
  );

  if (usersExists.length) {
    const userCols = [
      { column: "email_verified",   definition: "TINYINT(1) NOT NULL DEFAULT 0" },
      { column: "is_platform_admin",definition: "TINYINT(1) NOT NULL DEFAULT 0" },
      { column: "password_hash",    definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "password_reset_token",   definition: "VARCHAR(255) DEFAULT NULL" },
      { column: "password_reset_expires", definition: "DATETIME DEFAULT NULL" },
      { column: "invited_by",       definition: "INT UNSIGNED DEFAULT NULL" },
    ];

    for (const { column, definition } of userCols) {
      const [c] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
        [column]
      );
      if (!c.length) {
        try {
          await pool.execute(`ALTER TABLE users ADD COLUMN \`${column}\` ${definition}`);
          console.log(`[masterDb] Migration: added users.${column}`);
        } catch (e) {
          console.warn(`[masterDb] Could not add users.${column}:`, e.message);
        }
      }
    }
  }
}

module.exports = { ensureMasterPlatformTables };