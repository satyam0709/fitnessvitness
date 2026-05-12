const { mainPool } = require("../config/database");
const { featureKey, getTenantContextForUser } = require("../services/tenantAccessService");
const { attachRbacToRequest } = require("./rbac");
const { isPlatformSuperAdmin } = require("./platformAdmin");
const { authDebug } = require("./authDebug");
const { isTenantWorkspaceLead } = require("./tenantWorkspace");

/** Tenant middleware expects `req.user` from JWT auth (`verifyToken`), not Clerk. */

/**
 * requireFeature("task_management") vs package keys like "tasks" — treat as equivalent.
 */
const FEATURE_SYNONYM_GROUPS = [
  ["task_management", "tasks"],
  ["lead_management", "leads"],
  ["reminders", "reminder", "meetings", "reminders_meetings"],
  ["calendar", "notes", "notes_calendar", "todos", "notifications", "dashboard"],
  ["customer_management", "contacts", "companies"],
  ["opportunities", "opportunity"],
  ["tickets", "support_tickets"],
  ["integrations", "integration"],
  ["basic_reports", "advanced_reports", "reports"],
  ["invoice_management", "invoices"],
  ["hr_management", "hr"],
  ["hr_operations_payroll", "payroll", "hr_operations"],
  ["advanced_analytics", "analytics"],
];

function tenantHasResolvedFeature(ctx, rawFeatureName) {
  const map = ctx?.features || {};
  const requested = featureKey(rawFeatureName);
  // Dashboard shell is a baseline workspace page once tenant access is granted.
  // Keep package gating for deeper modules, but avoid blocking /dashboard itself.
  if (requested === "dashboard") {
    return ctx?.hasWorkspaceAccess === true;
  }
  if (Boolean(map[requested])) return true;
  const group = FEATURE_SYNONYM_GROUPS.find((g) => g.some((x) => featureKey(x) === requested));
  if (!group) return false;
  return group.some((x) => Boolean(map[featureKey(x)]));
}

/** DB `staff_permissions.feature` may use catalog key (e.g. `tasks`) while routes use `task_management`. */
function synonymKeysForFeatureKey(keyed) {
  const requested = featureKey(keyed);
  const group = FEATURE_SYNONYM_GROUPS.find((g) => g.some((x) => featureKey(x) === requested));
  if (!group) return [requested];
  return [...new Set(group.map((x) => featureKey(x)))];
}

function roleName(raw) {
  if (raw === "admin") return "super_admin";
  if (raw === "manager") return "tenant_admin";
  if (raw === "staff") return "staff";
  return String(raw || "");
}

function allowRoles(roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const r = roleName(req.user?.role);
    if (!allowed.has(r)) {
      return res.status(403).json({ success: false, message: "Role not allowed for this route." });
    }
    next();
  };
}

async function resolveTenantContext(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const ctx = await getTenantContextForUser(req.user);
    req.tenant = ctx;
    req.user.tenantId = ctx.tenantId;
    if (ctx.tenantId) req.user.tenant_id = ctx.tenantId;
    req.tenantId = ctx.tenantId || null;
    await attachRbacToRequest(req);
    next();
  } catch (err) {
    console.error("resolveTenantContext:", err);
    res.status(500).json({ success: false, message: "Failed to resolve tenant context." });
  }
}

function enforceSubscription() {
  return async (req, res, next) => {
    try {
      if (isPlatformSuperAdmin(req.user)) {
        authDebug("enforceSubscription:BYPASS", req, { rule: "platform_super_admin" });
        return next();
      }
      if (isTenantWorkspaceLead(req.user)) {
        authDebug("enforceSubscription:BYPASS", req, { rule: "tenant_workspace_lead" });
        return next();
      }
      
      // Check tenant status first
      const tenantStatus = req.tenant?.tenantStatus || req.user?.tenantStatus;
      if (tenantStatus === "pending_payment") {
        authDebug("enforceSubscription:BLOCK", req, {
          reason: "tenant_pending_payment",
          tenantStatus,
        });
        return res.status(402).json({
          success: false,
          code: "PENDING_PAYMENT",
          message: "Please complete your payment to access this workspace. Visit the add-package page to select a plan.",
        });
      }
      
      if (req.tenant?.hasWorkspaceAccess === true) {
        authDebug("enforceSubscription:OK", req, { rule: "tenant_packages_or_subscription" });
        return next();
      }
      const sub = req.tenant?.subscription;
      const status = String(sub?.status || "").toLowerCase();
      if (!["trial", "active"].includes(status)) {
        authDebug("enforceSubscription:BLOCK", req, {
          reason: "subscription_status",
          status: sub?.status ?? null,
        });
        return res.status(402).json({
          success: false,
          message: "Subscription inactive. Please renew or upgrade your plan.",
        });
      }
      if (sub?.ends_at && new Date(sub.ends_at).getTime() < Date.now()) {
        authDebug("enforceSubscription:BLOCK", req, { reason: "subscription_ended", ends_at: sub.ends_at });
        return res.status(402).json({
          success: false,
          message: "Subscription expired. Please upgrade your plan.",
        });
      }
      authDebug("enforceSubscription:OK", req, { status });
      next();
    } catch (err) {
      console.error("enforceSubscription:", err);
      res.status(500).json({ success: false, message: "Subscription validation failed." });
    }
  };
}

