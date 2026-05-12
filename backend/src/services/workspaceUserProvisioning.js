const crypto = require("crypto");
const { hashPassword } = require("./authService");
const { mainPool } = require("../config/database");
const { createUserInvitation, sendUserInvitationEmail } = require("./userInvitationService");

function normalizeRole(raw) {
  const role = String(raw || "staff").trim().toLowerCase();
  return ["admin", "manager", "staff"].includes(role) ? role : null;
}

function normalizeMobile(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const keep = v.replace(/[^\d+]/g, "");
  if (keep.length < 7 || keep.length > 20) return null;
  return keep;
}

function generateTemporaryPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*_-";
  let out = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

function isStrongTempPassword(value) {
  const s = String(value || "");
  return s.length >= 8;
}

/** Matches subscription package seat semantics (staff + manager). */
async function countStaffManagerActiveUsers(tenantId) {
  const [[r]] = await mainPool.execute(
    `SELECT COUNT(*) AS c FROM users
     WHERE tenant_id = ? AND is_active = 1 AND role IN ('staff','manager')`,
    [tenantId]
  );
  return Number(r?.c) || 0;
}

function roleConsumesPackageSeat(role) {
  return role === "staff" || role === "manager";
}

/**
 * New employees use a fresh email. Only exception: same-workspace incomplete invite can be replaced on submit.
 * @returns {Promise<{ success: true, available: boolean, reason?: string, message?: string, clerkAccountExists?: boolean }>}
 */
async function evaluateWorkspaceInviteEmail(tenantId, emailRaw) {
  const tid = String(tenantId || "").trim();
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, available: false, message: "Valid email is required." };
  }

  const [[dbByEmail]] = await mainPool.execute(
    `SELECT id, tenant_id, clerk_user_id, email
     FROM users
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [email]
  );

  if (!dbByEmail) {
    return {
      success: true,
      available: true,
      reason: "ok",
      message: "This email is available for a new user.",
      clerkAccountExists: false,
    };
  }

  const isPending = String(dbByEmail.clerk_user_id || "").startsWith("pending:");

  if (isPending && String(dbByEmail.tenant_id || "") === tid) {
    return {
      success: true,
      available: true,
      reason: "pending_retry",
      message:
        "An incomplete invite exists for this email here. Submitting the form again will refresh their password and invitation.",
      clerkAccountExists: false,
    };
  }

  if (String(dbByEmail.tenant_id || "") === tid && !isPending) {
    return {
      success: true,
      available: false,
      reason: "already_in_workspace",
      message: "This email is already a user in this workspace.",
      clerkAccountExists: true,
    };
  }

  if (dbByEmail.tenant_id != null && String(dbByEmail.tenant_id) !== tid) {
    return {
      success: true,
      available: false,
      reason: "other_workspace",
      message: "This email already belongs to another workspace. Use a different email address.",
      clerkAccountExists: true,
    };
  }

  return {
    success: true,
    available: false,
    reason: "email_already_registered",
    message:
      "This email is already registered in CRM. Each new employee must use a unique email address (login is always by email).",
    clerkAccountExists: true,
  };
}

async function loadInviterForInvitationEmail(invitedByUserId) {
  const id = Number(invitedByUserId);
  if (!id || Number.isNaN(id)) return { inviterName: "", inviterEmail: "" };
  const [[row]] = await mainPool.execute(
    `SELECT email, first_name, last_name FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!row?.email) return { inviterName: "", inviterEmail: "" };
  const inviterEmail = String(row.email).trim().toLowerCase();
  const inviterName = [row.first_name, row.last_name]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return { inviterName: inviterName || "", inviterEmail };
}

/**
 * Insert/update workspace member and optionally send invitation email.
 * Does not enforce seat limits (caller must gate).
 *
 * @returns {Promise<
 *   | { ok: true; row: object; isPending: boolean; clerkUserId: string; mailStatus: object|null }
 *   | { ok: false; status: number; code?: string; message: string }
 * >}
 */
