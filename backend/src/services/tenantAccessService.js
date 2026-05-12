const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { getSubscription, setSubscription, delSubscription } = require("./subscriptionCache");
const { ensureTenantRbacInitialized } = require("./rbacService");
const { isPlatformSuperAdmin } = require("../middleware/platformAdmin");
const { sendWorkspaceCreatedEmail } = require("./resendEmailService");

function featureKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeFeatureMap(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  const out = {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item) continue;
      if (typeof item === "string") {
        out[featureKey(item)] = true;
        continue;
      }
      const key = featureKey(item.key || item.label || item.name);
      if (!key) continue;
      out[key] = item.included !== false;
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed)) {
      out[featureKey(k)] = Boolean(v);
    }
  }
  return out;
}

async function ensureTenantForUser(user) {
  if (user.tenant_id) return user.tenant_id;

  if (user.role === "admin") {
    const [ownedRows] = await mainPool.execute(
      `SELECT id FROM tenants WHERE owner_user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [user.id]
    );
    if (ownedRows.length) {
      const tid = ownedRows[0].id;
      await mainPool.execute(
        `UPDATE users SET tenant_id = ? WHERE id = ? AND (tenant_id IS NULL OR tenant_id = '')`,
        [tid, user.id]
      );
      return tid;
    }

    const clerkId = String(user.clerkUserId || user.clerk_user_id || "").trim();
    if (clerkId) {
      const [clerkOwned] = await mainPool.execute(
        `SELECT id FROM tenants WHERE owner_clerk_user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
        [clerkId]
      );
      if (clerkOwned.length) {
        const tid = clerkOwned[0].id;
        await mainPool.execute(
          `UPDATE users SET tenant_id = ? WHERE id = ? AND (tenant_id IS NULL OR tenant_id = '')`,
          [tid, user.id]
        );
        await mainPool.execute(
          `UPDATE tenants SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL`,
          [user.id, tid]
        );
        return tid;
      }
    }

    const forPlatformCheck = {
      role: user.role,
      tenant_id: user.tenant_id ?? user.tenantId ?? null,
      tenantId: user.tenantId ?? user.tenant_id ?? null,
      is_platform_admin: user.is_platform_admin,
    };
    if (!isPlatformSuperAdmin(forPlatformCheck)) {
      return null;
    }
  }

  const tenantId = crypto.randomUUID();
  const companyName =
    (user.first_name || user.last_name
      ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
      : user.email || "Workspace") + " Workspace";

  await mainPool.execute(
    `INSERT INTO tenants (id, company_name, owner_user_id, status, trial_ends_at)
     VALUES (?, ?, ?, 'pending_payment', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [tenantId, companyName.slice(0, 180), user.id]
  );
  await mainPool.execute("UPDATE users SET tenant_id = ? WHERE id = ? AND tenant_id IS NULL", [
    tenantId,
    user.id,
  ]);
  ensureTenantRbacInitialized(tenantId).catch((e) => console.error("ensureTenantRbacInitialized:", e.message));

  // Send the workspace created email
  setImmediate(async () => {
    try {
      await sendWorkspaceCreatedEmail({
        adminEmail: user.email,
        companyName,
        subdomain: process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || '365rndcrm.vercel.app',
        tenantId
      });
    } catch (err) {
      console.error("sendWorkspaceCreatedEmail failed:", err);
    }
  });

  return tenantId;
}

/**
 * Returns the existing subscription for a tenant from DB (or cache).
 * Returns null if no subscription exists yet.
 *
 * IMPORTANT: This function no longer auto-creates a trial subscription.
 * Subscriptions are only created in two places:
 *   1. POST /orders/start-trial  (via onTrialWorkspaceSubscription hook)
 *   2. POST /payment/checkout    (via onPaidWorkspaceSubscription hook)
 * Auto-creating here was causing new users to appear as "already trialed"
 * before they ever picked a plan on the add-package page.
 */
async function getExistingTenantSubscription(tenantId) {
  if (!tenantId) return null;

  const cached = await getSubscription(tenantId);
  if (cached) return cached;

  const [existing] = await mainPool.execute(
    `SELECT s.*, p.slug AS package_slug, p.name AS package_name, p.staff_seats, p.features_json
     FROM subscriptions s
     LEFT JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.tenant_id = ?
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [tenantId]
  );

  if (!existing.length) return null;

  const value = existing[0];
  const endsAtMs = value?.ends_at ? new Date(value.ends_at).getTime() : null;
  const isEnded = endsAtMs != null && !Number.isNaN(endsAtMs) && endsAtMs <= Date.now();

  if (isEnded && value.status !== "expired" && value.status !== "cancelled") {
    await mainPool.execute(
      `UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = ?`,
      [value.id]
    );
    value.status = "expired";
  }

  await setSubscription(tenantId, value);
  return value;
}

// Keep old name as an alias so nothing else breaks if it's imported elsewhere
const getOrCreateTenantSubscription = getExistingTenantSubscription;

async function loadTenantFeatureOverrides(tenantId) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT feature_key, is_enabled FROM tenant_features WHERE tenant_id = ?`,
      [tenantId]
    );
    const out = {};
    for (const r of rows) {
      const k = featureKey(r.feature_key);
      if (!k) continue;
      out[k] = Number(r.is_enabled) === 1;
    }
    return out;
  } catch {
    return {};
  }
}

async function loadActiveMarketplaceAddonKeys(tenantId) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT addon_key FROM tenant_marketplace_addons
       WHERE tenant_id = ? AND is_active = 1
         AND (valid_until IS NULL OR valid_until > NOW())`,
      [tenantId]
    );
    return rows.map((r) => String(r.addon_key || ""));
  } catch {
    return [];
  }
}