function requireFeature(feature, action = "view") {
  const key = featureKey(feature);
  return async (req, res, next) => {
    try {
      if (isPlatformSuperAdmin(req.user)) {
        authDebug("requireFeature:BYPASS", req, { rule: "platform_super_admin", feature: key, action });
        return next();
      }
      if (isTenantWorkspaceLead(req.user)) {
        authDebug("requireFeature:BYPASS", req, { rule: "tenant_workspace_lead", feature: key, action });
        return next();
      }
      const enabled = tenantHasResolvedFeature(req.tenant, feature);
      if (!enabled) {
        authDebug("requireFeature:BLOCK", req, {
          reason: "feature_not_in_package",
          feature: key,
          resolvedKeys: FEATURE_SYNONYM_GROUPS.find((g) => g.some((x) => featureKey(x) === key)) || [key],
        });
        return res.status(403).json({
          success: false,
          message: `Feature '${key}' is not enabled in your package.`,
        });
      }
      if (roleName(req.user?.role) !== "staff") {
        authDebug("requireFeature:OK", req, { feature: key, action, role: req.user?.role });
        return next();
      }

      const permKeys = synonymKeysForFeatureKey(key);
      const ph = permKeys.map(() => "?").join(",");
      const [rows] = await mainPool.execute(
        `SELECT can_view, can_create, can_edit, can_delete
         FROM staff_permissions
         WHERE tenant_id = ? AND user_id = ? AND feature IN (${ph})
         LIMIT 1`,
        [req.user.tenantId, req.user.id, ...permKeys]
      );
      if (!rows.length) {
        if (action === "view") {
          authDebug("requireFeature:OK", req, {
            feature: key,
            action,
            rule: "staff_default_view_when_no_row",
          });
          return next();
        }
        authDebug("requireFeature:BLOCK", req, { reason: "staff_no_permissions_row", feature: key, action });
        return res.status(403).json({ success: false, message: "Staff permission denied." });
      }
      const row = rows[0];
      const map = {
        view: row.can_view,
        create: row.can_create,
        edit: row.can_edit,
        delete: row.can_delete,
      };
      if (!map[action]) {
        authDebug("requireFeature:BLOCK", req, { reason: "staff_action_denied", feature: key, action });
        return res.status(403).json({ success: false, message: `No ${action} permission for ${key}.` });
      }
      authDebug("requireFeature:OK", req, { feature: key, action, role: "staff" });
      next();
    } catch (err) {
      console.error("requireFeature:", err);
      res.status(500).json({ success: false, message: "Feature permission check failed." });
    }
  };
}

function requireAnyFeature(features = [], action = "view") {
  const keys = Array.isArray(features)
    ? features.map((f) => featureKey(f)).filter(Boolean)
    : [];
  return async (req, res, next) => {
    try {
      if (isPlatformSuperAdmin(req.user)) {
        authDebug("requireAnyFeature:BYPASS", req, { rule: "platform_super_admin", keys });
        return next();
      }
      if (isTenantWorkspaceLead(req.user)) {
        authDebug("requireAnyFeature:BYPASS", req, { rule: "tenant_workspace_lead", keys });
        return next();
      }
      if (!keys.length) {
        return res.status(403).json({ success: false, message: "No feature configured for this route." });
      }

      const enabledKeys = keys.filter((k) => tenantHasResolvedFeature(req.tenant, k));
      if (!enabledKeys.length) {
        authDebug("requireAnyFeature:BLOCK", req, { reason: "no_enabled_features", keys });
        return res.status(403).json({
          success: false,
          message: `None of these features are enabled in your package: ${keys.join(", ")}`,
        });
      }

      if (roleName(req.user?.role) !== "staff") {
        authDebug("requireAnyFeature:OK", req, { keys: enabledKeys, action, role: req.user?.role });
        return next();
      }

      const permFeatureKeys = [
        ...new Set(enabledKeys.flatMap((k) => synonymKeysForFeatureKey(k))),
      ];
      const placeholders = permFeatureKeys.map(() => "?").join(",");
      const [rows] = await mainPool.execute(
        `SELECT feature, can_view, can_create, can_edit, can_delete
         FROM staff_permissions
         WHERE tenant_id = ? AND user_id = ? AND feature IN (${placeholders})`,
        [req.user.tenantId, req.user.id, ...permFeatureKeys]
      );

      if (!rows.length) {
        if (action === "view") {
          authDebug("requireAnyFeature:OK", req, {
            keys: enabledKeys,
            action,
            rule: "staff_default_view_when_no_row",
          });
          return next();
        }
        authDebug("requireAnyFeature:BLOCK", req, {
          reason: "staff_no_permissions_row",
          keys: enabledKeys,
          action,
        });
        return res.status(403).json({ success: false, message: "Staff permission denied." });
      }

      const actionMap = {
        view: "can_view",
        create: "can_create",
        edit: "can_edit",
        delete: "can_delete",
      };
      const column = actionMap[action] || "can_view";
      const permitted = rows.some((r) => Number(r[column]) === 1);
      if (!permitted) {
        authDebug("requireAnyFeature:BLOCK", req, {
          reason: "staff_action_denied",
          keys: enabledKeys,
          action,
        });
        return res.status(403).json({
          success: false,
          message: `No ${action} permission for enabled features (${enabledKeys.join(", ")}).`,
        });
      }
      authDebug("requireAnyFeature:OK", req, { keys: enabledKeys, action, role: "staff" });
      next();
    } catch (err) {
      console.error("requireAnyFeature:", err);
      res.status(500).json({ success: false, message: "Feature permission check failed." });
    }
  };
}

module.exports = {
  roleName,
  allowRoles,
  resolveTenantContext,
  enforceSubscription,
  requireFeature,
  requireAnyFeature,
};

