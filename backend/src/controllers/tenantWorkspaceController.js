const crypto = require("crypto");
const { hashPassword } = require("../services/authService");
const { mainPool } = require("../config/database");
const { getTenantDataPoolForTenantId } = require("../services/tenantDatabaseService");
const { INTEGRATIONS } = require("../config/integrationsCatalog");
const { featureKey, getTenantContextForUser } = require("../services/tenantAccessService");
const { emitAdminChanged, emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const { isPlatformSuperAdmin } = require("../middleware/platformAdmin");
const { sendEmailWithRetry } = require("../services/emailService");
const { createUserInvitation, sendUserInvitationEmail } = require("../services/userInvitationService");
const { purgeTenantWorkspace } = require("../services/workspacePurgeService");
const {
  normalizeRole,
  generateTemporaryPassword,
  countStaffManagerActiveUsers,
  roleConsumesPackageSeat,
  evaluateWorkspaceInviteEmail,
  provisionWorkspaceMember,
} = require("../services/workspaceUserProvisioning");

function integrationFeatureKey(intKey) {
  return featureKey(`integration_${intKey}`);
}

function emitTenantUsersRealtime(tenantId, clerkUserId, reason) {
  emitWorkspaceAccessChanged({ tenantId, reason: reason || "users_changed" });
  if (clerkUserId && !String(clerkUserId).startsWith("pending:")) {
    emitWorkspaceAccessChanged({ clerkUserId, reason: reason || "users_changed" });
  }
}

function appLoginUrl(req) {
  const fromEnv = process.env.FRONTEND_URL ? String(process.env.FRONTEND_URL).replace(/\/+$/, "") : "";
  if (fromEnv) return `${fromEnv}/login`;
  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}/login`;
}

async function getLatestTenantPackage(tenantId) {
  const [rows] = await mainPool.execute(
    `SELECT id, package_name, max_users, valid_from, valid_until, status
     FROM tenant_packages WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}


