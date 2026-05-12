const { mainPool } = require("../config/database");

/** Global permission codes: module.action style */
const PERMISSION_DEFINITIONS = [
  { code: "dashboard.view", module_name: "dashboard", action_name: "view" },
  { code: "dashboard.team_view", module_name: "dashboard", action_name: "team_view" },
  { code: "lead.view", module_name: "leads", action_name: "view" },
  { code: "lead.create", module_name: "leads", action_name: "create" },
  { code: "lead.edit", module_name: "leads", action_name: "edit" },
  { code: "lead.delete", module_name: "leads", action_name: "delete" },
  { code: "lead.assign", module_name: "leads", action_name: "assign" },
  { code: "opportunity.view", module_name: "opportunities", action_name: "view" },
  { code: "opportunity.create", module_name: "opportunities", action_name: "create" },
  { code: "opportunity.edit", module_name: "opportunities", action_name: "edit" },
  { code: "opportunity.delete", module_name: "opportunities", action_name: "delete" },
  { code: "ticket.view", module_name: "tickets", action_name: "view" },
  { code: "ticket.create", module_name: "tickets", action_name: "create" },
  { code: "ticket.edit", module_name: "tickets", action_name: "edit" },
  { code: "ticket.close", module_name: "tickets", action_name: "close" },
  { code: "task.view", module_name: "tasks", action_name: "view" },
  { code: "task.create", module_name: "tasks", action_name: "create" },
  { code: "task.edit", module_name: "tasks", action_name: "edit" },
  { code: "task.delete", module_name: "tasks", action_name: "delete" },
  { code: "reminder.view", module_name: "reminders", action_name: "view" },
  { code: "reminder.create", module_name: "reminders", action_name: "create" },
  { code: "reminder.edit", module_name: "reminders", action_name: "edit" },
  { code: "reminder.delete", module_name: "reminders", action_name: "delete" },
  { code: "meeting.view", module_name: "meetings", action_name: "view" },
  { code: "meeting.create", module_name: "meetings", action_name: "create" },
  { code: "meeting.edit", module_name: "meetings", action_name: "edit" },
  { code: "meeting.delete", module_name: "meetings", action_name: "delete" },
  { code: "note.view", module_name: "notes", action_name: "view" },
  { code: "note.create", module_name: "notes", action_name: "create" },
  { code: "note.edit", module_name: "notes", action_name: "edit" },
  { code: "note.delete", module_name: "notes", action_name: "delete" },
  { code: "contact.view", module_name: "contacts", action_name: "view" },
  { code: "contact.create", module_name: "contacts", action_name: "create" },
  { code: "contact.edit", module_name: "contacts", action_name: "edit" },
  { code: "contact.delete", module_name: "contacts", action_name: "delete" },
  { code: "company.view", module_name: "companies", action_name: "view" },
  { code: "company.create", module_name: "companies", action_name: "create" },
  { code: "company.edit", module_name: "companies", action_name: "edit" },
  { code: "company.delete", module_name: "companies", action_name: "delete" },
  { code: "customer.view", module_name: "customers", action_name: "view" },
  { code: "customer.create", module_name: "customers", action_name: "create" },
  { code: "customer.edit", module_name: "customers", action_name: "edit" },
  { code: "customer.delete", module_name: "customers", action_name: "delete" },
  { code: "invoice.view", module_name: "invoices", action_name: "view" },
  { code: "invoice.create", module_name: "invoices", action_name: "create" },
  { code: "invoice.edit", module_name: "invoices", action_name: "edit" },
  { code: "invoice.delete", module_name: "invoices", action_name: "delete" },
  { code: "report.view", module_name: "reports", action_name: "view" },
  { code: "report.export", module_name: "reports", action_name: "export" },
  { code: "user.view", module_name: "users", action_name: "view" },
  { code: "user.manage", module_name: "users", action_name: "manage" },
  { code: "user.invite", module_name: "users", action_name: "invite" },
  { code: "role.manage", module_name: "roles", action_name: "manage" },
  { code: "billing.manage", module_name: "billing", action_name: "manage" },
  { code: "settings.view", module_name: "settings", action_name: "view" },
  { code: "settings.edit", module_name: "settings", action_name: "edit" },
  { code: "addon.manage", module_name: "addons", action_name: "manage" },
  { code: "hr.view", module_name: "hr", action_name: "view" },
  { code: "hr.manage", module_name: "hr", action_name: "manage" },
  { code: "chat.view", module_name: "chat", action_name: "view" },
  { code: "chat.send", module_name: "chat", action_name: "send" },
];

const ALL_CODES = new Set(PERMISSION_DEFINITIONS.map((p) => p.code));

const MANAGER_DENIED = new Set(["billing.manage", "role.manage"]);

