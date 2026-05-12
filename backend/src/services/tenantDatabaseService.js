const crypto = require("crypto");
const mysql = require("mysql2/promise");
const {
  mainPool,
  getMainPool,
  getTenantPoolForRow,
  removeTenantPoolByKey,
  buildMysqlSsl,
  getMysqlSslForDedicatedTenantDb,
} = require("../config/database");
const { encrypt, decrypt } = require("../config/tenantCrypto");
const { sendWorkspaceReadyEmail } = require("./emailService");

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "smtp",
  "ftp",
  "dev",
  "staging",
  "test",
  "static",
  "assets",
  "cdn",
  "auth",
  "login",
  "signup",
  "dashboard",
  "platform",
  "support",
  "help",
  "status",
  "blog",
  "docs",
  "billing",
]);

function validateTenantSubdomain(candidate) {
  const slug = String(candidate || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return { ok: false, error: "Subdomain is required" };
  if (slug.length < 2 || slug.length > 40) {
    return { ok: false, error: "Subdomain must be between 2 and 40 characters" };
  }
  if (RESERVED_SUBDOMAINS.has(slug)) {
    return { ok: false, error: "This subdomain is reserved" };
  }
  return { ok: true, slug };
}

async function getTenantDbRow(tenantId) {
  try {
    const [rows] = await mainPool.execute(
      "SELECT * FROM tenant_databases WHERE tenant_id = ? AND status = 'active' LIMIT 1",
      [tenantId]
    );
    return rows[0] || null;
  } catch (error) {
    console.error("getTenantDbRow:", error.message);
    return null;
  }
}

async function resolveTenantPool(tenantId) {
  try {
    const row = await getTenantDbRow(tenantId);
    if (!row) return mainPool;
    return getTenantPoolForRow(row);
  } catch (error) {
    console.error("resolveTenantPool:", error.message);
    return mainPool;
  }
}

function normalizeDbConfig(dbRow = {}) {
  return {
    db_host: String(dbRow.db_host || "").trim(),
    db_port: Number(dbRow.db_port) || 3306,
    db_name: String(dbRow.db_name || "").trim(),
    db_user: String(dbRow.db_user || "").trim(),
    db_password: dbRow.db_password == null ? "" : String(dbRow.db_password),
  };
}

function assertTenantOwnedCredentials(cfg = {}) {
  if (!cfg.db_host || !cfg.db_name || !cfg.db_user || !cfg.db_password) {
    throw new Error("db_host, db_name, db_user, and db_password are required");
  }
}

async function provisionTenantDb(tenantId, subdomain, options = {}) {
  const mode = options.mode;
  const dbRow = normalizeDbConfig(options.dbRow || {});
  const rowId = crypto.randomUUID();

  const baseCols = {
    id: rowId,
    tenant_id: tenantId,
    subdomain: String(subdomain || "").trim().toLowerCase(),
    db_host: dbRow.db_host || process.env.DB_HOST || "localhost",
    db_port: dbRow.db_port || Number(process.env.DB_PORT) || 3306,
    db_name: dbRow.db_name || process.env.DB_NAME || "",
    db_user: null,
    db_pass_encrypted: null,
    use_main_credentials: 1,
    provision_mode: mode,
    status: "active",
  };

  if (mode === "tenant_provided") {
    baseCols.db_user = dbRow.db_user;
    baseCols.db_pass_encrypted = encrypt(dbRow.db_password);
    baseCols.use_main_credentials = 0;
    baseCols.status = "pending_review";
  } else if (mode === "superadmin_assigned") {
    baseCols.db_user = dbRow.db_user;
    baseCols.db_pass_encrypted = encrypt(dbRow.db_password);
    baseCols.use_main_credentials = 0;
    baseCols.status = "active";
  } else if (mode === "platform_shared") {
    baseCols.use_main_credentials = 1;
    baseCols.status = "active";
  } else {
    throw new Error("Invalid mode for provisionTenantDb");
  }

  try {
    await mainPool.execute(
      `INSERT INTO tenant_databases
       (id, tenant_id, subdomain, db_name, db_host, db_port, db_user, db_pass_encrypted,
        use_main_credentials, provision_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         subdomain = VALUES(subdomain),
         db_name = VALUES(db_name),
         db_host = VALUES(db_host),
         db_port = VALUES(db_port),
         db_user = VALUES(db_user),
         db_pass_encrypted = VALUES(db_pass_encrypted),
         use_main_credentials = VALUES(use_main_credentials),
         provision_mode = VALUES(provision_mode),
         status = VALUES(status),
         updated_at = NOW()`,
      [
        baseCols.id,
        baseCols.tenant_id,
        baseCols.subdomain,
        baseCols.db_name,
        baseCols.db_host,
        baseCols.db_port,
        baseCols.db_user,
        baseCols.db_pass_encrypted,
        baseCols.use_main_credentials,
        baseCols.provision_mode,
        baseCols.status,
      ]
    );
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      throw error;
    }
  }
}

