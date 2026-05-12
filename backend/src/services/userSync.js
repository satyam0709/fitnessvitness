const { mainPool } = require("../config/database");

/**
 * Load platform user by Clerk external id.
 * @param {string} clerkUserId
 */
async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) return null;
  const [existing] = await mainPool.query(
    `SELECT u.id, u.clerk_user_id, u.email, u.first_name, u.last_name, u.profile_image, u.role, u.is_active,
            u.last_login, u.created_at,
            COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
            COALESCE(u.must_change_password, 0) AS must_change_password
     FROM users u
     WHERE u.clerk_user_id = ?
     LIMIT 1`,
    [clerkUserId]
  );

  return existing[0] || null;
}

module.exports = { ensureUserInDb };