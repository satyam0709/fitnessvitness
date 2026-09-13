/**
 * Prisma requires DATABASE_URL. Render / local often only set DB_HOST, DB_USER, etc.
 * Build DATABASE_URL once before any PrismaClient is constructed.
 */
function prismaPoolLimit() {
  const n = Number(process.env.PRISMA_CONNECTION_LIMIT);
  return Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : 5;
}

function prismaPoolTimeout() {
  const n = Number(process.env.PRISMA_POOL_TIMEOUT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 20;
}

/** Keep Prisma well under typical shared-host max_connections. */
function applyPrismaPoolParams(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return url;
  const limit = prismaPoolLimit();
  const timeout = prismaPoolTimeout();
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connection_limit")) {
      u.searchParams.set("connection_limit", String(limit));
    }
    if (!u.searchParams.has("pool_timeout")) {
      u.searchParams.set("pool_timeout", String(timeout));
    }
    return u.toString();
  } catch {
    let next = url;
    if (!/[?&]connection_limit=/i.test(next)) {
      next += `${next.includes("?") ? "&" : "?"}connection_limit=${limit}`;
    }
    if (!/[?&]pool_timeout=/i.test(next)) {
      next += `${next.includes("?") ? "&" : "?"}pool_timeout=${timeout}`;
    }
    return next;
  }
}

function ensureDatabaseUrl() {
  const existing = String(process.env.DATABASE_URL || "").trim();
  if (existing) {
    process.env.DATABASE_URL = applyPrismaPoolParams(existing);
    return process.env.DATABASE_URL;
  }

  const host = String(process.env.DB_HOST || "").trim();
  const user = String(process.env.DB_USER || "").trim();
  const password = String(process.env.DB_PASSWORD || process.env.DB_PASS || "");
  const database = String(process.env.DB_NAME || "").trim();
  const port = String(process.env.DB_PORT || "3306").trim() || "3306";

  if (!host || !user || !database) {
    throw new Error(
      "DATABASE_URL is missing, and DB_HOST / DB_USER / DB_NAME are incomplete. Set DATABASE_URL or the DB_* vars."
    );
  }

  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  const base = `mysql://${auth}@${host}:${port}/${encodeURIComponent(database)}`;

  const sslDisabled =
    process.env.DB_SSL_DISABLE === "1" || process.env.DB_SSL_DISABLE === "true";
  const acceptInvalid =
    process.env.DB_SSL_REJECT_UNAUTHORIZED === "0" ||
    process.env.DB_SSL_REJECT_UNAUTHORIZED === "false";

  let url = base;
  if (!sslDisabled) {
    // Match mysql2 pool SSL: require TLS; optionally allow self-signed (Aiven local/dev).
    url += acceptInvalid ? "?sslaccept=accept_invalid_certs" : "?sslaccept=strict";
  }

  process.env.DATABASE_URL = applyPrismaPoolParams(url);
  return process.env.DATABASE_URL;
}

module.exports = { ensureDatabaseUrl, applyPrismaPoolParams };
