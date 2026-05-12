const { featureKey } = require("../services/tenantAccessService");

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
    req.tenant = null;
    req.user.tenantId = null;
    req.user.tenant_id = null;
    req.tenantId = null;
    next();
  } catch (err) {
    console.error("resolveTenantContext:", err);
    res.status(500).json({ success: false, message: "Failed to resolve tenant context." });
  }
}

function enforceSubscription() {
  return (_req, _res, next) => next();
}

function requireFeature(feature, action = "view") {
  featureKey(feature);
  return (_req, _res, next) => next();
}

function requireAnyFeature(features = [], action = "view") {
  Array.isArray(features) ? features.map((f) => featureKey(f)) : [];
  void action;
  return (_req, _res, next) => next();
}

module.exports = {
  roleName,
  allowRoles,
  resolveTenantContext,
  enforceSubscription,
  requireFeature,
  requireAnyFeature,
};

