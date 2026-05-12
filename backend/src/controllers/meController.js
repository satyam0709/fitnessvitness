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

async function getMeFeatures(req, res) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const featureMap = Object.fromEntries(PLATFORM_ALL_FEATURE_KEYS.map((k) => [k, true]));
    return res.json({
      success: true,
      data: {
        features: PLATFORM_ALL_FEATURE_KEYS,
        addons: [],
        planStatus: "active",
        seatsUsed: 1,
        seatsMax: 1,
        packageName: "Local CRM",
        validUntil: null,
        featureMap,
        isPlatformAdmin: Boolean(req.user.is_platform_admin),
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

    const rbacPerms = req.rbac?.permissions ? [...req.rbac.permissions] : [];

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          first_name: req.user.first_name || "",
          last_name: req.user.last_name || "",
          profile_image: req.user?.profile_image || null,
          must_change_password: Boolean(req.user.mustChangePassword),
          mustChangePassword: Boolean(req.user.mustChangePassword),
          role: req.user.role,
          tenant_id: null,
          invited_by: null,
          is_workspace_owner: true,
          is_platform_admin: Boolean(req.user.is_platform_admin),
          tenant_role_slug: "admin",
          permissions: rbacPerms,
        },
        subscription: {
          id: "local",
          status: "active",
          starts_at: new Date().toISOString(),
          ends_at: null,
          package_id: 1,
          package_slug: "local",
          package_name: "Local CRM",
        },
        features: Object.fromEntries(PLATFORM_ALL_FEATURE_KEYS.map((k) => [k, true])),
        seats: { used: 1, total: 1 },
        tenant_subdomain: null,
        tenant_url: null,
        onboarding_locked: false,
        workspace_verification: {
          ready: true,
          tenant_status: "active",
          database_status: "active",
          reason: null,
        },
        workspace_access_ready: true,
      },
    });
  } catch (err) {
    console.error("getMeContext:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getMeContext, getMeFeatures };

module.exports = { getMeContext, getMeFeatures };

