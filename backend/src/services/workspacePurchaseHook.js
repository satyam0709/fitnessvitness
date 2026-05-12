const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { emitAdminChanged, emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const { delSubscription } = require("./subscriptionCache");
const {
  sendPackageTrialPendingVerificationEmail,
  sendPaymentPendingVerificationEmail,
  sendWorkspaceReadyEmail,
  sendPaymentDoneEmail,
} = require("./emailService");
const { sendPaymentSuccessEmail } = require("./resendEmailService");

const TRIAL_DAYS = 7;

function publicWorkspaceUrlFromTenantRow(tn) {
  if (!tn) return null;
  const sub = String(tn.subdomain || tn.slug || "").trim();
  if (!sub) return null;
  const base = String(process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const proto = String(process.env.WORKSPACE_PUBLIC_HTTP || "").trim() === "1" ? "http" : "https";
  return `${proto}://${sub}.${base}`;
}

function computeEndsAt(billingPeriod) {
  const date = new Date();
  const bp = String(billingPeriod || "year").toLowerCase();
  if (bp.includes("month")) date.setMonth(date.getMonth() + 1);
  else if (bp.includes("week")) date.setDate(date.getDate() + 7);
  else date.setFullYear(date.getFullYear() + 1);
  return date;
}

async function noteDbActivationIsManual(pkg, tenantId) {
  if (!pkg?.id || !tenantId) return;
  console.log(
    `[workspace-hook] plan ${pkg.id} selected for tenant ${tenantId}; DB activation remains super-admin controlled`
  );
}

async function emitActivationEvents(tenantId, userId, billing, planName, reason) {
  const [trows] = await mainPool.execute(
    "SELECT company_name, slug, subdomain FROM tenants WHERE id = ? LIMIT 1",
    [tenantId]
  );
  const tn = trows[0] || {};
  emitAdminChanged({
    scope: "tenants",
    action: "billing_activated",
    billing,
    tenantId,
    company_name: tn.company_name || null,
    subdomain: tn.subdomain || tn.slug || null,
    owner_user_id: Number(userId) || null,
    plan: planName,
  });
  emitWorkspaceAccessChanged({ tenantId, reason });
}

async function sendPackageStepEmail(userId, tenantId, planName, paymentType) {
  const [userRows] = await mainPool.execute(
    `SELECT email, first_name FROM users WHERE id = ? OR clerk_user_id = ? LIMIT 1`,
    [String(userId), String(userId)]
  );
  const user = userRows[0];
  if (!user?.email) {
    console.warn(`[workspace-hook] sendPackageStepEmail: user not found or no email, user_id=${userId}`);
    return;
  }

  const [tenantRows] = await mainPool.execute(
    `SELECT company_name, subdomain, slug, subdomain_status FROM tenants WHERE id = ? LIMIT 1`,
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) {
    console.warn(`[workspace-hook] sendPackageStepEmail: tenant not found, tenant_id=${tenantId}`);
    return;
  }

  const tenantUrl = publicWorkspaceUrlFromTenantRow(tenant);
  if (!tenantUrl) {
    console.warn(
      `[workspace-hook] sendPackageStepEmail: could not build URL, subdomain=${tenant.subdomain}, slug=${tenant.slug}, status=${tenant.subdomain_status}`
    );
    // Don't return - send email anyway with empty tenantUrl
  }

  const [dbRows] = await mainPool.execute(
    `SELECT id FROM tenant_databases WHERE tenant_id = ? AND status = 'active' LIMIT 1`,
    [tenantId]
  );
  const workspaceReady =
    String(tenant.subdomain_status || "").toLowerCase() === "active" && dbRows.length > 0;

  const mailer = workspaceReady
    ? sendWorkspaceReadyEmail
    : paymentType === "trial"
      ? sendPackageTrialPendingVerificationEmail
      : sendPaymentPendingVerificationEmail;

  const result = await mailer(user.email, {
    firstName: user.first_name || "there",
    companyName: tenant.company_name || "your workspace",
    tenantUrl,
    packageName: planName,
    loginEmail: user.email,
  });

  if (!result?.ok) {
    console.error(
      `[workspace-hook] package_step_email_failed user=${userId} tenant=${tenantId} type=${paymentType} reason=${
        result?.detail || result?.reason || "unknown"
      }`
    );
  } else {
    console.log(
      `[workspace-hook] package_step_email_sent user=${userId} tenant=${tenantId} type=${paymentType} ready=${workspaceReady} channel=${result.channel}`
    );
  }
}

async function resolveUserAndPackage(userId, packageName, context) {
  const [userRows] = await mainPool.execute(
    `SELECT id, tenant_id, email FROM users WHERE id = ? OR clerk_user_id = ? LIMIT 1`,
    [String(userId), String(userId)]
  );
  const user = userRows[0];
  if (!user?.tenant_id) {
    console.warn(`[workspace-hook] ${context}: user ${userId} has no tenant_id; skipping`);
    return {};
  }

  const [pkgRows] = await mainPool.execute(
    `SELECT id, name, slug, billing_period, staff_seats
     FROM subscription_packages
     WHERE (LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?)) AND is_active = 1
     LIMIT 1`,
    [String(packageName), String(packageName)]
  );
  const pkg = pkgRows[0];
  if (!pkg) {
    console.warn(`[workspace-hook] ${context}: package "${packageName}" not found; using name-only activation`);
  }
  return {
    user,
    tenantId: user.tenant_id,
    pkg,
    planName: pkg?.name || pkg?.slug || String(packageName),
  };
}

async function onPaidWorkspaceSubscription(userId, packageName) {
  if (!userId) {
    console.warn("[workspace-hook] onPaidWorkspaceSubscription called with no userId");
    return;
  }

  const { user, tenantId, pkg, planName } = await resolveUserAndPackage(
    userId,
    packageName,
    "paid"
  );
  if (!user || !tenantId) return;

  const endsAt = computeEndsAt(pkg?.billing_period);
  const subscriptionId = crypto.randomUUID();

  const conn = await mainPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO subscriptions (id, tenant_id, package_id, status, starts_at, ends_at)
       VALUES (?, ?, ?, 'active', NOW(), ?)
       ON DUPLICATE KEY UPDATE
         package_id = VALUES(package_id),
         status = 'active',
         starts_at = NOW(),
         ends_at = VALUES(ends_at),
         updated_at = NOW()`,
      [subscriptionId, tenantId, pkg?.id || null, endsAt]
    );
    await conn.execute(
      `UPDATE tenants SET plan = ?, status = 'active', updated_at = NOW() WHERE id = ?`,
      [planName, tenantId]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error(`[workspace-hook] paid transaction failed for tenant ${tenantId}:`, e.message);
    throw e;
  } finally {
    conn.release();
  }

  await delSubscription(tenantId).catch(() => {});
  console.log(`[workspace-hook] tenant ${tenantId} billing active; DB pending until super-admin activation`);

  try {
    await emitActivationEvents(tenantId, userId, "paid", planName, "subscription_activated");
  } catch (e) {
    console.warn("[workspace-hook] realtime emit:", e.message);
  }

  await noteDbActivationIsManual(pkg, tenantId);

  setImmediate(async () => {
    try {
      await sendPackageStepEmail(userId, tenantId, planName, "paid");
    } catch (e) {
      console.error("[workspace-hook] paid package-step email:", e.message);
    }
  });

  // Also send payment success confirmation email
  setImmediate(async () => {
    try {
      // Get user and tenant info for the payment success email
      const [userRows] = await mainPool.execute(
        `SELECT email, first_name FROM users WHERE id = ? OR clerk_user_id = ? LIMIT 1`,
        [String(userId), String(userId)]
      );
      const user = userRows[0];
      if (!user?.email) return;

      const [tenantRows] = await mainPool.execute(
        `SELECT company_name, subdomain, slug FROM tenants WHERE id = ? LIMIT 1`,
        [tenantId]
      );
      const tenant = tenantRows[0];
      if (!tenant) return;

      const tenantUrl = publicWorkspaceUrlFromTenantRow(tenant);
      
      // Fallback service
      await sendPaymentDoneEmail(user.email, {
        firstName: user.first_name || "there",
        packageName: planName,
        tenantUrl: tenantUrl || "",
        companyName: tenant.company_name || "your workspace",
      });

      // Resend service
      await sendPaymentSuccessEmail({
        adminEmail: user.email,
        companyName: tenant.company_name || "your workspace",
        subdomain: tenant.subdomain || tenant.slug || process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || '365rndcrm.vercel.app',
        plan: planName,
        workspaceUrl: tenantUrl || `https://${tenant.subdomain || tenant.slug || '365rndcrm.vercel.app'}`
      });
    } catch (e) {
      console.error("[workspace-hook] payment success email:", e.message);
    }
  });
}

