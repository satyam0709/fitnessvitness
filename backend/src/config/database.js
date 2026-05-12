const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const defaultCaPath = path.join(__dirname, "..", "..", "certs", "ca.pem");
const configuredCaPath = process.env.DB_SSL_CA_PATH
  ? path.resolve(process.cwd(), process.env.DB_SSL_CA_PATH)
  : defaultCaPath;

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

const mainPool = mysql.createPool(getBasePoolConfig());

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
  testConnection,
};