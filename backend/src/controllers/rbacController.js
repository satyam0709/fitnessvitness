const { mainPool } = require("../config/database");
const { PERMISSION_DEFINITIONS, listOrgRoles, listOrgMembers, setMemberRole } = require("../services/rbacService");
const { emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");

function getRbacMe(req, res) {
  const perms = req.rbac?.permissions;
  res.json({
    success: true,
    data: {
      permissions: perms ? [...perms] : [],
      role_slug: req.rbac?.roleSlug || null,
      organization_id: req.rbac?.organizationId || null,
      from_membership: Boolean(req.rbac?.fromMembership),
    },
  });
}

function listPermissions(_req, res) {
  res.json({ success: true, data: PERMISSION_DEFINITIONS });
}

async function listRoles(req, res) {
  try {
    const tid = req.user.tenantId;
    if (!tid) return res.status(400).json({ success: false, message: "No organization context" });
    const rows = await listOrgRoles(tid);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listRoles:", e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function listMembers(req, res) {
  try {
    const tid = req.user.tenantId;
    if (!tid) return res.status(400).json({ success: false, message: "No organization context" });
    const rows = await listOrgMembers(tid);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listMembers:", e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function patchMemberRole(req, res) {
  try {
    const tid = req.user.tenantId;
    if (!tid) return res.status(400).json({ success: false, message: "No organization context" });

    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const slug = String(req.body?.role_slug || "").trim();
    const allowed = new Set(["tenant_admin", "manager", "staff", "viewer"]);
    if (!allowed.has(slug)) {
      return res.status(400).json({ success: false, message: "role_slug must be tenant_admin|manager|staff|viewer" });
    }

    await setMemberRole({
      tenantId: tid,
      targetUserId,
      newSlug: slug,
      actorUserId: req.user.id,
    });

    const [urows] = await mainPool.execute("SELECT clerk_user_id FROM users WHERE id = ? LIMIT 1", [targetUserId]);
    const row = urows[0];
    if (row?.clerk_user_id) {
      emitWorkspaceAccessChanged({ clerkUserId: row.clerk_user_id, reason: "rbac_role" });
    }

    res.json({ success: true, message: "Role updated" });
  } catch (e) {
    console.error("patchMemberRole:", e);
    const status = e.message?.includes("not in this organization") ? 403 : 500;
    res.status(status).json({ success: false, message: e.message || "Failed to update role" });
  }
}

module.exports = {
  getRbacMe,
  listPermissions,
  listRoles,
  listMembers,
  patchMemberRole,
};
