const mysql = require("mysql2/promise");
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("fs");
const path = require("path");
const { decrypt } = require("./tenantCrypto");
require("dotenv").config();

const defaultCaPath = path.join(__dirname, "..", "..", "certs", "ca.pem");
const configuredCaPath = process.env.DB_SSL_CA_PATH
  ? path.resolve(process.cwd(), process.env.DB_SSL_CA_PATH)
  : defaultCaPath;

/**
 * MySQL TLS options for mysql2.
 * - Set DB_SSL_DISABLE=1 for local MySQL without TLS.
 * - Prefer CA PEM file (DB_SSL_CA_PATH or backend/certs/ca.pem), else DB_SSL_CA (base64 PEM).
 * - DB_SSL_REJECT_UNAUTHORIZED=false only for explicit dev overrides (insecure).
 */
function buildMysqlSsl() {
  const disabled =
    process.env.DB_SSL_DISABLE === "1" ||
    process.env.DB_SSL_DISABLE === "true";
  if (disabled) return undefined;

  const rejectUnauthorized = !(
    process.env.DB_SSL_REJECT_UNAUTHORIZED === "0" ||
    process.env.DB_SSL_REJECT_UNAUTHORIZED === "false"
  );

  const ssl = { rejectUnauthorized };

  if (fs.existsSync(configuredCaPath)) {
    ssl.ca = fs.readFileSync(configuredCaPath);
    return ssl;
  }

  const b64 = process.env.DB_SSL_CA;
  if (b64 && String(b64).trim()) {
    try {
      const pem = Buffer.from(String(b64).trim(), "base64").toString("utf8");
      if (pem.trim()) ssl.ca = pem;
    } catch (err) {
      console.warn("DB_SSL_CA base64 decode failed:", err.message);
    }
  }

  return ssl;
}

/**
 * TLS options for **customer-managed** MySQL (BYOD / `tenant_databases` with own credentials).
 * Aiven and similar providers often need their CA in the chain; without it Node reports
 * "self signed certificate in certificate chain" while `rejectUnauthorized` is true.
 *
 * Preferred: download the service CA from the provider console and set:
 *   TENANT_EXTERNAL_DB_SSL_CA_PATH=./certs/aiven-ca.pem
 * Dev-only workaround (weakens verification for external DB only, not the platform DB):
 *   TENANT_EXTERNAL_DB_SSL_REJECT_UNAUTHORIZED=false
 */
function getMysqlSslForDedicatedTenantDb() {
  if (
    process.env.TENANT_EXTERNAL_DB_SSL_REJECT_UNAUTHORIZED === "0" ||
    process.env.TENANT_EXTERNAL_DB_SSL_REJECT_UNAUTHORIZED === "false"
  ) {
    return { rejectUnauthorized: false };
  }
  const extPath = String(process.env.TENANT_EXTERNAL_DB_SSL_CA_PATH || "").trim();
if (extPath) {
  const resolved = path.isAbsolute(extPath) ? extPath : path.resolve(process.cwd(), extPath);
  console.log("[ssl-debug] cwd:", process.cwd());
  console.log("[ssl-debug] resolved:", resolved);
  console.log("[ssl-debug] exists:", fs.existsSync(resolved));
  if (fs.existsSync(resolved)) {
    return { rejectUnauthorized: true, ca: fs.readFileSync(resolved) };
  }
  console.log("[ssl-debug] FILE NOT FOUND - falling through to buildMysqlSsl");
}
  return buildMysqlSsl();
}

const mysqlSsl = buildMysqlSsl();

const crmContext = new AsyncLocalStorage();

function getBasePoolConfig(overrides = {}) {
  const c = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
  if (mysqlSsl) c.ssl = mysqlSsl;
  return { ...c, ...overrides };
}

/** Central / platform MySQL: tenants, users, tenant_databases, billing, auth. */
const mainPool = mysql.createPool(
  getBasePoolConfig()
);

/**
 * Per-request pool for tenant-scoped CRM data. Defaults to main when not bound (shared DB or legacy).
 */
function getCrmPool() {
  const s = crmContext.getStore();
  if (s && s.pool) return s.pool;
  return mainPool;
}

function runWithCrmPool(mysqlPool, next) {
  if (typeof next !== "function") {
    throw new TypeError("runWithCrmPool: next must be a function");
  }
  return crmContext.run({ pool: mysqlPool }, () => next());
}

const crmPoolProxy = new Proxy(mainPool, {
  get(_target, prop) {
    const p = getCrmPool();
    const v = p[prop];
    if (typeof v === "function") {
      return v.bind(p);
    }
    return v;
  },
});

/** @deprecated use `crmPoolProxy` or `getCrmPool` — `pool` is the CRM (tenant-aware) proxy. */
const pool = crmPoolProxy;

const tenantPoolCache = new Map();
const poolLastAccess = new Map();
const MAX_TENANT_POOLS = Math.min(50, Number(process.env.TENANT_POOL_MAX_TOTAL) || 20);
const perTenantConnectionLimit = Math.min(10, Number(process.env.TENANT_POOL_SIZE) || 3);
const MAX_DB_CONNECTIONS = Number(process.env.MAX_DB_CONNECTIONS || 100);

