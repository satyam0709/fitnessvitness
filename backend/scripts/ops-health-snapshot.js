#!/usr/bin/env node
require("dotenv").config();

const { mainPool, getTenantPoolStats } = require("../src/config/database");

async function run() {
  const started = Date.now();
  const [dbPing] = await mainPool.execute("SELECT 1 AS ok");
  const latencyMs = Date.now() - started;
  const [tenantDbStats] = await mainPool.execute(
    `SELECT status, COUNT(*) AS c
     FROM tenant_databases
     GROUP BY status`
  );
  const [pendingRequests] = await mainPool.execute(
    `SELECT COUNT(*) AS c
     FROM tenant_db_requests
     WHERE status = 'pending'`
  );

  const out = {
    timestamp: new Date().toISOString(),
    db_ok: dbPing?.[0]?.ok === 1,
    db_ping_latency_ms: latencyMs,
    tenant_pool_stats: getTenantPoolStats(),
    tenant_db_status_counts: tenantDbStats,
    pending_tenant_db_requests: Number(pendingRequests?.[0]?.c) || 0,
  };
  console.log(JSON.stringify(out, null, 2));
}

run()
  .then(async () => {
    await mainPool.end().catch(() => {});
  })
  .catch(async (error) => {
    console.error("[ops-health-snapshot] failed:", error.message);
    await mainPool.end().catch(() => {});
    process.exit(1);
  });
