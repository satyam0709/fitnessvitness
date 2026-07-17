const prisma = require("../config/prisma");

async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) return null;
  const existing = await prisma.$queryRaw`SELECT u.id, u.clerk_user_id, u.email, u.first_name, u.last_name, u.profile_image, u.role, u.is_active,
            u.last_login, u.created_at,
            COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
            COALESCE(u.must_change_password, 0) AS must_change_password
     FROM users u
     WHERE u.clerk_user_id = ${clerkUserId}
     LIMIT 1`;

  return existing[0] || null;
}

module.exports = { ensureUserInDb };