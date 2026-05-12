const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { emitAdminChanged, emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const {
  normalizeRole,
  evaluateWorkspaceInviteEmail,
  provisionWorkspaceMember,
} = require("../services/workspaceUserProvisioning");
const { invalidateSubscriptionCache } = require("../services/tenantAccessService");
const { enforceExpiredTenantUserAccess } = require("../services/trialSubscriptionJobs");
const {
  PACKAGE_RULES,
  normalizePackageName,
  toDisplayPackageName,
} = require("../services/provisionTenant");
const {
  sqlTenantOwnerStillResolvable,
  listOrphanTenantRows,
  purgeTenantWorkspace,
} = require("../services/workspacePurgeService");

const ALL_FEATURE_KEYS = [
  "lead_management",
  "tasks",
  "contacts",
  "meetings",
  "reminders",
  "integrations",
  "opportunities",
  "tickets",
  "companies",
  "analytics",
];

async function getAllTenants(req, res) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT
         t.id,
         COALESCE(NULLIF(TRIM(t.name), ''), t.company_name) AS name,
         t.slug,
         t.is_active,
         t.created_at,
        (CASE WHEN ${sqlTenantOwnerStillResolvable()} THEN 0 ELSE 1 END) AS owner_missing,
         (SELECT u.email FROM users u
            WHERE (u.clerk_user_id = t.owner_clerk_user_id OR u.id = t.owner_user_id)
            ORDER BY (u.clerk_user_id = t.owner_clerk_user_id) DESC
            LIMIT 1) AS owner_email,
         (SELECT TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) FROM users u
            WHERE (u.clerk_user_id = t.owner_clerk_user_id OR u.id = t.owner_user_id)
            ORDER BY (u.clerk_user_id = t.owner_clerk_user_id) DESC
            LIMIT 1) AS owner_name,
         tp.name AS tp_package_name,
         s.status AS tp_status,
         s.ends_at AS tp_valid_until,
         tp.staff_seats AS tp_max_users,
         (SELECT COUNT(*) FROM users u2 WHERE u2.tenant_id = t.id) AS user_count,
         (SELECT COUNT(*) FROM tenant_marketplace_addons m
            WHERE m.tenant_id = t.id AND m.is_active = 1) AS addon_count
       FROM tenants t
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2 WHERE s2.tenant_id = t.id ORDER BY s2.created_at DESC LIMIT 1
       )
       LEFT JOIN subscription_packages tp ON tp.id = s.package_id
       ORDER BY t.created_at DESC`
    );
    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      is_active: r.is_active,
      created_at: r.created_at,
      owner_missing: Number(r.owner_missing) === 1,
      owner_email: r.owner_email,
      owner_name: r.owner_name,
      plan: {
        package_name: r.tp_package_name || null,
        status: r.tp_status || null,
        valid_until: r.tp_valid_until || null,
        max_users: r.tp_max_users != null ? Number(r.tp_max_users) : null,
      },
      user_count: Number(r.user_count) || 0,
      addon_count: Number(r.addon_count) || 0,
    }));
    res.json({ success: true, total: data.length, data });
  } catch (err) {
    console.error("getAllTenants:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTenantDetail(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const [[tenantRow]] = await mainPool.execute(
      `SELECT t.id,
              COALESCE(NULLIF(TRIM(t.name), ''), t.company_name) AS name,
              t.slug, t.owner_clerk_user_id, t.is_active, t.created_at, t.company_name
       FROM tenants t WHERE t.id = ? LIMIT 1`,
      [id]
    );
    if (!tenantRow) return res.status(404).json({ success: false, message: "Tenant not found" });

    const [[tp]] = await mainPool.execute(
      `SELECT p.name AS package_name, p.staff_seats AS max_users, s.status, s.starts_at AS valid_from, s.ends_at AS valid_until
       FROM subscriptions s
       LEFT JOIN subscription_packages p ON p.id = s.package_id
       WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [id]
    );

    const [featRows] = await mainPool.execute(
      "SELECT feature_key, is_enabled FROM tenant_features WHERE tenant_id = ? ORDER BY feature_key",
      [id]
    );
    const featMap = new Map(featRows.map((f) => [f.feature_key, Number(f.is_enabled) === 1]));
    const features = ALL_FEATURE_KEYS.map((feature_key) => ({
      feature_key,
      is_enabled: Boolean(featMap.get(feature_key)),
    }));

    const [addons] = await mainPool.execute(
      `SELECT addon_key, is_active, valid_from, valid_until
       FROM tenant_marketplace_addons WHERE tenant_id = ?`,
      [id]
    );

    const [users] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, role, is_active, last_login
       FROM users
       WHERE tenant_id = ?
         AND COALESCE(is_platform_admin, 0) = 0
       ORDER BY created_at DESC`,
      [id]
    );

    const [[{ leads_count }]] = await mainPool.execute(
      "SELECT COUNT(*) AS leads_count FROM leads WHERE tenant_id = ? AND is_deleted = 0",
      [id]
    );
    const [[{ tasks_count }]] = await mainPool.execute(
      "SELECT COUNT(*) AS tasks_count FROM tasks WHERE tenant_id = ? AND is_deleted = 0",
      [id]
    );
    const [[{ meetings_count }]] = await mainPool.execute(
      "SELECT COUNT(*) AS meetings_count FROM meetings WHERE tenant_id = ? AND is_deleted = 0",
      [id]
    );
    const [[{ user_count }]] = await mainPool.execute("SELECT COUNT(*) AS user_count FROM users WHERE tenant_id = ?", [
      id,
    ]);

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenantRow.id,
          name: tenantRow.name,
          slug: tenantRow.slug,
          owner_clerk_user_id: tenantRow.owner_clerk_user_id,
          is_active: tenantRow.is_active,
          created_at: tenantRow.created_at,
        },
        package: tp
          ? {
              package_name: tp.package_name,
              max_users: tp.max_users,
              status: tp.status,
              valid_from: tp.valid_from,
              valid_until: tp.valid_until,
            }
          : null,
        features,
        addons: addons.map((a) => ({
          addon_key: a.addon_key,
          is_active: Number(a.is_active) === 1,
          valid_from: a.valid_from,
          valid_until: a.valid_until,
        })),
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          first_name: u.first_name,
          last_name: u.last_name,
          role: u.role,
          is_active: u.is_active,
          last_login: u.last_login,
        })),
        stats: {
          user_count: Number(user_count) || 0,
          leads_count: Number(leads_count) || 0,
          tasks_count: Number(tasks_count) || 0,
          meetings_count: Number(meetings_count) || 0,
        },
      },
    });
  } catch (err) {
    console.error("getTenantDetail:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleTenantActive(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const is_active = req.body?.is_active === undefined ? 1 : req.body.is_active ? 1 : 0;
    const [r] = await mainPool.execute("UPDATE tenants SET is_active = ?, updated_at = NOW() WHERE id = ?", [
      is_active,
      id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Tenant not found" });
    emitAdminChanged({ scope: "tenants", action: "toggle_active", tenantId: id });
    res.json({ success: true, is_active: Boolean(is_active) });
  } catch (err) {
    console.error("toggleTenantActive:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTenantPackage(req, res) {
  try {
    const tenantId = String(req.params.id || "").trim();
    const { status, package_name, valid_until, valid_from } = req.body || {};

    const [[subRow]] = await mainPool.execute(
      "SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1",
      [tenantId]
    );
    if (!subRow) return res.status(404).json({ success: false, message: "No subscription row for tenant" });

    if (package_name) {
      const [[pkg]] = await mainPool.execute(
        "SELECT id, features_json FROM subscription_packages WHERE LOWER(name) = ? OR LOWER(slug) = ? LIMIT 1",
        [String(package_name).trim().toLowerCase(), String(package_name).trim().toLowerCase()]
      );

      if (pkg) {
        await mainPool.execute(`UPDATE subscriptions SET package_id = ? WHERE id = ?`, [
          pkg.id,
          subRow.id,
        ]);

        let features = [];
        try {
          features = JSON.parse(pkg.features_json || "[]");
        } catch {
          // ignore
        }

        if (Array.isArray(features) && features.length) {
           const parsedFeatures = features.map(f => typeof f === "string" ? f : f.key || f.label || f.name).filter(Boolean);
           if (parsedFeatures.length) {
              const placeholders = parsedFeatures.map(() => "(?, ?, 1)").join(", ");
              const featParams = [];
              for (const fk of parsedFeatures) {
                featParams.push(tenantId, fk);
              }
              await mainPool.execute(
                `INSERT IGNORE INTO tenant_features (tenant_id, feature_key, is_enabled) VALUES ${placeholders}`,
                featParams
              );
           }
        }
      }
    }

    const sFields = [];
    const sParams = [];
    if (status && ["trial", "active", "expired", "cancelled", "suspended"].includes(String(status).toLowerCase())) {
      sFields.push("status = ?");
      sParams.push(String(status).toLowerCase() === "cancelled" ? "cancelled" : String(status).toLowerCase());
    }
    if (valid_from !== undefined) {
      sFields.push("starts_at = ?");
      sParams.push(valid_from || null);
    }
    if (valid_until !== undefined) {
      sFields.push("ends_at = ?");
      sParams.push(valid_until || null);
    }

    if (sFields.length) {
      sParams.push(subRow.id);
      await mainPool.execute(`UPDATE subscriptions SET ${sFields.join(", ")}, updated_at = NOW() WHERE id = ?`, sParams);
    }

    const normalizedStatus = status ? String(status).toLowerCase() : null;

    invalidateSubscriptionCache(tenantId);
    if (normalizedStatus === "expired" || normalizedStatus === "cancelled") {
      await enforceExpiredTenantUserAccess(tenantId);
    }
    emitAdminChanged({ scope: "tenants", action: "package", tenantId });
    res.json({ success: true });
  } catch (err) {
    console.error("updateTenantPackage:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTenantAddon(req, res) {
  try {
    const tenantId = String(req.params.id || "").trim();
    const addonKey = String(req.body?.addon_key || "").trim();
    if (!addonKey) return res.status(400).json({ success: false, message: "addon_key required" });
    const is_active = req.body?.is_active ? 1 : 0;
    const valid_until = req.body?.valid_until !== undefined ? req.body.valid_until : undefined;

    const [existing] = await mainPool.execute(
      "SELECT id FROM tenant_marketplace_addons WHERE tenant_id = ? AND addon_key = ? LIMIT 1",
      [tenantId, addonKey]
    );
    if (existing.length) {
      if (valid_until !== undefined) {
        await mainPool.execute(
          `UPDATE tenant_marketplace_addons SET is_active = ?, valid_until = ?, valid_from = COALESCE(valid_from, NOW())
           WHERE id = ?`,
          [is_active, valid_until || null, existing[0].id]
        );
      } else {
        await mainPool.execute(
          `UPDATE tenant_marketplace_addons SET is_active = ?, valid_from = COALESCE(valid_from, NOW()) WHERE id = ?`,
          [is_active, existing[0].id]
        );
      }
    } else {
      const nid = crypto.randomUUID();
      await mainPool.execute(
        `INSERT INTO tenant_marketplace_addons (id, tenant_id, addon_key, is_active, valid_from, valid_until)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [nid, tenantId, addonKey, is_active, valid_until !== undefined ? valid_until || null : null]
      );
    }
    emitAdminChanged({ scope: "tenants", action: "addon", tenantId });
    res.json({ success: true });
  } catch (err) {
    console.error("updateTenantAddon:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTenantFeature(req, res) {
  try {
    const tenantId = String(req.params.id || "").trim();
    const feature_key = String(req.body?.feature_key || "").trim();
    if (!feature_key) return res.status(400).json({ success: false, message: "feature_key required" });
    let is_enabled = 1;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "is_enabled")) {
      is_enabled = req.body.is_enabled ? 1 : 0;
    }

    await mainPool.execute(
      `INSERT INTO tenant_features (tenant_id, feature_key, is_enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = NOW()`,
      [tenantId, feature_key, is_enabled]
    );
    invalidateSubscriptionCache(tenantId);
    emitAdminChanged({ scope: "tenants", action: "feature", tenantId });
    res.json({ success: true });
  } catch (err) {
    console.error("updateTenantFeature:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function grantTenantTrial(req, res) {
  try {
    const tenantId = String(req.params.id || "").trim();
    const days = Math.min(90, Math.max(1, Number(req.body?.days) || 30));
    const [subRows] = await mainPool.execute(
      "SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1",
      [tenantId]
    );
    if (subRows.length) {
      await mainPool.execute(
        `UPDATE subscriptions
         SET status = 'trial', starts_at = NOW(), ends_at = DATE_ADD(NOW(), INTERVAL ? DAY), updated_at = NOW()
         WHERE id = ?`,
        [days, subRows[0].id]
      );
    }
    await mainPool.execute(
      "UPDATE tenants SET status = 'trial', trial_ends_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?",
      [days, tenantId]
    );
    invalidateSubscriptionCache(tenantId);
    emitAdminChanged({ scope: "tenants", action: "grant_trial", tenantId });
    res.json({ success: true, message: `Trial set for ${days} days` });
  } catch (err) {
    console.error("grantTenantTrial:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

function emitTenantUsersRealtime(tenantId, clerkUserId, reason) {
  emitWorkspaceAccessChanged({ tenantId, reason: reason || "users_changed" });
  if (clerkUserId && !String(clerkUserId).startsWith("pending:")) {
    emitWorkspaceAccessChanged({ clerkUserId, reason: reason || "users_changed" });
  }
}

async function adminCheckTenantUserEmail(req, res) {
  try {
    return res.status(403).json({
      success: false,
      message: "Cross-workspace user checks are disabled. Use /admin/workspace/users/check-email.",
    });
  } catch (err) {
    console.error("adminCheckTenantUserEmail:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminAddTenantUser(req, res) {
  try {
    return res.status(403).json({
      success: false,
      message: "Cross-workspace user creation is disabled. Use /admin/workspace/users.",
    });
  } catch (err) {
    console.error("adminAddTenantUser:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminCheckWorkspaceUserEmail(req, res) {
  try {
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) return res.status(400).json({ success: false, message: "Invalid tenant id" });
    const [[tenantRow]] = await mainPool.execute(
      `SELECT id, COALESCE(NULLIF(TRIM(name), ''), company_name, 'your workspace') AS workspace_name
       FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    if (!tenantRow) return res.status(404).json({ success: false, message: "Tenant not found" });
    const email = String(req.query?.email || "").trim().toLowerCase();
    const evaluated = await evaluateWorkspaceInviteEmail(tenantId, email);
    if (!evaluated.success) {
      return res.status(400).json({ success: false, message: evaluated.message || "Valid email is required." });
    }
    return res.json({
      success: true,
      available: evaluated.available,
      reason: evaluated.reason,
      message: evaluated.message,
      clerkAccountExists: evaluated.clerkAccountExists,
    });
  } catch (err) {
    console.error("adminCheckWorkspaceUserEmail:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminAddWorkspaceUser(req, res) {
  try {
    const tenantId = String(req.user?.tenantId || "").trim();
    if (!tenantId) return res.status(400).json({ success: false, message: "Invalid tenant id" });
    const [[tenantRow]] = await mainPool.execute(
      `SELECT id, COALESCE(NULLIF(TRIM(name), ''), company_name, 'your workspace') AS workspace_name
       FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    if (!tenantRow) return res.status(404).json({ success: false, message: "Tenant not found" });

    const clerkUserIdIn = String(req.body?.clerkUserId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const firstName = String(req.body?.firstName || "").trim() || null;
    const lastName = String(req.body?.lastName || "").trim() || null;
    const mobileRaw = req.body?.mobile || req.body?.phone || req.body?.mobile_number;
    const role = normalizeRole(req.body?.role);
    const tempPassword = String(req.body?.password || "").trim();
    const shouldSendWelcomeEmail = req.body?.sendWelcomeEmail !== false;
    if (!role) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const workspaceName =
      String(req.body?.workspaceName || "").trim() || tenantRow.workspace_name || "your workspace";

    const result = await provisionWorkspaceMember(req, {
      tenantId,
      invitedByUserId: Number(req.user?.id) || null,
      workspaceName,
      clerkUserId: clerkUserIdIn,
      email,
      firstName,
      lastName,
      mobileRaw,
      role,
      tempPassword,
      shouldSendWelcomeEmail,
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code,
        message: result.message,
      });
    }
    const { row, isPending, clerkUserId, mailStatus } = result;
    emitTenantUsersRealtime(tenantId, clerkUserId, "assigned");
    emitAdminChanged({ scope: "tenant_users", tenantId });
    return res.status(201).json({
      success: true,
      userKind: "workspace_member",
      workspaceTenantId: tenantId,
      packageSeatsEnforced: false,
      data: row,
      pending: isPending,
      mail: shouldSendWelcomeEmail ? mailStatus || { ok: false, reason: "skipped_or_missing_email" } : { ok: false, reason: "disabled" },
    });
  } catch (err) {
    console.error("adminAddWorkspaceUser:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listOrphanTenants(req, res) {
  try {
    const rows = await listOrphanTenantRows();
    res.json({
      success: true,
      total: rows.length,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        owner_clerk_user_id: t.owner_clerk_user_id,
        owner_user_id: t.owner_user_id,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    console.error("listOrphanTenants:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function purgeTenantWorkspaceEndpoint(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id" });
    const force = Boolean(req.body?.force) && String(req.body?.acknowledge || "") === "DELETE_WORKSPACE";
    const result = await purgeTenantWorkspace(id, { requireOrphan: !force });
    emitAdminChanged({ scope: "tenants", action: "workspace_purged", tenantId: id });
    emitWorkspaceAccessChanged({ tenantId: id, reason: "tenant_workspace_purged" });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.code === "OWNER_STILL_EXISTS") {
      return res.status(409).json({
        success: false,
        code: "OWNER_STILL_EXISTS",
        message:
          "This workspace still has a resolvable owner in the database. Purge aborted. To remove anyway, send { force: true, acknowledge: \"DELETE_WORKSPACE\" }.",
      });
    }
    console.error("purgeTenantWorkspaceEndpoint:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function purgeOrphansBatch(req, res) {
  try {
    const raw = req.body?.tenantIds;
    let ids;
    if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
      const rows = await listOrphanTenantRows();
      ids = rows.map((r) => String(r.id));
    } else if (Array.isArray(raw)) {
      ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Send tenantIds as an array of ids, omit the field, or use [] to purge every orphan workspace.',
      });
    }
    const dedup = ids;
    const purged = [];
    const errors = [];
    for (const tid of dedup) {
      try {
        const r = await purgeTenantWorkspace(tid, { requireOrphan: true });
        purged.push(tid);
        emitWorkspaceAccessChanged({ tenantId: tid, reason: "tenant_workspace_purged" });
      } catch (e) {
        if (e.code === "OWNER_STILL_EXISTS") {
          errors.push({ tenantId: tid, code: "OWNER_STILL_EXISTS", message: e.message });
        } else {
          errors.push({ tenantId: tid, message: e.message });
        }
      }
    }
    if (purged.length) {
      emitAdminChanged({ scope: "tenants", action: "workspace_purged_batch", tenantIds: purged, errorsCount: errors.length });
    }
    res.json({
      success: errors.length === 0,
      purged,
      errors,
      message:
        errors.length === 0
          ? `${purged.length} workspace(s) removed.`
          : `${purged.length} removed, ${errors.length} skipped or failed.`,
    });
  } catch (err) {
    console.error("purgeOrphansBatch:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function patchTenantProfile(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const { company_name, name, slug, is_active } = req.body || {};
    const fields = [];
    const params = [];
    if (company_name != null) {
      fields.push("company_name = ?");
      params.push(String(company_name).slice(0, 180));
    }
    if (name != null) {
      fields.push("name = ?");
      params.push(String(name).slice(0, 255));
    }
    if (slug != null) {
      fields.push("slug = ?");
      params.push(String(slug).slice(0, 120) || null);
    }
    if (is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }
    if (!fields.length) return res.status(400).json({ success: false, message: "Nothing to update" });
    params.push(id);
    await mainPool.execute(`UPDATE tenants SET ${fields.join(", ")}, updated_at = NOW() WHERE id = ?`, params);
    emitAdminChanged({ scope: "tenants", action: "profile", tenantId: id });
    res.json({ success: true });
  } catch (err) {
    console.error("patchTenantProfile:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getAllTenants,
  getTenantDetail,
  toggleTenantActive,
  updateTenantPackage,
  updateTenantAddon,
  updateTenantFeature,
  grantTenantTrial,
  patchTenantProfile,
  listOrphanTenants,
  purgeTenantWorkspaceEndpoint,
  purgeOrphansBatch,
  adminCheckTenantUserEmail,
  adminAddTenantUser,
  adminCheckWorkspaceUserEmail,
  adminAddWorkspaceUser,
};