const STAFF_CODES = new Set([
  "dashboard.view",
  "lead.view",
  "lead.create",
  "lead.edit",
  "lead.assign",
  "opportunity.view",
  "opportunity.create",
  "opportunity.edit",
  "ticket.view",
  "ticket.create",
  "ticket.edit",
  "task.view",
  "task.create",
  "task.edit",
  "reminder.view",
  "reminder.create",
  "reminder.edit",
  "meeting.view",
  "meeting.create",
  "meeting.edit",
  "note.view",
  "note.create",
  "note.edit",
  "contact.view",
  "contact.create",
  "contact.edit",
  "company.view",
  "company.create",
  "company.edit",
  "customer.view",
  "customer.create",
  "customer.edit",
  "invoice.view",
  "invoice.create",
  "invoice.edit",
  "report.view",
  "chat.view",
  "chat.send",
]);

const VIEWER_CODES = new Set(
  PERMISSION_DEFINITIONS.filter((p) => p.action_name === "view").map((p) => p.code)
);

function codesForSlug(slug) {
  if (slug === "tenant_admin") return new Set(ALL_CODES);
  if (slug === "manager") {
    const s = new Set(ALL_CODES);
    for (const c of MANAGER_DENIED) s.delete(c);
    return s;
  }
  if (slug === "staff") return new Set(STAFF_CODES);
  if (slug === "viewer") return new Set(VIEWER_CODES);
  return new Set(STAFF_CODES);
}

function legacyRoleToSlug(role) {
  if (role === "admin") return "tenant_admin";
  if (role === "manager") return "manager";
  if (role === "staff") return "staff";
  return "viewer";
}

async function seedPermissionCatalog() {
  for (const p of PERMISSION_DEFINITIONS) {
    await mainPool.execute(
      `INSERT INTO acl_permissions (code, module_name, action_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE module_name = VALUES(module_name), action_name = VALUES(action_name)`,
      [p.code, p.module_name, p.action_name]
    );
  }
}

async function getPermissionIdsByCodes(codes) {
  if (!codes.length) return new Map();
  const ph = codes.map(() => "?").join(",");
  const [rows] = await mainPool.execute(
    `SELECT id, code FROM acl_permissions WHERE code IN (${ph})`,
    codes
  );
  const m = new Map();
  for (const r of rows) m.set(r.code, r.id);
  return m;
}

async function ensureOrgRoles(tenantId) {
  const [[cnt]] = await mainPool.execute(
    `SELECT COUNT(*) AS n FROM org_roles WHERE organization_id = ?`,
    [tenantId]
  );
  if (Number(cnt?.n) > 0) return;

  const slugs = [
    { slug: "tenant_admin", name: "Tenant admin" },
    { slug: "manager", name: "Manager" },
    { slug: "staff", name: "Staff" },
    { slug: "viewer", name: "Viewer" },
  ];

  const roleIds = {};
  for (const { slug, name } of slugs) {
    const [r] = await mainPool.execute(
      `INSERT INTO org_roles (organization_id, slug, name, is_system) VALUES (?, ?, ?, 1)`,
      [tenantId, slug, name]
    );
    roleIds[slug] = r.insertId;
  }

  const allCodes = [...ALL_CODES];
  const idByCode = await getPermissionIdsByCodes(allCodes);

  for (const slug of ["tenant_admin", "manager", "staff", "viewer"]) {
    const rid = roleIds[slug];
    const set = codesForSlug(slug);
    const values = [];
    const params = [];
    for (const code of set) {
      const pid = idByCode.get(code);
      if (!pid) continue;
      values.push("(?, ?)");
      params.push(rid, pid);
    }
    if (values.length) {
      await mainPool.execute(
        `INSERT IGNORE INTO org_role_permissions (role_id, permission_id) VALUES ${values.join(",")}`,
        params
      );
    }
  }
}

async function getRoleId(tenantId, slug) {
  const [rows] = await mainPool.execute(
    `SELECT id FROM org_roles WHERE organization_id = ? AND slug = ? LIMIT 1`,
    [tenantId, slug]
  );
  return rows[0]?.id || null;
}

/**
 * Ensure a membership row exists for this user; map legacy users.role when creating.
 */
async function ensureOrganizationMember(tenantId, user) {
  if (!tenantId || !user?.id) return;
  await ensureOrgRoles(tenantId);

  const [existing] = await mainPool.execute(
    `SELECT om.id, r.slug FROM organization_members om
     JOIN org_roles r ON r.id = om.role_id
     WHERE om.organization_id = ? AND om.user_id = ? LIMIT 1`,
    [tenantId, user.id]
  );
  if (existing.length) return;

  const slug = legacyRoleToSlug(user.role);
  const roleId = await getRoleId(tenantId, slug);
  if (!roleId) return;

  await mainPool.execute(
    `INSERT INTO organization_members (organization_id, user_id, role_id, is_active, joined_at)
     VALUES (?, ?, ?, 1, NOW())`,
    [tenantId, user.id, roleId]
  );
}

async function syncAllMembersForTenant(tenantId) {
  const [users] = await mainPool.execute(
    `SELECT id, role FROM users WHERE tenant_id = ? AND is_active = 1`,
    [tenantId]
  );
  for (const u of users) {
    await ensureOrganizationMember(tenantId, { id: u.id, role: u.role });
  }
}

