/**
 * Company workspace leads: full CRM API access (subscription + feature gates).
 * Platform /admin UI remains gated on the frontend; backend does not expose /api/admin/* here.
 */
function isTenantWorkspaceLead(user) {
  if (!user) return false;
  const tid = user.tenantId ?? user.tenant_id ?? null;
  if (!tid || tid === "") return false;
  const role = String(user.role || "");
  return role === "admin" || role === "manager";
}

module.exports = { isTenantWorkspaceLead };
