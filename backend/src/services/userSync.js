const prisma = require("../config/prisma");

async function ensureUserInDb(clerkUserId) {
  if (!clerkUserId) return null;
  return prisma.users.findFirst({
    where: { clerk_user_id: clerkUserId },
    select: {
      id: true,
      clerk_user_id: true,
      email: true,
      first_name: true,
      last_name: true,
      profile_image: true,
      role: true,
      is_active: true,
      last_login: true,
      created_at: true,
      is_platform_admin: true,
      must_change_password: true,
    },
  });
}

module.exports = { ensureUserInDb };
