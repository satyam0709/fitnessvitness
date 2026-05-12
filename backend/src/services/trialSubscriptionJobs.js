const { mainPool } = require("../config/database");
const { invalidateSubscriptionCache } = require("./tenantAccessService");
const { sendEmailWithRetry } = require("./emailService");
const { emitWorkspaceAccessChanged, emitAdminChanged } = require("../realtime/meetingsRealtime");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keep tenant admins active, deactivate non-admin workspace users when subscription expires.
 * This ensures expired workspaces cannot continue usage by staff/manager accounts.
 */
async function enforceExpiredTenantUserAccess(tenantId) {
  if (!tenantId) return;
  const [toDeactivate] = await mainPool.execute(
    `SELECT id, clerk_user_id
     FROM users
     WHERE tenant_id = ?
       AND is_active = 1
       AND role IN ('manager','staff')`,
    [tenantId]
  );
  if (!toDeactivate.length) return;

  await mainPool.execute(
    `UPDATE users
     SET is_active = 0, updated_at = NOW()
     WHERE tenant_id = ?
       AND is_active = 1
       AND role IN ('manager','staff')`,
    [tenantId]
  );

  for (const u of toDeactivate) {
    if (u.clerk_user_id) {
      emitWorkspaceAccessChanged({ clerkUserId: u.clerk_user_id, reason: "subscription_expired" });
    }
  }
  emitAdminChanged({ scope: "tenant_users", tenantId, reason: "subscription_expired_auto_deactivate" });
}

async function sendTrialNoticeIfConfigured(payload) {
  const to = payload?.email;
  if (!to) return;
  let subject = "RND CRM subscription update";
  let text = "Your subscription status has changed.";
  if (payload.type === "trial_reminder") {
    subject = `Trial reminder: ${payload.days_left} day(s) left`;
    text = `Hi, your ${payload.company_name || "workspace"} trial expires in ${payload.days_left} day(s).`;
  } else if (payload.type === "trial_expired") {
    subject = "Trial expired";
    text = "Your trial has expired. Please upgrade to continue using RND CRM.";
  } else if (payload.type === "renewal_reminder") {
    subject = `Renewal reminder: ${payload.days_left} day(s) left`;
    text = `Hi, your subscription renews in ${payload.days_left} day(s).`;
  }
  const sent = await sendEmailWithRetry({
    to,
    subject,
    text,
    meta: payload,
  });
  if (!sent.ok) {
    console.warn(
      "trial/renewal email dispatch failed:",
      payload.type,
      payload.tenant_id,
      sent.reason || "unknown_reason",
      sent.detail || "no_detail"
    );
  }
}

async function runTrialSubscriptionSweep() {
  const [aboutToExpire] = await mainPool.execute(
    `SELECT s.id, s.tenant_id, s.ends_at, t.company_name, owner.email
     FROM subscriptions s
     LEFT JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN users owner ON owner.id = t.owner_user_id
     WHERE s.status = 'trial'
       AND s.ends_at IS NOT NULL
       AND DATE(s.ends_at) IN (DATE(DATE_ADD(NOW(), INTERVAL 3 DAY)), DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), DATE(NOW()))`
  );
  for (const row of aboutToExpire) {
    const endsAt = row.ends_at ? new Date(row.ends_at) : null;
    const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / DAY_MS) : 0;
    await sendTrialNoticeIfConfigured({
      type: "trial_reminder",
      tenant_id: row.tenant_id,
      company_name: row.company_name,
      email: row.email || null,
      days_left: daysLeft,
      trial_ends_at: row.ends_at,
    });
  }

  const [expired] = await mainPool.execute(
    `SELECT id, tenant_id
     FROM subscriptions
     WHERE status = 'trial'
       AND ends_at IS NOT NULL
       AND ends_at < NOW()`
  );
  if (expired.length) {
    const ids = expired.map((e) => e.id);
    const placeholders = ids.map(() => "?").join(",");
    await mainPool.execute(
      `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
       WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of expired) {
      invalidateSubscriptionCache(row.tenant_id);
      await enforceExpiredTenantUserAccess(row.tenant_id);
      await sendTrialNoticeIfConfigured({
        type: "trial_expired",
        tenant_id: row.tenant_id,
      });
    }
  }

  const [renewals] = await mainPool.execute(
    `SELECT s.id, s.tenant_id, s.ends_at, t.company_name, owner.email
     FROM subscriptions s
     LEFT JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN users owner ON owner.id = t.owner_user_id
     WHERE s.status = 'active'
       AND s.ends_at IS NOT NULL
       AND DATE(s.ends_at) IN (DATE(DATE_ADD(NOW(), INTERVAL 7 DAY)), DATE(DATE_ADD(NOW(), INTERVAL 3 DAY)), DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)))`
  );
  for (const row of renewals) {
    const endsAt = row.ends_at ? new Date(row.ends_at) : null;
    const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / DAY_MS) : 0;
    await sendTrialNoticeIfConfigured({
      type: "renewal_reminder",
      tenant_id: row.tenant_id,
      company_name: row.company_name,
      email: row.email || null,
      days_left: daysLeft,
      renewal_at: row.ends_at,
    });
  }

  const [activeExpired] = await mainPool.execute(
    `SELECT id, tenant_id
     FROM subscriptions
     WHERE status = 'active'
       AND ends_at IS NOT NULL
       AND ends_at < NOW()`
  );
  if (activeExpired.length) {
    const ids = activeExpired.map((e) => e.id);
    const placeholders = ids.map(() => "?").join(",");
    await mainPool.execute(
      `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
       WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of activeExpired) {
      invalidateSubscriptionCache(row.tenant_id);
      await enforceExpiredTenantUserAccess(row.tenant_id);
    }
  }
}

function startTrialSubscriptionJobs() {
  runTrialSubscriptionSweep().catch((err) => {
    console.warn("trial sweep initial run failed:", err.message);
  });
  const intervalMs = Math.max(15 * 60 * 1000, Number(process.env.TRIAL_SWEEP_INTERVAL_MS) || DAY_MS);
  setInterval(() => {
    runTrialSubscriptionSweep().catch((err) => {
      console.warn("trial sweep failed:", err.message);
    });
  }, intervalMs);
}

module.exports = { startTrialSubscriptionJobs, runTrialSubscriptionSweep, enforceExpiredTenantUserAccess };

