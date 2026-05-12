const { mainPool } = require("../config/database");

/** Subdomain routing only; does not depend on Clerk or `req.user`. */

function getHost(req) {
  return String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(":")[0]
    .toLowerCase();
}

/**
 * @param {string} host
 * @param {string} baseDomain e.g. 365rndcrm.vercel.app
 * @returns {string|null} first label (subdomain) or null
 */
function parseSubdomainFromHost(host, baseDomain) {
  if (!host) return null;
  if (host === "localhost" || host === "127.0.0.1") return null;
  if (!baseDomain) return null;
  const b = String(baseDomain).toLowerCase().split(":")[0];
  if (host === b) return null;
  if (host.endsWith(`.${b}`)) {
    const sub = host.slice(0, -(b.length + 1));
    if (sub && !sub.includes(".")) {
      return sub;
    }
  }
  return null;
}

/**
 * Resolves `req.tenantSubdomain` and optional `req.tenantFromSubdomain` metadata.
 * Subdomain is also accepted via `X-Tenant-Subdomain` (e.g. when the API is not same-origin).
 */
async function subdomainMiddleware(req, res, next) {
  try {
    const base = process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app";
    const host = getHost(req);
    const headerSub = (
      req.get("x-tenant-subdomain") ||
      req.get("x-tenant-slug") ||
      req.get("x-subdomain") ||
      ""
    )
      .trim()
      .toLowerCase();
    const fromHost = parseSubdomainFromHost(host, base);
    req.tenantSubdomain = headerSub || fromHost || null;
    if (!req.tenantSubdomain) {
      return next();
    }
    const [rows] = await mainPool.execute(
      "SELECT id, tenant_id, subdomain, status, db_name FROM tenant_databases WHERE subdomain = ? LIMIT 1",
      [req.tenantSubdomain]
    );
    if (rows.length) {
      req.tenantFromSubdomain = rows[0];
    } else if (process.env.TENANT_UNKNOWN_SUBDOMAIN_BEHAVIOR === "404") {
      const url = String(req.originalUrl || req.url || "");
      if (url.includes("/api/health")) {
        return next();
      }
      return res.status(404).json({ success: false, message: "Unknown workspace" });
    }
    next();
  } catch (e) {
    console.warn("subdomainMiddleware:", e.message);
    next();
  }
}

module.exports = { subdomainMiddleware, parseSubdomainFromHost, getHost };