async function hardDeleteUserRecord(userId, tenantId) {
  const crm = await getTenantDataPoolForTenantId(tenantId);
  // Cleanup rows that reference users.id without ON DELETE CASCADE.
  await crm.execute("DELETE FROM chat_messages WHERE sender_id = ?", [userId]);
  await crm.execute("DELETE FROM meetings WHERE organizer_id = ?", [userId]);
  await crm.execute("DELETE FROM reminders WHERE user_id = ?", [userId]);
  await crm.execute("DELETE FROM crm_todos WHERE created_by = ?", [userId]);

  // Nullable relationships.
  await crm.execute("UPDATE reminders SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [userId]);
  await crm.execute("UPDATE meetings SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [userId]);
  await crm.execute("UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?", [userId]);
}

/** Route stack already ran requireTenantAdmin; resolve tenant + seats from DB. */
async function loadWorkspaceGate(req) {
  const ctx = await getTenantContextForUser(req.user);
  if (!ctx?.tenantId) return { ok: false, code: 403, message: "No workspace found" };
  const tp = await getLatestTenantPackage(ctx.tenantId);
  const maxUsers = tp?.max_users != null ? Number(tp.max_users) : Number(ctx.seats?.total) || 0;
  const seatsUsed = await countStaffManagerActiveUsers(ctx.tenantId);
  return {
    ok: true,
    ctx,
    tenantPackage: tp,
    seatsUsed,
    seatsMax: maxUsers,
  };
}

async function listWorkspaceUsers(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const [rows] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, mobile_number, role, is_active, last_login, created_at, tenant_id,
              (clerk_user_id LIKE 'pending:%') AS is_pending
       FROM users
       WHERE tenant_id = ?
         AND COALESCE(is_platform_admin, 0) = 0
       ORDER BY created_at DESC`,
      [gate.ctx.tenantId]
    );
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, is_pending: Boolean(r.is_pending) })),
      seats: { used: gate.seatsUsed, max: gate.seatsMax, total: gate.seatsMax },
    });
  } catch (err) {
    console.error("listWorkspaceUsers:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function checkWorkspaceUserEmail(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const email = String(req.query?.email || "").trim().toLowerCase();
    const evaluated = await evaluateWorkspaceInviteEmail(gate.ctx.tenantId, email);
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
    console.error("checkWorkspaceUserEmail:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addWorkspaceUser(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
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
    if (
      !isPlatformSuperAdmin(req.user) &&
      roleConsumesPackageSeat(role) &&
      gate.seatsMax > 0 &&
      gate.seatsUsed >= gate.seatsMax
    ) {
      return res.status(403).json({
        success: false,
        message: "Seat limit reached. Upgrade your plan.",
      });
    }

    const [[tenantRow]] = await mainPool.execute(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), company_name, 'your workspace') AS workspace_name
       FROM tenants WHERE id = ? LIMIT 1`,
      [gate.ctx.tenantId]
    );
    const workspaceName =
      String(req.body?.workspaceName || "").trim() || tenantRow?.workspace_name || "your workspace";

    const result = await provisionWorkspaceMember(req, {
      tenantId: gate.ctx.tenantId,
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
    emitTenantUsersRealtime(gate.ctx.tenantId, clerkUserId, "assigned");
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    res.status(201).json({
      success: true,
      userKind: "workspace_member",
      workspaceTenantId: gate.ctx.tenantId,
      packageSeatsEnforced: !isPlatformSuperAdmin(req.user),
      data: row,
      pending: isPending,
      mail: shouldSendWelcomeEmail ? mailStatus || { ok: false, reason: "skipped_or_missing_email" } : { ok: false, reason: "disabled" },
    });
  } catch (err) {
    console.error("addWorkspaceUser:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resetWorkspaceUserPassword(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid user id" });
    if (userId === req.user.id) {
      return res.status(403).json({ success: false, message: "Use profile settings to reset your own password." });
    }
    const [[target]] = await mainPool.execute(
      `SELECT id, clerk_user_id, email, first_name, role
       FROM users
       WHERE id = ? AND tenant_id = ? AND is_active = 1
       LIMIT 1`,
      [userId, gate.ctx.tenantId]
    );
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    const tempPassword = generateTemporaryPassword(12);
    const passwordHash = await hashPassword(tempPassword);
    await mainPool.execute(
      "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
      [passwordHash, target.id, gate.ctx.tenantId]
    );

    if (target.email) {
      await sendEmailWithRetry({
        to: target.email,
        subject: "Your CRM password was reset",
        text: `Hi ${target.first_name || "there"},\n\nYour workspace admin reset your CRM password.\nTemporary password: ${tempPassword}\nLogin: ${appLoginUrl(req)}\nPlease sign in and change your password from your profile.\n\n- 365 RND CRM`,
        html: `<p>Hi ${target.first_name || "there"},</p>
<p>Your workspace admin reset your CRM password.</p>
<p><strong>Temporary password:</strong> ${tempPassword}</p>
<p>Login: <a href="${appLoginUrl(req)}">${appLoginUrl(req)}</a></p>
<p>Please sign in and change your password from your profile.</p>
<p>- 365 RND CRM</p>`,
        meta: { type: "workspace_password_reset", tenant_id: gate.ctx.tenantId, user_id: target.id },
      }).catch(() => {});
    }

    emitTenantUsersRealtime(gate.ctx.tenantId, target.clerk_user_id, "password_reset");
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    return res.json({
      success: true,
      message: "Password reset successfully. A temporary password was emailed when an address is on file; the user should sign in and change it from their profile.",
    });
  } catch (err) {
    console.error("resetWorkspaceUserPassword:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function patchWorkspaceUserRole(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const userId = Number(req.params.userId);
    const role = String(req.body?.role || "").trim();
    if (!userId || !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid user or role" });
    }
    if (userId === req.user.id) {
      return res.status(403).json({ success: false, message: "Cannot change your own role." });
    }
    const [[target]] = await mainPool.execute(
      "SELECT id, clerk_user_id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
      [userId, gate.ctx.tenantId]
    );
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    await mainPool.execute("UPDATE users SET role = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?", [
      role,
      userId,
      gate.ctx.tenantId,
    ]);
    emitTenantUsersRealtime(gate.ctx.tenantId, target.clerk_user_id, "role");
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    res.json({ success: true });
  } catch (err) {
    console.error("patchWorkspaceUserRole:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleWorkspaceUser(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const userId = Number(req.params.userId);
    if (userId === req.user.id) {
      return res.status(403).json({ success: false, message: "Cannot change your own status." });
    }
    const [[target]] = await mainPool.execute(
      "SELECT id, is_active, clerk_user_id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
      [userId, gate.ctx.tenantId]
    );
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    await mainPool.execute(
      "UPDATE users SET is_active = (1 - is_active), updated_at = NOW() WHERE id = ? AND tenant_id = ?",
      [userId, gate.ctx.tenantId]
    );
    const next = Number(target.is_active) === 1 ? 0 : 1;
    emitTenantUsersRealtime(gate.ctx.tenantId, target.clerk_user_id, "active");
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    res.json({ success: true, is_active: Boolean(next) });
  } catch (err) {
    console.error("toggleWorkspaceUser:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function removeWorkspaceUser(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const userId = Number(req.params.userId);
    const [[target]] = await mainPool.execute(
      `SELECT
         u.id,
         u.clerk_user_id,
         u.email,
         COALESCE(u.is_platform_admin, 0) AS is_platform_admin,
         t.owner_user_id,
         t.owner_clerk_user_id
       FROM users u
       INNER JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ? AND u.tenant_id = ?
       LIMIT 1`,
      [userId, gate.ctx.tenantId]
    );
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    if (Number(target.is_platform_admin) === 1) {
      return res.status(403).json({
        success: false,
        message: "Platform super-admin accounts cannot be deleted from tenant users.",
      });
    }
    const ownerUserId = Number(target.owner_user_id) || null;
    const ownerClerkUserId = String(target.owner_clerk_user_id || "").trim();
    const targetClerkUserId = String(target.clerk_user_id || "").trim();
    const deletingWorkspaceOwner =
      (ownerUserId != null && Number(target.id) === ownerUserId) ||
      (ownerClerkUserId && targetClerkUserId && ownerClerkUserId === targetClerkUserId);

    if (userId === req.user.id && !deletingWorkspaceOwner) {
      return res.status(400).json({ success: false, message: "Cannot remove yourself." });
    }

    if (deletingWorkspaceOwner) {
      const purge = await purgeTenantWorkspace(gate.ctx.tenantId, { requireOrphan: false });
      emitWorkspaceAccessChanged({
        tenantId: gate.ctx.tenantId,
        reason: "workspace_auto_purged_on_owner_delete",
      });
      emitAdminChanged({
        scope: "tenants",
        action: "workspace_auto_purged_on_owner_delete",
        tenantId: gate.ctx.tenantId,
        deleted_owner_user_id: target.id,
        deleted_owner_email: target.email || null,
      });
      return res.json({
        success: true,
        workspaceDeleted: true,
        message:
          "Owner account deleted. Workspace and all related tenant data (URL, trial/subscription, users, and workspace records) were removed automatically.",
        purge,
      });
    }

    await hardDeleteUserRecord(userId, gate.ctx.tenantId);
    const [deleted] = await mainPool.execute("DELETE FROM users WHERE id = ? AND tenant_id = ? LIMIT 1", [
      userId,
      gate.ctx.tenantId,
    ]);
    if (!deleted?.affectedRows) {
      return res.status(409).json({
        success: false,
        message: "Could not fully remove this user due to linked records.",
      });
    }
    emitTenantUsersRealtime(gate.ctx.tenantId, target.clerk_user_id, "removed");
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    res.json({ success: true, message: "User deleted from workspace and database." });
  } catch (err) {
    console.error("removeWorkspaceUser:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteWorkspace(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const tenantId = gate.ctx.tenantId;
    const acknowledge =
      String(req.body?.acknowledge || req.query?.acknowledge || "").trim();
    const confirmWorkspaceId =
      String(req.body?.confirm_workspace_id || req.query?.confirm_workspace_id || "").trim();
    const confirmWorkspaceSlug =
      String(req.body?.confirm_workspace_slug || req.query?.confirm_workspace_slug || "")
        .trim()
        .toLowerCase();
    const deletionReason = String(req.body?.reason || req.query?.reason || "").trim();
    if (acknowledge !== "DELETE_WORKSPACE") {
      return res.status(400).json({
        success: false,
        message:
          'Confirmation required. Send acknowledge="DELETE_WORKSPACE" to permanently delete this workspace.',
      });
    }
    if (!confirmWorkspaceId || confirmWorkspaceId !== String(tenantId)) {
      return res.status(400).json({
        success: false,
        message:
          "Confirmation required. Pass confirm_workspace_id with the exact current workspace id.",
      });
    }

    const [[tenant]] = await mainPool.execute(
      `SELECT owner_user_id, owner_clerk_user_id, slug, subdomain
       FROM tenants
       WHERE id = ?
       LIMIT 1`,
      [tenantId]
    );
    if (!tenant) return res.status(404).json({ success: false, message: "Workspace not found." });
    const expectedSlug = String(tenant.slug || tenant.subdomain || "").trim().toLowerCase();
    if (confirmWorkspaceSlug && expectedSlug && confirmWorkspaceSlug !== expectedSlug) {
      return res.status(400).json({
        success: false,
        message:
          "Workspace slug confirmation mismatch. Pass confirm_workspace_slug matching your current workspace URL slug.",
      });
    }

    const requesterId = Number(req.user?.id) || null;
    const requesterClerk = String(req.user?.clerkUserId || req.user?.clerk_user_id || "").trim();
    const ownerUserId = Number(tenant.owner_user_id) || null;
    const ownerClerk = String(tenant.owner_clerk_user_id || "").trim();
    const isOwner =
      (ownerUserId != null && requesterId != null && ownerUserId === requesterId) ||
      (ownerClerk && requesterClerk && ownerClerk === requesterClerk);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can permanently delete this workspace.",
      });
    }

    const purge = await purgeTenantWorkspace(tenantId, { requireOrphan: false });
    emitWorkspaceAccessChanged({ tenantId, reason: "workspace_deleted_by_owner" });
    emitAdminChanged({
      scope: "tenants",
      action: "workspace_deleted_by_owner",
      tenantId,
      deleted_by_user_id: requesterId,
      deleted_by_clerk_user_id: requesterClerk || null,
      reason: deletionReason || null,
    });
    return res.json({
      success: true,
      workspaceDeleted: true,
      message:
        "Workspace and all related data (users, URL/subdomain mapping, trial/subscription, and workspace records) deleted successfully.",
      purge,
    });
  } catch (err) {
    console.error("deleteWorkspace:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function resendWorkspaceUserInvite(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid user id" });

    const [[target]] = await mainPool.execute(
      `SELECT id, email, first_name, role, clerk_user_id
       FROM users
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [userId, gate.ctx.tenantId]
    );
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    if (!target.email) {
      return res.status(400).json({ success: false, message: "User has no email address." });
    }

    const [[tenantRow]] = await mainPool.execute(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), company_name, 'your workspace') AS workspace_name
       FROM tenants WHERE id = ? LIMIT 1`,
      [gate.ctx.tenantId]
    );
    const workspaceName = tenantRow?.workspace_name || "your workspace";

    const isPending = String(target.clerk_user_id || "").startsWith("pending:");
    let mail = { ok: false, reason: "unknown" };

    try {
      const invitation = await createUserInvitation({
        userId: target.id,
        email: target.email,
        tenantId: gate.ctx.tenantId,
        role: target.role || "staff",
        invitedByUserId: Number(req.user?.id) || null,
      });
      const inviterName =
        `${String(req.user?.first_name || "").trim()} ${String(req.user?.last_name || "").trim()}`.trim() ||
        String(req.user?.email || "").trim();
      mail = await sendUserInvitationEmail({
        req,
        to: target.email,
        firstName: target.first_name,
        role: target.role || "staff",
        workspaceName,
        token: invitation.token,
        inviterName,
        inviterEmail: String(req.user?.email || "").trim(),
        meta: { tenant_id: gate.ctx.tenantId, user_id: target.id, action: "resend_invite" },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err?.message || "Could not create or send invitation.",
      });
    }
    if (!mail?.ok) {
      return res.status(502).json({
        success: false,
        message: "Invitation was created but email delivery failed. Check SMTP/EMAIL_WEBHOOK configuration.",
        mail,
      });
    }

    emitWorkspaceAccessChanged({ tenantId: gate.ctx.tenantId, reason: "invite_resent" });
    emitAdminChanged({ scope: "tenant_users", tenantId: gate.ctx.tenantId });
    return res.json({ success: true, message: "Invitation email re-sent.", mail, pending: isPending });
  } catch (err) {
    console.error("resendWorkspaceUserInvite:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function createWorkspaceInvite(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const inviteRole = String(req.body?.role || "staff").trim();
    if (
      !isPlatformSuperAdmin(req.user) &&
      roleConsumesPackageSeat(inviteRole) &&
      gate.seatsMax > 0 &&
      gate.seatsUsed >= gate.seatsMax
    ) {
      return res.status(409).json({
        success: false,
        message: "All seats are in use. Purchase more seats or deactivate a user.",
      });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = inviteRole;
    if (!email) return res.status(400).json({ success: false, message: "email required" });
    if (!["staff", "manager", "admin"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    const id = crypto.randomUUID();
    await mainPool.execute(
      `INSERT INTO tenant_invitations (id, tenant_id, email, role, invited_by, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 14 DAY))`,
      [id, gate.ctx.tenantId, email, role, req.user.id]
    );
    emitAdminChanged({ scope: "invites", tenantId: gate.ctx.tenantId });
    res.status(201).json({
      success: true,
      data: { id, message: "Invitation recorded. Ask the user to sign in once with this email so you can assign them from Users." },
    });
  } catch (err) {
    console.error("createWorkspaceInvite:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listWorkspaceIntegrations(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const ctx = gate.ctx;
    const [[integrationsRow]] = await mainPool.execute(
      `SELECT is_enabled FROM tenant_features WHERE tenant_id = ? AND feature_key = 'integrations' LIMIT 1`,
      [ctx.tenantId]
    );
    const integrationsOn = integrationsRow ? Number(integrationsRow.is_enabled) === 1 : false;
    const [addonRows] = await mainPool.execute(
      "SELECT addon_key, is_active, valid_until FROM tenant_marketplace_addons WHERE tenant_id = ?",
      [ctx.tenantId]
    );
    const addonMap = new Map(addonRows.map((r) => [r.addon_key, r]));

    const data = INTEGRATIONS.map((int) => {
      const row = addonMap.get(int.key) || addonMap.get(int.slug);
      const fk = integrationFeatureKey(int.key);
      const is_plan_enabled = Boolean(
        integrationsOn && (ctx.features?.[fk] || ctx.features?.integrations || ctx.features?.integration)
      );
      const is_active = row ? Number(row.is_active) === 1 : false;
      const valid_until = row?.valid_until || null;
      const expired = valid_until && new Date(valid_until).getTime() < Date.now();
      return {
        key: int.key,
        slug: int.slug,
        name: int.name,
        description: int.description,
        is_plan_enabled,
        is_active,
        valid_until,
        addon_expired: Boolean(expired),
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("listWorkspaceIntegrations:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function patchWorkspaceIntegration(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const paramKey = String(req.params.addonKey || req.params.key || "").trim();
    const integ = INTEGRATIONS.find((i) => i.key === paramKey || i.slug === paramKey);
    if (!integ) return res.status(404).json({ success: false, message: "Unknown integration" });
    const ctx = gate.ctx;
    const [[integrationsRow]] = await mainPool.execute(
      `SELECT is_enabled FROM tenant_features WHERE tenant_id = ? AND feature_key = 'integrations' LIMIT 1`,
      [ctx.tenantId]
    );
    if (!integrationsRow || Number(integrationsRow.is_enabled) !== 1) {
      return res.status(403).json({ success: false, message: "Integrations not included in your plan" });
    }
    const fk = integrationFeatureKey(integ.key);
    const addonAllowed = Boolean(ctx.features?.[fk] || ctx.features?.integrations || ctx.features?.integration);
    if (!addonAllowed) {
      return res.status(403).json({ success: false, message: "Integrations not included in your plan" });
    }
    const is_active = req.body?.is_active ? 1 : 0;
    const [existing] = await mainPool.execute(
      "SELECT id, valid_until FROM tenant_marketplace_addons WHERE tenant_id = ? AND addon_key = ? LIMIT 1",
      [ctx.tenantId, integ.key]
    );
    if (existing.length) {
      const vu = existing[0].valid_until;
      if (vu && new Date(vu).getTime() < Date.now() && is_active) {
        return res.status(403).json({ success: false, message: "Add-on expired" });
      }
      await mainPool.execute(
        "UPDATE tenant_marketplace_addons SET is_active = ?, valid_until = COALESCE(?, valid_until) WHERE id = ?",
        [is_active, req.body?.valid_until != null ? req.body.valid_until : null, existing[0].id]
      );
    } else {
      const nid = crypto.randomUUID();
      await mainPool.execute(
        `INSERT INTO tenant_marketplace_addons (id, tenant_id, addon_key, is_active, valid_from, valid_until)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [nid, ctx.tenantId, integ.key, is_active, req.body?.valid_until || null]
      );
    }
    emitAdminChanged({ scope: "integrations", tenantId: ctx.tenantId });
    res.json({ success: true });
  } catch (err) {
    console.error("patchWorkspaceIntegration:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

function subscriptionDaysSummary(subEndsAt, packageValidUntil) {
  const times = [];
  if (subEndsAt) {
    const t = new Date(subEndsAt).getTime();
    if (!Number.isNaN(t)) times.push(t);
  }
  if (packageValidUntil) {
    const d = new Date(packageValidUntil);
    d.setHours(23, 59, 59, 999);
    const t = d.getTime();
    if (!Number.isNaN(t)) times.push(t);
  }
  if (!times.length) return { days_left: null, ends_at: null };
  const end = Math.max(...times);
  const ms = end - Date.now();
  return {
    days_left: ms <= 0 ? 0 : Math.ceil(ms / 86400000),
    ends_at: new Date(end).toISOString(),
  };
}

async function getWorkspacePlan(req, res) {
  try {
    const gate = await loadWorkspaceGate(req);
    if (!gate.ok) return res.status(gate.code).json({ success: false, message: gate.message });
    const ctx = gate.ctx;
    const tp = gate.tenantPackage;
    const [addons] = await mainPool.execute(
      `SELECT addon_key, is_active, valid_until FROM tenant_marketplace_addons
       WHERE tenant_id = ?`,
      [ctx.tenantId]
    );
    const [featRows] = await mainPool.execute(
      "SELECT feature_key, is_enabled FROM tenant_features WHERE tenant_id = ? ORDER BY feature_key",
      [ctx.tenantId]
    );
    const [[trow]] = await mainPool.execute(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), company_name) AS tenant_name, company_name, name
       FROM tenants WHERE id = ? LIMIT 1`,
      [ctx.tenantId]
    );
    const tenantName = trow?.tenant_name || trow?.company_name || "Workspace";
    const subEnds = ctx.subscription?.ends_at || null;
    const pkgUntil = tp?.valid_until || null;
    const billing = subscriptionDaysSummary(subEnds, pkgUntil);
    res.json({
      success: true,
      data: {
        tenant_name: tenantName,
        package: tp
          ? {
              package_name: tp.package_name,
              status: tp.status,
              valid_from: tp.valid_from,
              valid_until: tp.valid_until,
              max_users: tp.max_users,
            }
          : {
              package_name: ctx.subscription?.package_name || null,
              status: ctx.subscription?.status || null,
              valid_from: ctx.subscription?.starts_at || null,
              valid_until: ctx.subscription?.ends_at || null,
              max_users: ctx.seats?.total ?? null,
            },
        seats: { used: gate.seatsUsed, max: gate.seatsMax },
        features: featRows.map((r) => ({ feature_key: r.feature_key, is_enabled: Number(r.is_enabled) === 1 })),
        addons: addons.map((a) => ({
          addon_key: a.addon_key,
          is_active: Number(a.is_active) === 1,
          valid_until: a.valid_until,
        })),
        subscription: ctx.subscription,
        subscription_summary: {
          status: ctx.subscription?.status || tp?.status || null,
          days_left: billing.days_left,
          ends_at: billing.ends_at,
          subscription_ends_at: subEnds,
          package_valid_until: pkgUntil,
        },
        seatsLegacy: ctx.seats,
        tenantFeatures: featRows,
        packageFeatures: ctx.features,
      },
    });
  } catch (err) {
    console.error("getWorkspacePlan:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listWorkspaceUsers,
  checkWorkspaceUserEmail,
  addWorkspaceUser,
  resetWorkspaceUserPassword,
  patchWorkspaceUserRole,
  toggleWorkspaceUser,
  removeWorkspaceUser,
  resendWorkspaceUserInvite,
  createWorkspaceInvite,
  listWorkspaceIntegrations,
  patchWorkspaceIntegration,
  getWorkspacePlan,
  deleteWorkspace,
};
