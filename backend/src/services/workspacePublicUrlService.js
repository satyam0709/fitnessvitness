const { mainPool } = require("../config/database");

/**
 * Public HTTPS base URL for a tenant workspace (same rules as /auth/me tenant_url).
 * @param {string|null} tenantId
 * @returns {Promise<{
 *   tenant_id: string|null,
 *   tenant_subdomain: string|null,
 *   workspace_base_url: string|null,
 *   workspace_dashboard_url: string|null,
 *   post_login_kind: 'workspace'|'apex'
 * }>}
 */
async function resolveWorkspacePublicRouting(tenantId) {
  if (!tenantId) {
    return {
      tenant_id: null,
      tenant_subdomain: null,
      workspace_base_url: null,
      workspace_dashboard_url: null,
      post_login_kind: "apex",
    };
  }
  const base = String(process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const [srows] = await mainPool.execute("SELECT slug FROM tenants WHERE id = ? LIMIT 1", [tenantId]);
  const [drows] = await mainPool.execute(
    "SELECT subdomain FROM tenant_databases WHERE tenant_id = ? AND status = 'active' LIMIT 1",
    [tenantId]
  );
  const tenant_subdomain = drows[0]?.subdomain || srows[0]?.slug || null;
  const workspace_base_url = tenant_subdomain ? `https://${tenant_subdomain}.${base}` : null;
  const workspace_dashboard_url = workspace_base_url ? `${workspace_base_url}/dashboard` : null;
  return {
    tenant_id: tenantId,
    tenant_subdomain,
    workspace_base_url,
    workspace_dashboard_url,
    post_login_kind: workspace_base_url ? "workspace" : "apex",
  };
}

module.exports = { resolveWorkspacePublicRouting };
