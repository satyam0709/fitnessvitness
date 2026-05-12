const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { sendEmailWithRetry } = require("./emailService");

function toMySqlDateTime(date) {
  return new Date(date).toISOString().slice(0, 19).replace("T", " ");
}

function appBaseUrl(req) {
  const fromEnv = String(
    process.env.INVITE_APP_URL ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      ""
  ).trim();
  if (fromEnv) {
    const normalized = fromEnv.replace(/\/+$/, "");
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
    return `https://${normalized}`;
  }

  const forwardedOrigin = String(req.get("x-forwarded-origin") || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(forwardedOrigin)) return forwardedOrigin;

  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]
    .trim();
  if (host) return `${proto}://${host}`;
  return `${req.protocol}://${req.get("host")}`;
}

async function createUserInvitation({
  userId,
  email,
  tenantId = null,
  role = "staff",
  invitedByUserId = null,
  expiresInHours = 72,
}) {
  const safeEmail = String(email || "").trim().toLowerCase();
  if (!userId || !safeEmail) {
    throw new Error("userId and email are required to create invitation");
  }
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + Math.max(1, Number(expiresInHours) || 72) * 60 * 60 * 1000);

  await mainPool.execute(
    `UPDATE user_invitations
     SET status = 'expired'
     WHERE status = 'pending' AND (user_id = ? OR email = ?)`,
    [userId, safeEmail]
  );

  await mainPool.execute(
    `INSERT INTO user_invitations
      (id, user_id, tenant_id, invited_by, email, role, token, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, userId, tenantId, invitedByUserId, safeEmail, role, token, toMySqlDateTime(expiresAt)]
  );

  return { id, token, expiresAt };
}

function buildInviterLines(inviterName, inviterEmail) {
  const name = String(inviterName || "").trim();
  const email = String(inviterEmail || "").trim().toLowerCase();
  if (!name && !email) return { textBlock: "", htmlBlock: "", subjectSuffix: "" };
  const who =
    name && email ? `${name} (${email})` : name || email;
  const subjectSuffix = name ? ` — from ${name}` : email ? ` — from ${email}` : "";
  return {
    subjectSuffix,
    textBlock: `\nInvited by: ${who}\n(Replies to this message will go to the inviter when supported by your mail app.)\n`,
    htmlBlock: `<p style="margin:16px 0 8px 0;"><strong>Invited by:</strong> ${escapeHtml(who)}</p><p style="color:#4b5563;font-size:14px;">Replies are directed to the inviter when your email app supports Reply-To.</p>`,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendUserInvitationEmail({
  req,
  to,
  firstName,
  role,
  workspaceName = "",
  token,
  inviterName = "",
  inviterEmail = "",
  meta = {},
}) {
  const base = appBaseUrl(req);
  const inviteUrl = `${base}/invite/accept?token=${encodeURIComponent(token)}`;
  const { textBlock, htmlBlock, subjectSuffix } = buildInviterLines(inviterName, inviterEmail);
  const subjectBase = workspaceName
    ? `Invitation to join ${workspaceName} on 365 RND CRM`
    : "Invitation to join 365 RND CRM";
  const subject = `${subjectBase}${subjectSuffix}`;
  const text = `Hi ${firstName || "there"},

You were invited to join ${workspaceName || "365 RND CRM"} as ${role}.${textBlock}
Accept invitation and set your password:
${inviteUrl}

This link expires in 72 hours.

- 365 RND CRM`;
  const html = `<p>Hi ${firstName || "there"},</p>
<p>You were invited to join <strong>${workspaceName || "365 RND CRM"}</strong> as <strong>${role}</strong>.</p>
${htmlBlock || ""}
<p><a href="${inviteUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">Accept Invitation</a></p>
<p>Or open this link:<br/><a href="${inviteUrl}">${inviteUrl}</a></p>
<p>This link expires in 72 hours.</p>
<p>- 365 RND CRM</p>`;

  const mail = await sendEmailWithRetry({
    to,
    subject,
    text,
    html,
    replyTo: inviterEmail || null,
    meta: {
      type: "user_invitation",
      inviter_email: inviterEmail || null,
      inviter_name: inviterName || null,
      ...meta,
    },
  });
  return { ...mail, inviteUrl };
}

module.exports = { createUserInvitation, sendUserInvitationEmail };

