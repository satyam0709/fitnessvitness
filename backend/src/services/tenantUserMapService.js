// backend/src/services/tenantUserMapService.js
// Clerk has been removed. Keep compatibility with legacy call-sites that
// still invoke tenant-user map helpers during signup/provisioning flows.

async function getMapsForClerkUser(_clerkUserId) {
  return [];
}

/**
 * Compatibility no-op: older flows call this after signup/user provisioning.
 * We keep it async and return a stable shape so callers don't throw.
 */
async function upsertTenantUserMap({ clerkUserId, tenantId, role, email } = {}) {
  return {
    success: true,
    stored: false,
    clerkUserId: clerkUserId || null,
    tenantId: tenantId || null,
    role: role || null,
    email: email || null,
    reason: "tenant_user_map_deprecated",
  };
}

module.exports = { getMapsForClerkUser, upsertTenantUserMap };