async function provisionWorkspaceMember(req, params) {
  const {
    tenantId,
    invitedByUserId,
    workspaceName,
    clerkUserId: clerkIn = "",
    email: emailIn = "",
    firstName = null,
    lastName = null,
    mobile: mobileParam = null,
    mobileRaw = null,
    role: roleRaw,
    tempPassword = "",
    shouldSendWelcomeEmail = true,
  } = params;
  const tid = String(tenantId || "").trim();

  const email = String(emailIn || "").trim().toLowerCase();
  const role = normalizeRole(roleRaw);
  if (!role) {
    return { ok: false, status: 400, message: "Invalid role" };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, message: "A valid email is required." };
  }

  const displayFirst = String(firstName || "").trim();
  if (!displayFirst) {
    return { ok: false, status: 400, message: "Display name (first name) is required." };
  }
  const lastNorm = String(lastName || "").trim() || null;

  const mobileNorm = normalizeMobile(
    mobileParam != null && mobileParam !== "" ? mobileParam : mobileRaw != null ? mobileRaw : ""
  );
  if (!mobileNorm) {
    return {
      ok: false,
      status: 400,
      message: "Valid mobile number is required (digits only, at least 7 characters).",
    };
  }

  const pwd = String(tempPassword || "").trim();
  if (!isStrongTempPassword(pwd)) {
    return { ok: false, status: 400, message: "Password must be at least 8 characters." };
  }
  const passwordHashForUpsert = await hashPassword(pwd);

  let clerkUserId = String(clerkIn || "").trim();

  if (!clerkUserId) {
    const [[dbByEmail]] = await mainPool.execute(
      `SELECT id, clerk_user_id, tenant_id
       FROM users
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [email]
    );
    if (dbByEmail?.clerk_user_id && !String(dbByEmail.clerk_user_id).startsWith("pending:")) {
      return {
        ok: false,
        status: 409,
        code: "EMAIL_IN_USE",
        message: "This email already has an account. Use a different email for a new employee.",
      };
    }
    if (dbByEmail?.tenant_id != null && String(dbByEmail.tenant_id) !== tid) {
      const existIsPending = String(dbByEmail.clerk_user_id || "").startsWith("pending:");
      if (!existIsPending) {
        return {
          ok: false,
          status: 409,
          code: "OTHER_WORKSPACE",
          message: "This email already belongs to another workspace.",
        };
      }
      return {
        ok: false,
        status: 409,
        code: "OTHER_WORKSPACE",
        message: "This email is tied to another workspace. Use a different email.",
      };
    }
    if (String(dbByEmail?.tenant_id || "") === tid && !String(dbByEmail.clerk_user_id || "").startsWith("pending:")) {
      return {
        ok: false,
        status: 409,
        code: "ALREADY_IN_WORKSPACE",
        message: "This email is already a user in this workspace.",
      };
    }
    clerkUserId = `pending:${crypto.randomUUID()}`;
  } else if (!String(clerkUserId).startsWith("pending:")) {
    return {
      ok: false,
      status: 400,
      message: "Adding by external user id is not supported from this form. Use email only.",
    };
  }

  const [[existing]] = await mainPool.execute(
    `SELECT id, tenant_id, clerk_user_id, email
     FROM users
     WHERE clerk_user_id = ? OR (? <> '' AND LOWER(email) = ?)
     LIMIT 1`,
    [clerkUserId, email, email]
  );
  if (existing?.tenant_id != null && String(existing.tenant_id) !== tid) {
    return {
      ok: false,
      status: 409,
      code: "OTHER_WORKSPACE",
      message: "This user already belongs to another workspace.",
    };
  }

  const isPending = String(clerkUserId).startsWith("pending:");

  await mainPool.execute(
    `INSERT INTO users (clerk_user_id, email, first_name, last_name, mobile_number, tenant_id, role, is_active, must_change_password, password_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
     ON DUPLICATE KEY UPDATE
      tenant_id = VALUES(tenant_id),
      role = VALUES(role),
      is_active = 1,
      must_change_password = 1,
      email = COALESCE(VALUES(email), email),
      first_name = COALESCE(VALUES(first_name), first_name),
      last_name = COALESCE(VALUES(last_name), last_name),
      mobile_number = COALESCE(VALUES(mobile_number), mobile_number),
      password_hash = COALESCE(VALUES(password_hash), password_hash),
      updated_at = NOW()`,
    [clerkUserId, email || null, displayFirst, lastNorm, mobileNorm, tenantId, role, passwordHashForUpsert]
  );

  const [[row]] = await mainPool.execute(
    "SELECT id, email, first_name, last_name, mobile_number, role, is_active, last_login FROM users WHERE clerk_user_id = ? LIMIT 1",
    [clerkUserId]
  );

  let mailStatus = null;
  const workspace = String(workspaceName || "").trim() || "your workspace";
  if (row?.email && shouldSendWelcomeEmail) {
    try {
      const invitation = await createUserInvitation({
        userId: row.id,
        email: row.email,
        tenantId,
        role: row.role,
        invitedByUserId: invitedByUserId != null ? Number(invitedByUserId) || null : null,
      });
      const { inviterName, inviterEmail } = await loadInviterForInvitationEmail(invitedByUserId);
      mailStatus = await sendUserInvitationEmail({
        req,
        to: row.email,
        firstName: row.first_name || firstName,
        role: row.role,
        workspaceName: workspace,
        token: invitation.token,
        inviterName,
        inviterEmail,
        meta: { tenant_id: tenantId, user_id: row.id, clerk_user_id: clerkUserId },
      }).catch((err) => ({ ok: false, reason: err?.message || "send_failed" }));
      if (!mailStatus?.ok) {
        console.warn("provisionWorkspaceMember invitation email failed:", {
          to: row.email,
          reason: mailStatus?.reason || "unknown",
          detail: mailStatus?.detail || "n/a",
        });
      }
    } catch (inviteErr) {
      mailStatus = {
        ok: false,
        reason: "invitation_create_failed",
        detail: inviteErr?.message || "unknown error while creating invitation",
      };
      console.warn("provisionWorkspaceMember invitation create failed:", {
        user_id: row.id,
        tenant_id: tenantId,
        reason: mailStatus.reason,
        detail: mailStatus.detail,
      });
    }
  }

  return {
    ok: true,
    row,
    isPending,
    clerkUserId,
    mailStatus,
  };
}

module.exports = {
  normalizeRole,
  normalizeMobile,
  generateTemporaryPassword,
  isStrongTempPassword,
  countStaffManagerActiveUsers,
  roleConsumesPackageSeat,
  evaluateWorkspaceInviteEmail,
  provisionWorkspaceMember,
};
