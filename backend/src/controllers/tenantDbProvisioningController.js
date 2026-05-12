const { mainPool } = require("../config/database");
const {
  getTenantDbStatus,
  submitTenantDbRequest,
  testTenantDbConnection,
  activateTenantExternalDatabase,
} = require("../services/tenantDatabaseService");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");

function normalizeBodyDb(body = {}) {
  return {
    db_host: body.db_host,
    db_port: body.db_port,
    db_name: body.db_name,
    db_user: body.db_user,
    db_password: body.db_password,
  };
}

async function assertTenantExists(tenantId) {
  const [rows] = await mainPool.execute("SELECT id FROM tenants WHERE id = ? LIMIT 1", [tenantId]);
  if (!rows.length) {
    const err = new Error("Tenant not found");
    err.status = 404;
    throw err;
  }
}

async function getTenantDatabaseStatus(req, res) {
  try {
    const { tenantId } = req.params;
    await assertTenantExists(tenantId);
    const status = await getTenantDbStatus(tenantId);
    res.json({ success: true, data: status });
  } catch (e) {
    const code = e.status || 500;
    res.status(code).json({ success: false, message: e.message || "Failed" });
  }
}

async function postTenantDatabaseTest(req, res) {
  try {
    const { tenantId } = req.params;
    await assertTenantExists(tenantId);
    const cfg = normalizeBodyDb(req.body || {});
    const result = await testTenantDbConnection(cfg);
    res.json({
      success: Boolean(result.ok),
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error || null,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

async function postTenantDatabaseActivate(req, res) {
  try {
    const { tenantId } = req.params;
    await assertTenantExists(tenantId);
    const cfg = normalizeBodyDb(req.body || {});
    await activateTenantExternalDatabase(tenantId, cfg);
    await mainPool.execute("UPDATE tenants SET subdomain_status = 'active' WHERE id = ?", [tenantId]);
    emitAdminChanged({ scope: "tenants", action: "database_activated", tenantId });
    res.json({ success: true, message: "Tenant database attached and active." });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || "Activation failed" });
  }
}

async function postTenantDatabaseRequest(req, res) {
  try {
    const { tenantId } = req.params;
    await assertTenantExists(tenantId);
    const cfg = normalizeBodyDb(req.body || {});
    const { id } = await submitTenantDbRequest(tenantId, cfg);
    await mainPool.execute("UPDATE tenants SET subdomain_status = 'pending' WHERE id = ?", [tenantId]);
    emitAdminChanged({ scope: "tenants", action: "database_request_submitted", tenantId });
    res.status(201).json({ success: true, request_id: id, message: "Request recorded for review." });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || "Request failed" });
  }
}

module.exports = {
  getTenantDatabaseStatus,
  postTenantDatabaseTest,
  postTenantDatabaseActivate,
  postTenantDatabaseRequest,
};
