// backend/src/services/subdomainService.js
const crypto = require("crypto");
const { mainPool } = require("../config/database");

function toSlug(name = "") {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function isAvailable(slug) {
  const [rows] = await mainPool.execute(
    "SELECT id FROM tenants WHERE subdomain = ? OR slug = ? LIMIT 1",
    [slug, slug]
  );
  return rows.length === 0;
}

async function reserveSubdomain(companyName) {
  const base = toSlug(companyName) || "workspace";

  if (await isAvailable(base)) return base;

  for (let i = 2; i <= 9; i++) {
    const c = `${base}-${i}`;
    if (await isAvailable(c)) return c;
  }

  for (let a = 0; a < 10; a++) {
    const c = `${base}-${crypto.randomBytes(2).toString("hex")}`;
    if (await isAvailable(c)) return c;
  }

  throw new Error(`Could not reserve subdomain for "${companyName}"`);
}

module.exports = { reserveSubdomain, toSlug };