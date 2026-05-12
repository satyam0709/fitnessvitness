const { mainPool, removeTenantPoolByKey } = require("./database");
const { getTenantDataPoolForTenantId, getTenantDatabaseRow } = require("../services/tenantDatabaseService");
const { encrypt, decrypt } = require("./tenantCrypto");

const poolLastUsed = new Map();
const IDLE_MS = 30 * 60 * 1000;
const EVICT_INTERVAL_MS = 5 * 60 * 1000;

async function getTenantDatabaseRowSafe(tid) {
  try {
    return await getTenantDatabaseRow(tid);
  } catch (err) {
    // FIXED: 13 cleanup tracking state on tenant row read failure
    poolLastUsed.delete(tid);
    throw err;
  } finally {
    // FIXED: 13 periodic pruning handles stale entries and deleted tenants
  }
}

/**
 * Pooled MySQL for a tenant’s dedicated schema. Uses platform `tenant_databases` + optional encrypted credentials.
 * @param {string} tenantId
 * @returns {Promise<import("mysql2/promise").Pool>}
 */
async function getTenantDb(tenantId) {
  if (!tenantId) {
    return mainPool;
  }
  const p = await getTenantDataPoolForTenantId(tenantId);
  poolLastUsed.set(tenantId, Date.now());
  return p;
}

if (EVICT_INTERVAL_MS > 0) {
  setInterval(() => {
    const now = Date.now();
    (async () => {
      for (const [tid, last] of poolLastUsed.entries()) {
        if (now - last < IDLE_MS) {
          /* continue */
        } else {
          try {
            const row = await getTenantDatabaseRowSafe(tid);
            if (row?.id) {
              removeTenantPoolByKey(row.id);
            }
          } catch {
            /* ignore */
          }
          poolLastUsed.delete(tid);
        }
      }
    })().catch(() => {});
  }, EVICT_INTERVAL_MS).unref?.();
}

module.exports = {
  masterPool: mainPool,
  getTenantDb,
  encrypt,
  decrypt,
};