function validatePoolCapacityBudget() {
  const reserved = Math.max(10, Number(process.env.DB_RESERVED_CONNECTIONS || 10));
  const estimatedPeak = MAX_TENANT_POOLS * perTenantConnectionLimit + 10;
  const safeBudget = Math.max(1, MAX_DB_CONNECTIONS - reserved);
  const hasExplicitBudget = String(process.env.MAX_DB_CONNECTIONS || "").trim() !== "";
  if (estimatedPeak > safeBudget && (hasExplicitBudget || process.env.NODE_ENV === "production")) {
    console.warn(
      `[db-capacity] Estimated peak connections ${estimatedPeak} exceed safe budget ${safeBudget}. Tune TENANT_POOL_MAX_TOTAL / TENANT_POOL_SIZE / MAX_DB_CONNECTIONS.`
    );
  }
}
validatePoolCapacityBudget();

function makeTenantConfig(row) {
  const useMain =
    row.use_main_credentials === 1 ||
    row.use_main_credentials === true ||
    !row.db_user;
  let password = useMain
    ? process.env.DB_PASSWORD || process.env.DB_PASS
    : row._decryptedPassword || null;
  if (!useMain) {
    if (password) {
      /* keep */
    } else if (row.db_pass_encrypted) {
      try {
        password = decrypt(row.db_pass_encrypted);
      } catch (e) {
        console.error("makeTenantConfig: decrypt db_pass_encrypted failed:", e.message);
        password = process.env.DB_PASSWORD || process.env.DB_PASS;
      }
    } else {
      password = process.env.DB_PASSWORD || process.env.DB_PASS;
    }
  }
  return {
    host: row.db_host,
    port: row.db_port || 3306,
    user: useMain ? process.env.DB_USER : row.db_user,
    password,
    database: row.db_name,
    waitForConnections: true,
    connectionLimit: perTenantConnectionLimit,
    queueLimit: 0,
    charset: "utf8mb4",
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

/**
 * @param {object} row - tenant_databases row with optional _decryptedPassword
 */
function getTenantPoolForRow(row) {
  if (!row?.db_name) {
    return mainPool;
  }
  const key = `t:${row.id || row.db_name}`;
  if (tenantPoolCache.has(key)) {
    // FIXED: 8 true LRU tracking by last access timestamp
    poolLastAccess.set(key, Date.now());
    return tenantPoolCache.get(key);
  }
  if (tenantPoolCache.size >= MAX_TENANT_POOLS) {
    let oldest = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [k, t] of poolLastAccess.entries()) {
      if (tenantPoolCache.has(k) && t < oldestTime) {
        oldestTime = t;
        oldest = k;
      }
    }
    if (!oldest) {
      oldest = tenantPoolCache.keys().next().value;
    }
    const oldP = oldest ? tenantPoolCache.get(oldest) : null;
    try {
      if (oldP) oldP.end();
    } catch {
      /* ignore */
    }
    if (oldest) {
      tenantPoolCache.delete(oldest);
      poolLastAccess.delete(oldest);
    }
  }
const cfg = makeTenantConfig(row);
const tenantSsl = getMysqlSslForDedicatedTenantDb();
if (tenantSsl) cfg.ssl = tenantSsl;
  const tPool = mysql.createPool(cfg);
  tenantPoolCache.set(key, tPool);
  poolLastAccess.set(key, Date.now());
  return tPool;
}

function removeTenantPoolByKey(tenantRowId) {
  const key = `t:${tenantRowId}`;
  if (!tenantPoolCache.has(key)) return;
  const p = tenantPoolCache.get(key);
  try {
    p.end();
  } catch {
    /* ignore */
  }
  tenantPoolCache.delete(key);
  poolLastAccess.delete(key);
}

function clearTenantPoolCache() {
  for (const [, p] of tenantPoolCache) {
    try {
      p.end();
    } catch {
      /* ignore */
    }
  }
  tenantPoolCache.clear();
  poolLastAccess.clear();
}

function getTenantPoolStats() {
  return {
    cachedPools: tenantPoolCache.size,
    maxPools: MAX_TENANT_POOLS,
    perTenantConnectionLimit,
    maxDbConnections: MAX_DB_CONNECTIONS,
  };
}

async function testConnection() {
  let conn;
  try {
    conn = await mainPool.getConnection();
    await conn.query("SELECT 1");
    console.log("✅ DB connected successfully");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
    console.error(
      "Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD (or DB_PASS), DB_NAME. For TLS: place CA at certs/ca.pem or set DB_SSL_CA / DB_SSL_CA_PATH, or DB_SSL_DISABLE=1 for plain local MySQL."
    );
    process.exit(1);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  mainPool,
  getMainPool: () => mainPool,
  pool,
  getCrmPool,
  runWithCrmPool,
  crmContext,
  getTenantPoolForRow,
  removeTenantPoolByKey,
  clearTenantPoolCache,
  getTenantPoolStats,
  getBasePoolConfig,
  buildMysqlSsl,
  getMysqlSslForDedicatedTenantDb,
  testConnection,
};
