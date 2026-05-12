/**
 * True for 365 RND platform operators (JWT /auth `is_platform_admin`).
 * Not the same as a tenant workspace user whose CRM role may be labeled "admin" in the UI.
 */
export function isPlatformSuperAdmin(user) {
  if (!user) return false;
  const v = user.is_platform_admin;
  if (v === true || v === 1) return true;
  return Number(v) === 1;
}