function publicWorkspaceUrlFromSubdomain(subdomain) {
  const sub = String(subdomain || "").trim().toLowerCase();
  if (!sub) return "";
  const base = String(process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const proto = String(process.env.WORKSPACE_PUBLIC_HTTP || "").trim() === "1" ? "http" : "https";
  return `${proto}://${sub}.${base}`;
}

async function sendWorkspaceReadyForTenant(tenantId) {
  try {
    const [[row]] = await mainPool.execute(
      `SELECT t.company_name, t.subdomain, t.slug, u.email, u.first_name, p.name AS package_name
       FROM tenants t
       LEFT JOIN users u ON u.id = t.owner_user_id
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.tenant_id = t.id
         ORDER BY s2.created_at DESC
         LIMIT 1
       )
       LEFT JOIN subscription_packages p ON p.id = s.package_id
       WHERE t.id = ?
       LIMIT 1`,
      [tenantId]
    );
    if (!row?.email) {
      console.warn(`[tenant-db] workspace_ready_email skipped; missing owner email tenant=${tenantId}`);
      return;
    }
    const tenantUrl = publicWorkspaceUrlFromSubdomain(row.subdomain || row.slug);
    const result = await sendWorkspaceReadyEmail(row.email, {
      firstName: row.first_name || "there",
      companyName: row.company_name || "your workspace",
      tenantUrl,
      packageName: row.package_name || "your plan",
      loginEmail: row.email,
    });
    if (!result?.ok) {
      console.error(
        `[tenant-db] workspace_ready_email_failed tenant=${tenantId} reason=${
          result?.detail || result?.reason || "unknown"
        }`
      );
    } else {
      console.log(`[tenant-db] workspace_ready_email_sent tenant=${tenantId} channel=${result.channel}`);
    }
  } catch (err) {
    console.error("[tenant-db] workspace ready email:", err.message);
  }
}

async function testTenantDbConnection(dbConfig = {}) {
  const cfg = normalizeDbConfig(dbConfig);
  const started = Date.now();
  let testPool;
  try {
    testPool = mysql.createPool({
      host: cfg.db_host,
      port: cfg.db_port,
      user: cfg.db_user,
      password: cfg.db_password,
      database: cfg.db_name,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
      connectTimeout: 10000,
      ssl: getMysqlSslForDedicatedTenantDb() || { rejectUnauthorized: false },
    });
    await testPool.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error.message || "Connection failed") };
  } finally {
    if (testPool) {
      try {
        await testPool.end();
      } catch {
        /* ignore close error */
      }
    }
  }
}

