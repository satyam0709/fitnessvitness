const prisma = require("../config/prisma");

const userCache = new Map();
const USER_CACHE_TTL = 15000; // 15 seconds

function isAdminRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "owner" || r === "manager";
}

async function fetchUserRowById(userId) {
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && (now - cached.time < USER_CACHE_TTL)) {
    return cached.data;
  }

  const result = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      role: true,
      is_active: true,
      created_at: true,
      is_platform_admin: true,
      must_change_password: true,
    }
  });

  if (result) {
    // Map full_name as expected by legacy code
    const full_name = [result.first_name, result.last_name].filter(Boolean).join(" ");
    const mapped = { ...result, full_name };
    userCache.set(userId, { data: mapped, time: now });
    return mapped;
  }
  return null;
}

function clearUserCache(userId) {
  if (userId) {
    userCache.delete(userId);
  } else {
    userCache.clear();
  }
}

function mapUserRowToProfile(row, jwtRole) {
  if (!row) return null;
  const nameParts = String(row.full_name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const role = String(jwtRole || row.role || "staff").toLowerCase();

  return {
    ...row,
    first_name: firstName,
    last_name: lastName,
    role,
    is_platform_admin: Number(row.is_platform_admin) || 0,
    mustChangePassword: Number(row.must_change_password) === 1,
  };
}

module.exports = {
  fetchUserRowById,
  clearUserCache,
  mapUserRowToProfile,
  isAdminRole,
};