async function ensureTenantRbacInitialized(tenantId) {
  if (!tenantId) return;
  await seedPermissionCatalog();
  await ensureOrgRoles(tenantId);
  await syncAllMembersForTenant(tenantId);
}

/**
 * Load RBAC for API request after tenant is known.
 * @returns {{ permissions: Set<string>, roleSlug: string|null, organizationId: string|null }}
 */
async function getRbacContext(user) {
  const out = {
    permissions: new Set(),
    roleSlug: null,
    organizationId: user.tenant_id || user.tenantId || null,
    fromMembership: false,
  };

  if (Number(user.is_platform_admin) === 1) {
    out.permissions = new Set(ALL_CODES);
    out.roleSlug = "platform_admin";
    out.fromMembership = true;
    return out;
  }

  const tenantId = user.tenant_id || user.tenantId || null;
  if (!tenantId) return out;

  try {
    await ensureTenantRbacInitialized(tenantId);
    await ensureOrganizationMember(tenantId, user);

    const [slugRows] = await mainPool.execute(
      `SELECT r.slug
       FROM organization_members om
       JOIN org_roles r ON r.id = om.role_id
       WHERE om.organization_id = ? AND om.user_id = ? AND om.is_active = 1
       LIMIT 1`,
      [tenantId, user.id]
    );

    const [permRows] = await mainPool.execute(
      `SELECT p.code
       FROM organization_members om
       JOIN org_role_permissions orp ON orp.role_id = om.role_id
       JOIN acl_permissions p ON p.id = orp.permission_id
       WHERE om.organization_id = ? AND om.user_id = ? AND om.is_active = 1`,
      [tenantId, user.id]
    );

    if (slugRows.length && permRows.length) {
      out.fromMembership = true;
      out.roleSlug = slugRows[0].slug;
      for (const row of permRows) out.permissions.add(row.code);
      return out;
    }

    // Fallback: derive from legacy role if membership query failed
    const slug = legacyRoleToSlug(user.role);
    out.roleSlug = slug;
    out.permissions = codesForSlug(slug);
    return out;
  } catch (e) {
    console.error("getRbacContext:", e.message);
    const slug = legacyRoleToSlug(user.role);
    out.roleSlug = slug;
    out.permissions = codesForSlug(slug);
    return out;
  }
}

async function listOrgRoles(tenantId) {
  await ensureTenantRbacInitialized(tenantId);
  const [rows] = await mainPool.execute(
    `SELECT id, slug, name, is_system FROM org_roles WHERE organization_id = ? ORDER BY id`,
    [tenantId]
  );
  return rows;
}

async function listOrgMembers(tenantId) {
  await ensureTenantRbacInitialized(tenantId);
  const [rows] = await mainPool.execute(
    `SELECT om.id AS member_id, om.user_id, om.is_active, om.joined_at,
            r.slug AS role_slug, r.name AS role_name,
            u.email, u.first_name, u.last_name, u.role AS legacy_role
     FROM organization_members om
     JOIN org_roles r ON r.id = om.role_id
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ?
     ORDER BY u.email`,
    [tenantId]
  );
  return rows;
}

async function setMemberRole({ tenantId, targetUserId, newSlug, actorUserId }) {
  await ensureTenantRbacInitialized(tenantId);
  const roleId = await getRoleId(tenantId, newSlug);
  if (!roleId) throw new Error("Invalid role");

  const [trows] = await mainPool.execute(
    `SELECT id, tenant_id FROM users WHERE id = ? LIMIT 1`,
    [targetUserId]
  );
  const target = trows[0];
  if (!target || target.tenant_id !== tenantId) {
    throw new Error("User not in this organization");
  }

  const [upd] = await mainPool.execute(
    `UPDATE organization_members SET role_id = ? WHERE organization_id = ? AND user_id = ?`,
    [roleId, tenantId, targetUserId]
  );
  if (!upd.affectedRows) {
    await mainPool.execute(
      `INSERT INTO organization_members (organization_id, user_id, role_id, is_active, joined_at)
       VALUES (?, ?, ?, 1, NOW())`,
      [tenantId, targetUserId, roleId]
    );
  }

  await mainPool.execute(
    `INSERT INTO rbac_audit_log (organization_id, actor_user_id, target_user_id, action, detail_json)
     VALUES (?, ?, ?, 'member.role', JSON_OBJECT('role_slug', ?))`,
    [tenantId, actorUserId, targetUserId, newSlug]
  );
}

function hasPermission(ctx, code) {
  if (!ctx || !code) return false;
  if (ctx.permissions?.has(code)) return true;
  return false;
}

module.exports = {
  PERMISSION_DEFINITIONS,
  ALL_CODES,
  getRbacContext,
  ensureTenantRbacInitialized,
  ensureOrganizationMember,
  listOrgRoles,
  listOrgMembers,
  setMemberRole,
  hasPermission,
  legacyRoleToSlug,
  seedPermissionCatalog,
};