async function submitTenantDbRequest(tenantId, dbConfig = {}) {
  const cfg = normalizeDbConfig(dbConfig);
  assertTenantOwnedCredentials(cfg);
  const encryptedPassword = encrypt(cfg.db_password);
  const [result] = await mainPool.execute(
    `INSERT INTO tenant_db_requests
     (tenant_id, db_host, db_port, db_name, db_user, db_pass_encrypted, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
    [tenantId, cfg.db_host, cfg.db_port, cfg.db_name, cfg.db_user, encryptedPassword]
  );
  return { id: result.insertId };
}

async function getTenantDbStatus(tenantId) {
  if (!tenantId) {
    return { tenant_id: null, database: null, request: null };
  }

  const [dbRows] = await mainPool.execute(
    `SELECT id, tenant_id, subdomain, db_host, db_port, db_name, use_main_credentials,
            provision_mode, status, created_at, updated_at
     FROM tenant_databases
     WHERE tenant_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [tenantId]
  );

  const [requestRows] = await mainPool.execute(
    `SELECT id, tenant_id, db_host, db_port, db_name, db_user, status, test_result,
            reject_reason, reviewed_by, reviewed_at, created_at, updated_at
     FROM tenant_db_requests
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );

  return {
    tenant_id: tenantId,
    database: dbRows[0] || null,
    request: requestRows[0] || null,
  };
}

async function listTenantDbRequests(query = {}) {
  const status = String(query.status || "").trim().toLowerCase();
  const allowedStatuses = new Set(["pending", "approved", "rejected"]);
  const params = [];
  let where = "";

  if (allowedStatuses.has(status)) {
    where = "WHERE r.status = ?";
    params.push(status);
  }

  const [rows] = await mainPool.execute(
    `SELECT r.id, r.tenant_id, r.db_host, r.db_port, r.db_name, r.db_user, r.status,
            r.test_result, r.reject_reason, r.reviewed_by, r.reviewed_at,
            r.created_at, r.updated_at, t.company_name, t.subdomain
     FROM tenant_db_requests r
     LEFT JOIN tenants t ON t.id = r.tenant_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT 200`,
    params
  );
  return rows;
}

async function approveTenantDbRequest(requestId, adminUserId) {
  const [rows] = await mainPool.execute(
    "SELECT * FROM tenant_db_requests WHERE id = ? LIMIT 1",
    [Number(requestId)]
  );
  const requestRow = rows[0];
  if (!requestRow) {
    throw new Error("Tenant DB request not found");
  }

  const plainPassword = decrypt(requestRow.db_pass_encrypted);
  const testResult = await testTenantDbConnection({
    db_host: requestRow.db_host,
    db_port: requestRow.db_port,
    db_name: requestRow.db_name,
    db_user: requestRow.db_user,
    db_password: plainPassword,
  });

  if (!testResult.ok) {
    await mainPool.execute(
      `UPDATE tenant_db_requests
       SET status = 'rejected', test_result = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [testResult.error || "Connection test failed", adminUserId, requestId]
    );
    return { ok: false, reason: testResult.error || "Connection test failed" };
  }

  const [tenantRows] = await mainPool.execute("SELECT subdomain FROM tenants WHERE id = ? LIMIT 1", [
    requestRow.tenant_id,
  ]);
  const subdomain = String(tenantRows[0]?.subdomain || "").trim().toLowerCase();
  /* Platform-approved external DB must be `active` so resolveTenantPool uses it (not `pending_review`). */
  await provisionTenantDb(requestRow.tenant_id, subdomain, {
    mode: "superadmin_assigned",
    dbRow: {
      db_host: requestRow.db_host,
      db_port: requestRow.db_port,
      db_name: requestRow.db_name,
      db_user: requestRow.db_user,
      db_password: plainPassword,
    },
  });

  await invalidateTenantDbCache(requestRow.tenant_id);

  await mainPool.execute(
    `UPDATE tenant_db_requests
     SET status = 'approved', test_result = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [JSON.stringify(testResult), adminUserId, requestId]
  );
  await mainPool.execute("UPDATE tenants SET subdomain_status = 'active' WHERE id = ?", [requestRow.tenant_id]);
  setImmediate(() => {
    sendWorkspaceReadyForTenant(requestRow.tenant_id).catch((err) =>
      console.error("[tenant-db] ready email after request approval:", err.message)
    );
  });
  return { ok: true };
}

async function rejectTenantDbRequest(requestId, adminUserId, reason) {
  await mainPool.execute(
    `UPDATE tenant_db_requests
     SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [String(reason || "Rejected by admin"), adminUserId, Number(requestId)]
  );
}

