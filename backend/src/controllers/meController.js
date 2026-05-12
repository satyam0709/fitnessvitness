const { getTenantContextForUser, tenantHasLiveBillingPackage } = require("../services/tenantAccessService");
const { resolveWorkspacePublicRouting } = require("../services/workspacePublicUrlService");
const { roleName } = require("../middleware/tenantAccess");
const { isPlatformSuperAdmin } = require("../middleware/platformAdmin");
const { mainPool } = require("../config/database");

const PLATFORM_ALL_FEATURE_KEYS = [
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
  "opportunity_management",
  "customer_management",
  "task_management",
  "hr_management",
  "hr_operations_payroll",
];

function isOrderGrantingAccess(row, nowMs = Date.now()) {
  if (!row) return false;
  const status = String(row.status || "").toLowerCase();
  if (status === "active") return true;
  if (status !== "trial") return false;
  const createdMs = new Date(row.created_at).getTime();
  if (Number.isNaN(createdMs)) return false;
  const trialEndMs = createdMs + 7 * 24 * 60 * 60 * 1000;
  return trialEndMs > nowMs;
}

async function computeOnboardingLocked(reqUser) {
  if (!reqUser) return false;
  if (isPlatformSuperAdmin(reqUser)) return false;
  const role = String(reqUser.role || "").toLowerCase();
  if (!["admin", "manager"].includes(role)) return false;
  const tenantId = reqUser.tenant_id || reqUser.tenantId || null;
  if (!tenantId) return false;

  // Check tenant status - if pending_payment, lock onboarding
  const [tenantRows] = await mainPool.execute(
    "SELECT status FROM tenants WHERE id = ? LIMIT 1",
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (tenant && tenant.status === 'pending_payment') {
    return true;
  }

  // Source of truth: tenant subscription status (not only legacy orders table).
  const [subs] = await mainPool.execute(
    `SELECT status, ends_at
     FROM subscriptions
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const sub = subs[0];
  const forcePackageAfterSignup =
    process.env.FORCE_PACKAGE_AFTER_SIGNUP === "1" ||
    process.env.FORCE_PACKAGE_AFTER_SIGNUP === "true";
  if (sub) {
    const status = String(sub.status || "").toLowerCase();
    const endsAtMs = sub.ends_at ? new Date(sub.ends_at).getTime() : null;
    const expired = endsAtMs != null && !Number.isNaN(endsAtMs) && endsAtMs <= Date.now();
    if (forcePackageAfterSignup) {
      // Strict mode: keep onboarding lock until workspace is fully active (paid/activated),
      // even if trial exists. Useful for environments where package step is mandatory.
      return !(status === "active" && !expired);
    }
    if ((status === "trial" || status === "active") && !expired) {
      return false;
    }
  }

  if (!forcePackageAfterSignup) {
    const pkgOk = await tenantHasLiveBillingPackage(tenantId);
    if (pkgOk) return false;
  }

  // Fallback for legacy tenants that rely on orders-only trial/access.
  const [rows] = await mainPool.execute(
    `SELECT status, created_at
     FROM orders
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [String(reqUser.id)]
  );
  return !rows.some((r) => isOrderGrantingAccess(r));
}

async function getMeFeatures(req, res) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (isPlatformSuperAdmin(req.user)) {
      const featureMap = Object.fromEntries(PLATFORM_ALL_FEATURE_KEYS.map((k) => [k, true]));
      return res.json({
        success: true,
        data: {
          features: PLATFORM_ALL_FEATURE_KEYS,
          addons: [],
          planStatus: "active",
          seatsUsed: 0,
          seatsMax: 999,
          packageName: "Platform",
          validUntil: null,
          featureMap,
          isPlatformAdmin: true,
        },
      });
    }
    const ctx = await getTenantContextForUser(req.user);
    if (!ctx.tenantId) {
      return res.json({
        success: true,
        data: {
          features: [],
          addons: [],
          planStatus: "none",
          seatsUsed: 0,
          seatsMax: 0,
        },
      });
    }
    const features = Object.entries(ctx.features || {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
    const addons = Array.isArray(ctx.marketplaceAddons) ? ctx.marketplaceAddons : [];
    const sub = ctx.subscription;
    const planStatus = sub?.status ? String(sub.status) : "none";
    res.json({
      success: true,
      data: {
        features,
        addons,
        planStatus,
        seatsUsed: ctx.seats?.used ?? 0,
        seatsMax: ctx.seats?.total ?? 0,
        packageName: sub?.package_name || null,
        validUntil: sub?.ends_at || null,
        featureMap: ctx.features || {},
      },
    });
  } catch (err) {
    console.error("getMeFeatures:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMeContext(req, res) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const tenant = await getTenantContextForUser(req.user);
    let tenantSubdomain = null;
    let tenantUrl = null;
    if (tenant.tenantId) {
      const w = await resolveWorkspacePublicRouting(tenant.tenantId);
      tenantSubdomain = w.tenant_subdomain;
      tenantUrl = w.workspace_base_url;
    }

    const rbacPerms = req.rbac?.permissions ? [...req.rbac.permissions] : [];
    const onboardingLocked = await computeOnboardingLocked(req.user);

    let invitedBy = null;
    let isWorkspaceOwner = false;
    let workspaceVerification = {
      ready: true,
      tenant_status: null,
      database_status: null,
      reason: null,
    };
    try {
      const [[inviteRow]] = await mainPool.execute(
        "SELECT invited_by FROM users WHERE id = ? LIMIT 1",
        [req.user.id]
      );
      invitedBy = inviteRow?.invited_by ?? null;
      if (invitedBy == null) {
        const [[invitationRow]] = await mainPool.execute(
          `SELECT invited_by
           FROM user_invitations
           WHERE user_id = ?
           ORDER BY COALESCE(accepted_at, created_at) DESC, created_at DESC
           LIMIT 1`,
          [req.user.id]
        );
        invitedBy = invitationRow?.invited_by ?? null;
      }
      const currentTenantId = tenant.tenantId || req.user.tenant_id || req.user.tenantId || null;
      if (currentTenantId) {
        const [[ownerRow]] = await mainPool.execute(
          "SELECT owner_user_id, subdomain_status FROM tenants WHERE id = ? LIMIT 1",
          [currentTenantId]
        );
        isWorkspaceOwner =
          ownerRow?.owner_user_id != null &&
          String(ownerRow.owner_user_id) === String(req.user.id);
        const tenantStatus = String(ownerRow?.subdomain_status || "").toLowerCase() || null;

        const [[tenantDbRow]] = await mainPool.execute(
          "SELECT status FROM tenant_databases WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1",
          [currentTenantId]
        );
        const dbStatus = String(tenantDbRow?.status || "").toLowerCase() || null;

        const tenantReady = !tenantStatus || tenantStatus === "active";
        const dbReady = !dbStatus || dbStatus === "active";

        workspaceVerification = {
          ready: tenantReady && dbReady,
          tenant_status: tenantStatus,
          database_status: dbStatus,
          reason: !tenantReady
            ? "tenant_pending_verification"
            : !dbReady
              ? "database_pending_verification"
              : null,
        };
      }
    } catch (err) {
      // Keep /auth/me functional on environments where invited_by hasn't been migrated yet.
      console.warn("getMeContext invited_by lookup skipped:", err.message);
      invitedBy = null;
      isWorkspaceOwner = false;
      workspaceVerification = {
        ready: true,
        tenant_status: null,
        database_status: null,
        reason: null,
      };
    }

    // FIXED: 10 include profile fields in /auth/me payload to avoid extra /users/me request
    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          first_name: req.user.first_name || "",
          last_name: req.user.last_name || "",
          profile_image: req.crmUser?.profile_image || null,
          must_change_password: Boolean(req.user.mustChangePassword),
          mustChangePassword: Boolean(req.user.mustChangePassword),
          role: roleName(req.user.role),
          tenant_id: tenant.tenantId,
          invited_by: invitedBy,
          is_workspace_owner: isWorkspaceOwner,
          is_platform_admin: Boolean(req.user.is_platform_admin),
          tenant_role_slug: req.rbac?.roleSlug || null,
          permissions: rbacPerms,
        },
        subscription: tenant.subscription
          ? {
              id: tenant.subscription.id,
              status: tenant.subscription.status,
              starts_at: tenant.subscription.starts_at,
              ends_at: tenant.subscription.ends_at,
              package_id: tenant.subscription.package_id,
              package_slug: tenant.subscription.package_slug,
              package_name: tenant.subscription.package_name,
            }
          : null,
        features: tenant.features,
        seats: tenant.seats,
        tenant_subdomain: tenantSubdomain,
        tenant_url: tenantUrl,
        onboarding_locked: onboardingLocked,
        workspace_verification: workspaceVerification,
        workspace_access_ready: workspaceVerification.ready,
      },
    });
  } catch (err) {
    console.error("getMeContext:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getMeContext, getMeFeatures };