async function onTrialWorkspaceSubscription(userId, packageName) {
  if (!userId) {
    console.warn("[workspace-hook] onTrialWorkspaceSubscription: no userId");
    return;
  }

  const { user, tenantId, pkg, planName } = await resolveUserAndPackage(
    userId,
    packageName,
    "trial"
  );
  if (!user || !tenantId) return;

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  const [existingSub] = await mainPool.execute(
    `SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  );

  const conn = await mainPool.getConnection();
  try {
    await conn.beginTransaction();
    if (existingSub[0]?.id) {
      await conn.execute(
        `UPDATE subscriptions
         SET package_id = ?, status = 'trial', starts_at = NOW(), ends_at = ?, updated_at = NOW()
         WHERE id = ?`,
        [pkg?.id || null, trialEndsAt, existingSub[0].id]
      );
    } else {
      await conn.execute(
        `INSERT INTO subscriptions (id, tenant_id, package_id, status, starts_at, ends_at)
         VALUES (?, ?, ?, 'trial', NOW(), ?)`,
        [crypto.randomUUID(), tenantId, pkg?.id || null, trialEndsAt]
      );
    }
    await conn.execute(
      `UPDATE tenants SET plan = ?, status = 'trial', trial_ends_at = ?, updated_at = NOW() WHERE id = ?`,
      [planName, trialEndsAt, tenantId]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error(`[workspace-hook] trial transaction failed for tenant ${tenantId}:`, e.message);
    throw e;
  } finally {
    conn.release();
  }

  await delSubscription(tenantId).catch(() => {});
  console.log(`[workspace-hook] tenant ${tenantId} trial active; DB pending until super-admin activation`);

  try {
    await emitActivationEvents(tenantId, userId, "trial", planName, "trial_started");
  } catch (e) {
    console.warn("[workspace-hook] trial realtime emit:", e.message);
  }

  await noteDbActivationIsManual(pkg, tenantId);

  setImmediate(async () => {
    try {
      await sendPackageStepEmail(userId, tenantId, planName, "trial");
    } catch (e) {
      console.error("[workspace-hook] trial package-step email:", e.message);
    }
  });
}

module.exports = { onPaidWorkspaceSubscription, onTrialWorkspaceSubscription };