async function getTenantDataPoolForTenantId(tenantId) {
  if (!tenantId) return getMainPool();
  return resolveTenantPool(tenantId);
}

async function getTenantDatabaseRow(tenantId) {
  return getTenantDbRow(tenantId);
}

async function invalidateTenantDbCache(tenantId) {
  try {
    const [rows] = await mainPool.execute("SELECT id FROM tenant_databases WHERE tenant_id = ? LIMIT 1", [
      tenantId,
    ]);
    if (rows[0]?.id) removeTenantPoolByKey(rows[0].id);
  } catch (error) {
    console.warn("invalidateTenantDbCache:", error.message);
  }
}

async function maybeSyncUsersToTenantCrm() {}

async function listAllTenantDatabases() {
  const [rows] = await mainPool.execute(
    `SELECT td.*, t.company_name
     FROM tenant_databases td
     LEFT JOIN tenants t ON t.id = td.tenant_id
     ORDER BY td.created_at DESC`
  );
  return rows;
}

/**
 * Super-admin: test BYOD credentials and register `tenant_databases` as active (no queue).
 */
async function activateTenantExternalDatabase(tenantId, dbConfig = {}) {
  const cfg = normalizeDbConfig(dbConfig);
  assertTenantOwnedCredentials(cfg);
  const testResult = await testTenantDbConnection(cfg);
  if (!testResult.ok) {
    throw new Error(testResult.error || "Connection test failed");
  }
  const [tenantRows] = await mainPool.execute(
    "SELECT subdomain, slug FROM tenants WHERE id = ? LIMIT 1",
    [tenantId]
  );
  const sub = String(tenantRows[0]?.subdomain || tenantRows[0]?.slug || "").trim().toLowerCase();
  if (!sub) {
    throw new Error("Tenant must have a subdomain or slug before attaching a database");
  }
  await provisionTenantDb(tenantId, sub, {
    mode: "superadmin_assigned",
    dbRow: cfg,
  });
  await mainPool.execute("UPDATE tenants SET subdomain_status = 'active', updated_at = NOW() WHERE id = ?", [
    tenantId,
  ]);
  await invalidateTenantDbCache(tenantId);
  setImmediate(() => {
    sendWorkspaceReadyForTenant(tenantId).catch((err) =>
      console.error("[tenant-db] ready email after activation:", err.message)
    );
  });
  return { ok: true, latencyMs: testResult.latencyMs };
}

async function createTenantDatabase(tenantId, companySlug) {
  const check = validateTenantSubdomain(companySlug);
  if (!check.ok) throw new Error(check.error);
  const dbName = `crm_tnt_${check.slug.replace(/-/g, "_")}`.slice(0, 64);
  await provisionTenantDb(tenantId, check.slug, {
    mode: "platform_shared",
    dbRow: { db_name: dbName, db_host: process.env.DB_HOST, db_port: process.env.DB_PORT },
  });
  // Platform-shared signup is auto-approved: mark workspace as active immediately
  // so tenant users are not blocked by "pending verification" middleware checks.
  await mainPool.execute(
    "UPDATE tenants SET subdomain = ?, subdomain_status = 'active', updated_at = NOW() WHERE id = ?",
    [check.slug, tenantId]
  );
  return { success: true, subdomain: check.slug, dbName, useMainCredentials: true };
}

module.exports = {
  validateTenantSubdomain,
  getTenantDbRow,
  resolveTenantPool,
  provisionTenantDb,
  testTenantDbConnection,
  submitTenantDbRequest,
  getTenantDbStatus,
  listTenantDbRequests,
  approveTenantDbRequest,
  rejectTenantDbRequest,
  activateTenantExternalDatabase,
  getTenantDataPoolForTenantId,
  getTenantDatabaseRow,
  invalidateTenantDbCache,
  maybeSyncUsersToTenantCrm,
  listAllTenantDatabases,
  createTenantDatabase,
  sendWorkspaceReadyForTenant,
  getMainPool: () => mainPool,
  mainPool,
};
