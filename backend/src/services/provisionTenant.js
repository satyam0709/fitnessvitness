const crypto = require("crypto");
const { mainPool } = require("../config/database");

const PACKAGE_RULES = {
  silver: { maxUsers: 3, features: ["lead_management", "tasks", "contacts"] },
  gold: {
    maxUsers: 10,
    features: [
      "lead_management",
      "tasks",
      "contacts",
      "meetings",
      "reminders",
      "integrations",
      "opportunities",
    ],
  },
  platinum: {
    maxUsers: 25,
    features: [
      "lead_management",
      "tasks",
      "contacts",
      "meetings",
      "reminders",
      "integrations",
      "opportunities",
      "tickets",
      "companies",
      "analytics",
    ],
  },
};

function normalizePackageName(raw) {
  const key = String(raw || "silver").trim().toLowerCase();
  if (!PACKAGE_RULES[key]) return "silver";
  return key;
}

function toDisplayPackageName(key) {
  if (key === "gold") return "Gold";
  if (key === "platinum") return "Platinum";
  return "Silver";
}

function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `tenant-${Date.now()}`;
}

async function uniqueTenantSlug(conn, tenantName) {
  const base = slugify(tenantName);
  let slug = base;
  let i = 1;
  while (true) {
    const [rows] = await conn.execute("SELECT id FROM tenants WHERE slug = ? LIMIT 1", [slug]);
    if (!rows.length) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

async function insertTenant(conn, tenantId, tenantName, slug, ownerClerkId) {
  const [nameCol] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'name'`
  );
  const [companyNameCol] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'company_name'`
  );

  if (nameCol.length && companyNameCol.length) {
    await conn.execute(
      `INSERT INTO tenants
        (id, name, company_name, slug, owner_clerk_user_id, is_active, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'trial', NOW(), NOW())`,
      [tenantId, tenantName, tenantName, slug, ownerClerkId || null]
    );
    return;
  }

  if (companyNameCol.length) {
    await conn.execute(
      `INSERT INTO tenants
        (id, company_name, slug, owner_clerk_user_id, is_active, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'trial', NOW(), NOW())`,
      [tenantId, tenantName, slug, ownerClerkId || null]
    );
    return;
  }

  await conn.execute(
    `INSERT INTO tenants
      (id, name, slug, owner_clerk_user_id, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, NOW())`,
    [tenantId, tenantName, slug, ownerClerkId || null]
  );
}

async function provisionTenant({
  tenantName,
  ownerClerkId,
  ownerClerkUserId,
  ownerEmail,
  ownerFirstName,
  ownerLastName,
  packageName,
}) {
  const normalizedTenantName = String(tenantName || "").trim();
  const normalizedOwnerClerkId = String(ownerClerkUserId || ownerClerkId || "").trim();
  if (!normalizedTenantName) {
    throw new Error("tenantName is required");
  }
  if (!normalizedOwnerClerkId) {
    throw new Error("ownerClerkUserId or ownerClerkId is required");
  }

  const packageKey = normalizePackageName(packageName);
  const pkg = PACKAGE_RULES[packageKey];
  const displayPackage = toDisplayPackageName(packageKey);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tenantId = crypto.randomUUID();
    const slug = await uniqueTenantSlug(conn, normalizedTenantName);

    await insertTenant(conn, tenantId, normalizedTenantName, slug, normalizedOwnerClerkId);

    await conn.execute(
      `INSERT INTO users
        (clerk_user_id, email, first_name, last_name, tenant_id, role, is_active)
       VALUES (?, ?, ?, ?, ?, 'admin', 1)
       ON DUPLICATE KEY UPDATE
        tenant_id = VALUES(tenant_id),
        role = 'admin',
        is_active = 1,
        email = COALESCE(VALUES(email), email),
        first_name = COALESCE(VALUES(first_name), first_name),
        last_name = COALESCE(VALUES(last_name), last_name),
        updated_at = NOW()`,
      [
        normalizedOwnerClerkId,
        ownerEmail ? String(ownerEmail).trim().toLowerCase() : null,
        ownerFirstName ? String(ownerFirstName).trim() : null,
        ownerLastName ? String(ownerLastName).trim() : null,
        tenantId,
      ]
    );

    await conn.execute(
      `INSERT INTO tenant_packages
        (tenant_id, package_name, max_users, valid_from, valid_until, status)
       VALUES (?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'trial')`,
      [tenantId, displayPackage, pkg.maxUsers]
    );

    if (pkg.features.length) {
      const placeholders = pkg.features.map(() => "(?, ?, 1)").join(", ");
      const params = [];
      for (const featureKey of pkg.features) {
        params.push(tenantId, featureKey);
      }
      await conn.execute(
        `INSERT IGNORE INTO tenant_features (tenant_id, feature_key, is_enabled)
         VALUES ${placeholders}`,
        params
      );
    }

    const [[ownerRow]] = await conn.execute("SELECT id FROM users WHERE clerk_user_id = ? LIMIT 1", [
      normalizedOwnerClerkId,
    ]);
    if (ownerRow?.id) {
      await conn.execute("UPDATE tenants SET owner_user_id = ? WHERE id = ?", [ownerRow.id, tenantId]);
    }

    await conn.commit();
    return {
      tenantId,
      slug,
      packageName: displayPackage,
      maxUsers: pkg.maxUsers,
      features: pkg.features,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  provisionTenant,
  PACKAGE_RULES,
  normalizePackageName,
  toDisplayPackageName,
};

