/** Tenant users who can see the whole team's CRM records (not only their own). */
function canSeeAllTeamRecords(req) {
  const r = String(req.user?.role || "");
  if (r === "admin" || r === "manager") return true;
  const slug = req.rbac?.roleSlug;
  if (slug === "tenant_admin" || slug === "manager") return true;
  return false;
}

module.exports = { canSeeAllTeamRecords };
