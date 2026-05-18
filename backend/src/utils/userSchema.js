const { mainPool } = require("../config/database");

let usersColumnsCache = null;

async function getUsersColumns(pool = mainPool) {
  if (usersColumnsCache) return usersColumnsCache;
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  usersColumnsCache = new Set(rows.map((r) => r.COLUMN_NAME));
  return usersColumnsCache;
}

function clearUsersColumnsCache() {
  usersColumnsCache = null;
}

function userNameSelectSql(cols, alias = "u") {
  if (cols.has("full_name")) {
    return `${alias}.full_name`;
  }
  if (cols.has("first_name") || cols.has("last_name")) {
    return `TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)) AS full_name`;
  }
  return `'' AS full_name`;
}

function isAdminRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "owner" || r === "manager";
}

async function fetchUserRowById(userId, pool = mainPool) {
  const cols = await getUsersColumns(pool);
  if (!cols.size) return null;

  const nameSel = userNameSelectSql(cols, "u");
  const lastLogin = cols.has("last_login") ? "u.last_login" : "NULL AS last_login";
  const isPlatformAdmin = cols.has("is_platform_admin")
    ? "u.is_platform_admin"
    : "0 AS is_platform_admin";
  const mustChange = cols.has("must_change_password")
    ? "u.must_change_password"
    : "0 AS must_change_password";

  const [rows] = await pool.execute(
    `SELECT u.id, u.email, ${nameSel}, u.role, u.is_active,
            ${lastLogin}, u.created_at, ${isPlatformAdmin}, ${mustChange}
     FROM users u
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
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
  getUsersColumns,
  clearUsersColumnsCache,
  fetchUserRowById,
  mapUserRowToProfile,
  isAdminRole,
};
