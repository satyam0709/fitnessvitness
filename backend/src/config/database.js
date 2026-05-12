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

/** Central / platform MySQL: tenants, users, billing, auth. */
const mainPool = mysql.createPool(
  getBasePoolConfig()
);

/**
 * Proxy for backward compatibility. In single-user mode, all operations use mainPool.
 */
const pool = mainPool;

async function testConnection() {
  let conn;
  try {
    conn = await mainPool.getConnection();
    await conn.query("SELECT 1");
    console.log("✅ DB connected successfully");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  mainPool,
  getMainPool: () => mainPool,
  pool,
  getBasePoolConfig,
  buildMysqlSsl,
  getMysqlSslForDedicatedTenantDb,
  testConnection,
};
