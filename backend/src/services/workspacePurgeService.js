/**
 * Hard-remove a workspace (tenant) from the platform DB when the owner record
 * no longer exists (orphan), or when explicitly purging by platform admin.
 *
 * Does not drop external MySQL databases — only metadata in tenant_databases
 * (removed when the tenant row is deleted or via CASCADE).
 */

const { mainPool } = require("../config/database");
const { invalidateTenantDbCache } = require("./tenantDatabaseService");
const { invalidateSubscriptionCache } = require("./tenantAccessService");

/** EXISTS: a users row still resolves this tenant's owner (matches list-tenants semantics). */
function sqlTenantOwnerStillResolvable() {
  return `EXISTS (
    SELECT 1 FROM users u
    WHERE (
      (t.owner_clerk_user_id IS NOT NULL AND TRIM(COALESCE(t.owner_clerk_user_id, '')) <> ''
        AND u.clerk_user_id = t.owner_clerk_user_id)
      OR (t.owner_user_id IS NOT NULL AND u.id = t.owner_user_id)
    )
  )`;
}

const TENANT_COLUMN_TABLES = [
  "leads",
  "tasks",
  "contacts",
  "meetings",
  "notes",
  "reminders",
  "companies",
  "customers",
  "invoices",
  "crm_todos",
  "opportunities",
  "tickets",
];

async function safeExecute(conn, sql, params = []) {
  try {
    await conn.execute(sql, params);
  } catch (e) {
    const msg = String(e.message || "");
    const noTable =
      e.code === "ER_NO_SUCH_TABLE" ||
      e.errno === 1146 ||
      /doesn't exist/i.test(msg) ||
      /Unknown table/i.test(msg);
    if (noTable) return;
    throw e;
  }
}

async function hardDeleteUserGraph(conn, userId) {
  const uid = Number(userId);
  if (!uid) return;
  await safeExecute(conn, "DELETE FROM chat_thread_messages WHERE sender_id = ?", [uid]);
  await safeExecute(conn, "DELETE FROM chat_thread_members WHERE user_id = ?", [uid]);
  await safeExecute(conn, "DELETE FROM chat_messages WHERE sender_id = ?", [uid]);
  await safeExecute(conn, "DELETE FROM meetings WHERE organizer_id = ?", [uid]);
  await safeExecute(conn, "DELETE FROM reminders WHERE user_id = ?", [uid]);
  await safeExecute(conn, "DELETE FROM crm_todos WHERE created_by = ?", [uid]);
  await safeExecute(conn, "UPDATE reminders SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [uid]);
  await safeExecute(conn, "UPDATE meetings SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [uid]);
  await safeExecute(conn, "UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?", [uid]);
}

async function listOrphanTenantRows() {
  const [rows] = await mainPool.execute(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(t.name), ''), t.company_name) AS name,
            t.slug,
            t.owner_clerk_user_id,
            t.owner_user_id,
            t.created_at
     FROM tenants t
     WHERE NOT (${sqlTenantOwnerStillResolvable()})
    `
  );
  return rows;
}

/** Re-run resolvability check inside a transaction (consistent read). */
async function tenantOwnerStillResolvableConn(conn, tenantId) {
  const [[row]] = await conn.execute(
    `SELECT (${sqlTenantOwnerStillResolvable()}) AS ok
     FROM tenants t
     WHERE t.id = ?
     LIMIT 1`,
    [tenantId]
  );
  return row && Number(row.ok) === 1;
}

/**
 * Permanently delete tenant + all members + platform metadata + main-DB CRM rows for tenant_id.
 * @param {string} tenantId
 * @param {{ requireOrphan?: boolean }} options
 */
async function purgeTenantWorkspace(tenantId, options = {}) {
  const id = String(tenantId || "").trim();
  if (!id) throw new Error("tenantId is required");

  await invalidateTenantDbCache(id);

  const conn = await mainPool.getConnection();
  try {
    await conn.beginTransaction();

    const [[exists]] = await conn.execute("SELECT id FROM tenants WHERE id = ? LIMIT 1", [id]);
    if (!exists) {
      await conn.rollback();
      return { ok: true, alreadyGone: true };
    }

    if (options.requireOrphan !== false) {
      const still = await tenantOwnerStillResolvableConn(conn, id);
      if (still) {
        await conn.rollback();
        const err = new Error("OWNER_STILL_EXISTS");
        err.code = "OWNER_STILL_EXISTS";
        throw err;
      }
    }

    await conn.query("SET FOREIGN_KEY_CHECKS=0");

    await safeExecute(conn, "DELETE FROM rbac_audit_log WHERE organization_id = ?", [id]);

    await safeExecute(
      conn,
      `DELETE orp FROM org_role_permissions orp
       INNER JOIN org_roles r ON r.id = orp.role_id
       WHERE r.organization_id = ?`,
      [id]
    );
    await safeExecute(conn, "DELETE FROM organization_members WHERE organization_id = ?", [id]);
    await safeExecute(conn, "DELETE FROM org_roles WHERE organization_id = ?", [id]);

    await safeExecute(conn, "DELETE FROM user_invitations WHERE tenant_id = ?", [id]);
    await safeExecute(conn, "DELETE FROM staff_permissions WHERE tenant_id = ?", [id]);
    await safeExecute(conn, "DELETE FROM subscriptions WHERE tenant_id = ?", [id]);
    await safeExecute(conn, "DELETE FROM tenant_addons WHERE tenant_id = ?", [id]);
    await safeExecute(conn, "DELETE FROM tenant_db_requests WHERE tenant_id = ?", [id]);

    for (const table of TENANT_COLUMN_TABLES) {
      await safeExecute(conn, `DELETE FROM \`${table}\` WHERE tenant_id = ?`, [id]);
    }

    const [userRows] = await conn.execute("SELECT id FROM users WHERE tenant_id = ?", [id]);
    for (const u of userRows) {
      await hardDeleteUserGraph(conn, u.id);
    }
    await safeExecute(conn, "DELETE FROM users WHERE tenant_id = ?", [id]);

    await safeExecute(conn, "DELETE FROM tenants WHERE id = ?", [id]);

    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.commit();

    invalidateSubscriptionCache(id);
    return { ok: true, purgedTenantId: id };
  } catch (e) {
    try {
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
    } catch (_) {}
    try {
      await conn.rollback();
    } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  sqlTenantOwnerStillResolvable,
  listOrphanTenantRows,
  purgeTenantWorkspace,
};