async function loadLatestTenantPackageRow(tenantId) {
  if (!tenantId) return null;
  const [rows] = await mainPool.execute(
    `SELECT package_name, max_users, status, valid_from, valid_until
     FROM tenant_packages
     WHERE tenant_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

function tenantPackageRowIsLive(tp) {
  if (!tp) return false;
  const st = String(tp.status || "").toLowerCase();
  if (!["trial", "active"].includes(st)) return false;
  if (tp.valid_until != null && String(tp.valid_until).trim() !== "") {
    const d = new Date(tp.valid_until);
    if (!Number.isNaN(d.getTime())) {
      const end = new Date(d);
      end.setUTCHours(23, 59, 59, 999);
      if (end.getTime() < Date.now()) return false;
    }
  }
  return true;
}

async function loadFeaturesJsonForPackageName(packageName) {
  const pn = String(packageName || "").trim();
  if (!pn) return null;
  try {
    const [rows] = await mainPool.execute(
      `SELECT features_json FROM subscription_packages
       WHERE LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?)
       LIMIT 1`,
      [pn, pn]
    );
    return rows[0]?.features_json ?? null;
  } catch {
    return null;
  }
}

async function tenantHasLiveBillingPackage(tenantId) {
  const tp = await loadLatestTenantPackageRow(tenantId);
  return tenantPackageRowIsLive(tp);
}

async function getTenantContextForUser(user) {
  const tenantId = await ensureTenantForUser(user);
  if (!tenantId) {
    return {
      tenantId: null,
      subscription: null,
      hasWorkspaceAccess: false,
      features: {},
      marketplaceAddons: [],
      seats: { used: 0, base: 0, addons: 0, total: 0 },
      tenantStatus: null,
    };
  }

  // Fetch tenant status
  let tenantStatus = null;
  try {
    const [[tenantRow]] = await mainPool.execute(
      "SELECT status FROM tenants WHERE id = ? LIMIT 1",
      [tenantId]
    );
    if (tenantRow) {
      tenantStatus = String(tenantRow.status || "").toLowerCase();
    }
  } catch (e) {
    console.warn("getTenantContextForUser: tenant status fetch:", e.message);
  }

  // Use the non-creating version - if no subscription exists yet (user hasn't
  // completed add-package flow), subscription will be null and hasWorkspaceAccess
  // will be false. That's correct - the add-package page handles this state.
  const subscription = await getExistingTenantSubscription(tenantId);
  const subStatus = String(subscription?.status || "").toLowerCase();
  const subEndsAtMs = subscription?.ends_at ? new Date(subscription.ends_at).getTime() : null;
  const subExpiredByDate =
    subEndsAtMs != null && !Number.isNaN(subEndsAtMs) && subEndsAtMs <= Date.now();
  const subscriptionLive = ["trial", "active"].includes(subStatus) && !subExpiredByDate;

  const tp = await loadLatestTenantPackageRow(tenantId);
  const packageAccessLive = tenantPackageRowIsLive(tp);
  const hasLiveSubscription = subscriptionLive || packageAccessLive;

  let featureSource = subscription?.features_json;
  if (hasLiveSubscription && !subscriptionLive && packageAccessLive && tp?.package_name) {
    const fromCatalog = await loadFeaturesJsonForPackageName(tp.package_name);
    if (fromCatalog != null) featureSource = fromCatalog;
  }
  const features = normalizeFeatureMap(featureSource || []);
  const overrides = await loadTenantFeatureOverrides(tenantId);
  for (const [k, enabled] of Object.entries(overrides)) {
    if (enabled) features[k] = true;
    else delete features[k];
  }
  const marketplaceAddons = await loadActiveMarketplaceAddonKeys(tenantId);

  const [[usedRow]] = await mainPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM users
     WHERE tenant_id = ?
       AND role IN ('staff','manager')
       AND is_active = 1`,
    [tenantId]
  );

  let baseSeats = 0;
  if (hasLiveSubscription) {
    if (packageAccessLive && tp && tp.max_users != null && Number(tp.max_users) > 0) {
      baseSeats = Number(tp.max_users);
    } else if (subscriptionLive) {
      baseSeats = Number(subscription?.staff_seats) || 0;
    } else {
      baseSeats = Number(subscription?.staff_seats) || 0;
    }
  }

  const addonSeats = 0;
  const usedSeats = Number(usedRow?.cnt) || 0;
  const effectiveFeatures = hasLiveSubscription ? features : {};
  const effectiveAddonKeys = hasLiveSubscription ? marketplaceAddons : [];
  const effectiveBaseSeats = hasLiveSubscription ? baseSeats : 0;
  const effectiveAddonSeats = hasLiveSubscription ? addonSeats : 0;

  return {
    tenantId,
    subscription,
    tenantStatus,
    hasWorkspaceAccess: hasLiveSubscription,
    features: effectiveFeatures,
    marketplaceAddons: effectiveAddonKeys,
    seats: {
      used: usedSeats,
      base: effectiveBaseSeats,
      addons: effectiveAddonSeats,
      total: effectiveBaseSeats + effectiveAddonSeats,
    },
  };
}

function invalidateSubscriptionCache(tenantId) {
  if (!tenantId) return;
  delSubscription(tenantId).catch(() => {});
}

module.exports = {
  featureKey,
  normalizeFeatureMap,
  getTenantContextForUser,
  invalidateSubscriptionCache,
  ensureTenantForUser,
  tenantHasLiveBillingPackage,
  getOrCreateTenantSubscription,
  getExistingTenantSubscription,
};