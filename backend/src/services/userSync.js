const { mainPool } = require("../config/database");
const { upsertTenantUserMap } = require("./tenantUserMapService");

/**
 * Load platform user by legacy Clerk external id (no external API calls).
 * @param {string} clerkUserId
 */
async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) return null;
  const [existing] = await mainPool.query(
    `SELECT u.id, u.clerk_user_id, u.email, u.first_name, u.last_name, u.profile_image, u.role, u.is_active,
            u.last_login, u.created_at, u.tenant_id,
            COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
            COALESCE(u.must_change_password, 0) AS must_change_password,
            COALESCE(NULLIF(TRIM(te.name), ''), te.company_name) AS tenant_name
     FROM users u
     LEFT JOIN tenants te ON te.id = u.tenant_id
     WHERE u.clerk_user_id = ?
     LIMIT 1`,
    [clerkUserId]
  );

  if (existing.length > 0) {
    const row = existing[0];
    if (row.tenant_id) {
      try {
        await upsertTenantUserMap({
          clerkUserId,
          tenantId: row.tenant_id,
          role: row.role,
          email: row.email,
        });
      } catch (e) {
        console.warn("ensureUserInDb tenant_user_map:", e.message);
      }
    }
    return row;
  }
  return null;
}

/**
 * @deprecated Clerk profile sync removed; returns DB row for id if present.
 */
async function syncUserProfileFromClerk(clerkUserId) {
  return ensureUserInDb(clerkUserId);
}

module.exports = { ensureUserInDb, syncUserProfileFromClerk };
