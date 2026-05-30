const nodemailer = require("nodemailer");

let transporter = null;

function canUseSmtp() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function smtpTimeoutMs() {
  const fallback = process.env.NODE_ENV === "production" ? 45000 : 15000;
  const raw = Number(process.env.SMTP_TIMEOUT_MS || process.env.SMTP_SOCKET_MS || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(120000, Math.max(5000, raw));
}

/**
 * Render / cloud → external SMTP (e.g. Brevo) often needs 30–60s; short timeouts
 * yield "Connection timeout" while localhost on a fast path succeeds.
 */
function smtpForceIpv4() {
  // Always force IPv4 in production (especially on Render) to prevent smtp.gmail.com timeouts
  // Forcing true always to fix ENETUNREACH IPv6 errors in all environments
  return true;
}

const dns = require("dns");

async function getTransporter() {
  if (transporter) return transporter;
  if (!canUseSmtp()) return null;
  const ms = smtpTimeoutMs();

  let host = process.env.SMTP_HOST;
  if (smtpForceIpv4() && host) {
    try {
      const records = await dns.promises.resolve4(host);
      if (records && records.length > 0) {
        host = records[0];
      }
    } catch (err) {
      console.warn(`[email] DNS resolve4 failed for ${host}:`, err.message);
    }
  }

  transporter = nodemailer.createTransport({
    host: host,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      // Required when connecting to an IP instead of the original hostname
      servername: process.env.SMTP_HOST
    },
    connectionTimeout: ms,
    greetingTimeout: ms,
    socketTimeout: ms,
  });
  return transporter;
}

function hasEmailWebhook() {
  return Boolean(
    String(process.env.EMAIL_WEBHOOK_URL || process.env.TRIAL_EMAIL_WEBHOOK_URL || "").trim()
  );
}

/** Call once at startup in production to surface misconfiguration. */
async function logProductionEmailConfig() {
  if (process.env.NODE_ENV !== "production") return;
  if (canUseSmtp()) {
    const t = await getTransporter();
    if (!t) return;
    try {
      await t.verify();
      console.log(
        `[email] SMTP ready → ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} (timeouts ${smtpTimeoutMs()}ms).`
      );
    } catch (err) {
      console.error(
        `[email] SMTP verify failed (${process.env.SMTP_HOST}:${process.env.SMTP_PORT}): ${err?.message || err}`
      );
      console.error(
        "[email] Set valid SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (and SMTP_SECURE if needed). " +
          "On Render, also try SMTP_TIMEOUT_MS=60000 and SMTP_FORCE_IPV4=1."
      );
    }
    return;
  }
  if (hasEmailWebhook()) return;
  console.warn(
    "[email] Production: SMTP is not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) " +
      "and no EMAIL_WEBHOOK_URL / TRIAL_EMAIL_WEBHOOK_URL — invitation and system emails will not be delivered."
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWebhookFallback(payload) {
  const url = process.env.EMAIL_WEBHOOK_URL || process.env.TRIAL_EMAIL_WEBHOOK_URL;
  if (!url) {
    console.log(`[email] No webhook URL configured, skipping fallback`);
    return false;
  }
  try {
    console.log(`[email] Attempting webhook fallback to ${url}`);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      console.log(`[email] Webhook fallback successful`);
      return true;
    } else {
      console.warn(`[email] Webhook fallback failed with status ${r.status}`);
      return false;
    }
  } catch (err) {
    console.warn(`[email] Webhook fallback error: ${err.message}`);
    return false;
  }
}

function isPlausibleReplyToEmail(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s || s === String(process.env.SMTP_FROM || "").trim().toLowerCase()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sendEmailWithRetry({
  to,
  subject,
  text,
  html,
  replyTo = null,
  meta = {},
  retries = 3,
  initialBackoffMs = 500,
}) {
  console.log(`[email] Attempting to send email to ${to} with subject "${subject}"`);
  if (!to || !subject) {
    console.error(`[email] Failed: missing to or subject`);
    return { ok: false, reason: "missing_to_or_subject" };
  }
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || "no-reply@rndcrm.local";
  let smtpError = null;
  const replyToHeader = isPlausibleReplyToEmail(replyTo) ? String(replyTo).trim() : undefined;

  const t = await getTransporter();
  if (t) {
    let backoff = initialBackoffMs;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await t.sendMail({
          from,
          to,
          ...(replyToHeader ? { replyTo: replyToHeader } : {}),
          subject,
          text,
          html,
        });
        console.log(`[email] Sent via smtp to ${to} subject "${subject}" attempt=${attempt}`);
        return { ok: true, channel: "smtp", attempt };
      } catch (err) {
        smtpError = err?.message || String(err || "smtp_send_failed");
        console.warn(`[email] SMTP attempt failed ${attempt}/${retries}: ${smtpError}`);
        if (attempt >= retries) break;
        await sleep(backoff);
        backoff *= 2;
      }
    }
     if (smtpError) {
      transporter = null;
    }
  } else {
    console.warn(`⚠️ [email] SMTP transporter not configured, trying fallback`);
  }

  // Resend fallback
  try {
    const resendResult = await sendViaResend({ to, subject, html, text });
    if (resendResult.ok) {
      console.log(`✅ [email] Email sent successfully via Resend to ${to}`);
      return { ok: true, channel: "resend", data: resendResult.data };
    }
  } catch (resendError) {
    console.error(`❌ [email] Resend fallback failed:`, resendError.message);
  }

  const fallbackOk = await sendWebhookFallback({ type: "email_fallback", to, subject, text, html, meta });
  if (fallbackOk) {
    console.log(`[email] Sent via webhook fallback`);
    return { ok: true, channel: "webhook" };
  }
  console.error(`❌ [email] Failed to send email: All email methods failed for ${to}`, {
    smtpConfigured: !!t,
    webhookConfigured: !!process.env.EMAIL_WEBHOOK_URL,
    resendConfigured: !!process.env.RESEND_API_KEY,
  });
  return {
    ok: false,
    reason: "all_methods_failed",
    detail: smtpError || "No email service configured",
  };
}

async function sendViaResend({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'noreply@yourcrm.com',
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || `<p>${text}</p>`,
        text: text || html?.replace(/<[^>]*>/g, ''),
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Resend API error:', data);
      return { ok: false, error: data.message || 'Resend API failed' };
    }
    
    return { ok: true, data };
  } catch (error) {
    console.error('Resend fetch error:', error);
    return { ok: false, error: error.message };
  }
}

async function sendPasswordReset(email, { link, expiresHours = 1, userId = null } = {}) {
  const to = String(email || "").trim();
  if (!to || !link) return { queued: false, reason: "missing_email_or_link" };
  setImmediate(async () => {
    try {
      const result = await sendEmailWithRetry({
        to,
        subject: "Password reset",
        text: `Reset your password using this link (expires in ${expiresHours} hour(s)):\n\n${link}\n`,
        html: `<p>Reset your password using the link below (expires in ${expiresHours} hour(s)):</p><p><a href="${link}">${link}</a></p>`,
        meta: { type: "password_reset", user_id: userId },
      });
      if (!result?.ok) {
        console.error("Email failed:", result?.detail || result?.reason || "unknown_error");
      }
    } catch (err) {
      console.error("Email failed:", err.message);
    }
  });
  return { queued: true };
}

/**
 * Fired once after Stripe payment is confirmed.
 * Sends the tenant their workspace URL, package details, and login instructions.
 */
async function sendWelcomeEmail(email, {
  firstName = "there",
  companyName = "your company",
  tenantUrl,
  subdomain,
  packageName = "your plan",
  loginEmail,
  registrationKind = "paid",
} = {}) {
  const to = String(email || "").trim();
  if (!to || !tenantUrl) return { ok: false, reason: "missing_email_or_url" };

  const loginUrl = `${tenantUrl}/login`;
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@fitnessvitness.com";
  const isTrial = String(registrationKind || "").toLowerCase() === "trial";
  const subject = isTrial
    ? `Your 7-day trial is ready — ${companyName} on ${appName}`
    : `Your ${companyName} workspace is live on ${appName}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    ...(isTrial
      ? [
          `Your 7-day free trial for ${packageName} is active and your workspace registration is complete.`,
          `You will receive another email shortly with reminders, your workspace link, and tips to get started.`,
        ]
      : [
          `Your payment was confirmed and your registration is complete.`,
          `A confirmation email with your workspace link and further details will arrive shortly.`,
        ]),
    ``,
    `Workspace URL:  ${tenantUrl}`,
    `Login page:     ${loginUrl}`,
    `Plan:           ${packageName}`,
    `Login email:    ${loginEmail || to}`,
    ``,
    `Bookmark your workspace URL — you will use it every time you log in.`,
    ``,
    `If you have any questions, email us at ${supportEmail}.`,
    ``,
    `— ${appName} Team`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1d4ed8;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${appName}</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">${
                isTrial ? "Trial started" : "Workspace confirmation"
              }</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <!-- Check icon -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px;line-height:64px;text-align:center;">✓</div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font-size:22px;font-weight:600;color:#111827;text-align:center;">${
                isTrial ? "7-day trial is active" : "Payment &amp; registration complete"
              }</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;text-align:center;">${
                isTrial
                  ? `Hi ${firstName}, your <strong style="color:#111827;">${companyName}</strong> workspace is ready with full access for 7 days. You will receive follow-up details shortly by email.`
                  : `Hi ${firstName}, your <strong style="color:#111827;">${companyName}</strong> workspace is live. Keep this email — it includes your permanent workspace link and sign-in details.`
              }</p>

              <!-- Workspace URL box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;font-weight:600;">Your Workspace URL</p>
                    <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#1d4ed8;font-family:'Courier New',monospace;word-break:break-all;">${tenantUrl}</p>
                    <a href="${loginUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:7px;font-size:14px;font-weight:600;">Log in to your workspace</a>
                  </td>
                </tr>
              </table>

              <!-- Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:2px;">Plan</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${packageName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:2px;">Workspace</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${companyName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:2px;">Login email</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${loginEmail || to}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                <strong style="color:#374151;">Bookmark your workspace URL</strong> — it is unique to your company and you will use it every time you log in. Share it with your team members too.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                Questions? Email us at <a href="mailto:${supportEmail}" style="color:#6b7280;">${supportEmail}</a>
              </p>
              <p style="margin:6px 0 0;font-size:11px;color:#d1d5db;">${appName}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmailWithRetry({
    to,
    subject,
    text,
    html,
    meta: { type: isTrial ? "welcome_trial" : "welcome", subdomain, package: packageName },
  });
}

/**
 * Fired when a new user signs up and creates a workspace but hasn't paid yet.
 */
async function sendAccountCreatedEmail(email, { firstName = "there", companyName = "your company" } = {}) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };

  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Your account is created — ${appName}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your account for the workspace "${companyName}" has been successfully created.`,
    `Please proceed to complete your payment and finalize your workspace registration.`,
    ``,
    `— ${appName} Team`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);padding:40px 40px;text-align:center;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${appName}</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;text-transform:uppercase;">Account Created</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <div style="width:72px;height:72px;background:#dbeafe;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:36px;line-height:72px;text-align:center;color:#1d4ed8;">👤</div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#111827;text-align:center;">Welcome to ${appName}!</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;text-align:center;line-height:1.6;">
                Hi <strong style="color:#111827;">${firstName}</strong>, your account and workspace <strong style="color:#111827;">${companyName}</strong> have been successfully created. You're just one step away from exploring all features!
              </p>
              
              <div style="background:#f9fafb;border-radius:8px;padding:24px;margin-bottom:24px;border:1px solid #e5e7eb;">
                <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Next Step: Select a Package</p>
                <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;">
                  To fully activate your workspace and start inviting your team, please log in and complete your payment or start a free trial.
                </p>
              </div>

              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                If you closed the setup page, simply log in to your account to continue where you left off.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                Have questions? We're here to help at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@fitnessvitness.com'}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${process.env.SUPPORT_EMAIL || 'support@fitnessvitness.com'}</a>
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">${appName} © 2024</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmailWithRetry({
    to,
    subject,
    text,
    html,
    meta: { type: "account_created" },
  });
}

function appBaseUrl() {
  const base =
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    "https://365rndcrm.vercel.app";
  return String(base).replace(/\/+$/, "");
}

function pendingEmailHtml({
  subject,
  title,
  subtitle,
  firstName,
  companyName,
  tenantUrl,
  ctaUrl,
  ctaLabel,
  statusLabel,
  packageName,
  loginEmail,
}) {
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@fitnessvitness.com";
  const safeCtaUrl = String(ctaUrl || appBaseUrl()).trim();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:36px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#111827;padding:28px 36px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${appName}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#d1d5db;text-transform:uppercase;letter-spacing:.6px;">${statusLabel}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;">
            <p style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;text-align:center;">${title}</p>
            <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4b5563;text-align:center;">Hi ${firstName || "there"}, ${subtitle}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:24px;">
              <tr><td style="padding:16px 18px;border-bottom:1px solid #f3f4f6;">
                <span style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Workspace</span>
                <strong style="font-size:14px;color:#111827;">${companyName || "your workspace"}</strong>
              </td></tr>
              ${packageName ? `<tr><td style="padding:16px 18px;border-bottom:1px solid #f3f4f6;">
                <span style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Plan</span>
                <strong style="font-size:14px;color:#111827;">${packageName}</strong>
              </td></tr>` : ""}
              ${loginEmail ? `<tr><td style="padding:16px 18px;border-bottom:1px solid #f3f4f6;">
                <span style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Login email</span>
                <strong style="font-size:14px;color:#111827;">${loginEmail}</strong>
              </td></tr>` : ""}
              ${tenantUrl ? `<tr><td style="padding:16px 18px;">
                <span style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Reserved workspace URL</span>
                <a href="${tenantUrl}" style="font-size:14px;color:#1d4ed8;font-weight:700;text-decoration:none;word-break:break-all;">${tenantUrl}</a>
              </td></tr>` : ""}
            </table>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;">
                Your workspace URL is reserved, but login on that domain will work only after super-admin database activation.
              </p>
            </div>
            <p style="text-align:center;margin:0 0 20px;">
              <a href="${safeCtaUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;">${ctaLabel}</a>
            </p>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;text-align:center;">
              Questions? Email <a href="mailto:${supportEmail}" style="color:#1d4ed8;">${supportEmail}</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWorkspaceCreatedPendingEmail(
  email,
  { firstName = "there", companyName = "your workspace", tenantUrl = "", addPackageUrl = "" } = {}
) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Workspace created - choose your package`;
  const ctaUrl = addPackageUrl || `${appBaseUrl()}/add-package?onboarding=1`;
  const text = [
    `Hi ${firstName},`,
    ``,
    `Your ${companyName} workspace has been created and the workspace URL is reserved.`,
    tenantUrl ? `Reserved workspace URL: ${tenantUrl}` : null,
    ``,
    `Next step: choose a package, start your trial, or complete payment here:`,
    ctaUrl,
    ``,
    `Workspace-domain login will be enabled after super-admin database activation.`,
    ``,
    `- ${appName} Team`,
  ].filter((line) => line != null).join("\n");
  return sendEmailWithRetry({
    to,
    subject,
    text,
    html: pendingEmailHtml({
      subject,
      title: "Workspace created",
      subtitle: `your ${companyName} workspace is created. Choose a package or start a trial from the main site to continue.`,
      firstName,
      companyName,
      tenantUrl,
      ctaUrl,
      ctaLabel: "Choose package",
      statusLabel: "Workspace reserved",
      loginEmail: to,
    }),
    meta: { type: "workspace_created_pending" },
  });
}

async function sendPackageTrialPendingVerificationEmail(
  email,
  { firstName = "there", companyName = "your workspace", tenantUrl = "", packageName = "your plan", loginEmail = "" } = {}
) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Trial started - workspace verification pending`;
  const ctaUrl = `${appBaseUrl()}/workspace-pending`;
  const text = [
    `Hi ${firstName},`,
    ``,
    `Your 7-day trial for ${packageName} has started.`,
    `Your workspace is pending super-admin database activation before workspace-domain login is enabled.`,
    tenantUrl ? `Reserved workspace URL: ${tenantUrl}` : null,
    `Login email: ${loginEmail || to}`,
    ``,
    `Check status: ${ctaUrl}`,
    ``,
    `- ${appName} Team`,
  ].filter((line) => line != null).join("\n");
  return sendEmailWithRetry({
    to,
    subject,
    text,
    html: pendingEmailHtml({
      subject,
      title: "Trial started",
      subtitle: `your 7-day trial for ${packageName} is active. Workspace login will open after database activation.`,
      firstName,
      companyName,
      tenantUrl,
      ctaUrl,
      ctaLabel: "View verification status",
      statusLabel: "Trial active",
      packageName,
      loginEmail: loginEmail || to,
    }),
    meta: { type: "trial_pending_verification", package: packageName },
  });
}

async function sendPaymentPendingVerificationEmail(
  email,
  { firstName = "there", companyName = "your workspace", tenantUrl = "", packageName = "your plan", loginEmail = "" } = {}
) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Payment successful - workspace verification pending`;
  const ctaUrl = `${appBaseUrl()}/workspace-pending`;
  const text = [
    `Hi ${firstName},`,
    ``,
    `Payment for ${packageName} was successful.`,
    `Your workspace is pending super-admin database activation before workspace-domain login is enabled.`,
    tenantUrl ? `Reserved workspace URL: ${tenantUrl}` : null,
    `Login email: ${loginEmail || to}`,
    ``,
    `Check status: ${ctaUrl}`,
    ``,
    `- ${appName} Team`,
  ].filter((line) => line != null).join("\n");
  return sendEmailWithRetry({
    to,
    subject,
    text,
    html: pendingEmailHtml({
      subject,
      title: "Payment successful",
      subtitle: `your payment for ${packageName} is complete. Workspace login will open after database activation.`,
      firstName,
      companyName,
      tenantUrl,
      ctaUrl,
      ctaLabel: "View verification status",
      statusLabel: "Payment complete",
      packageName,
      loginEmail: loginEmail || to,
    }),
    meta: { type: "payment_pending_verification", package: packageName },
  });
}

async function sendWorkspaceReadyEmail(
  email,
  { firstName = "there", companyName = "your workspace", tenantUrl = "", packageName = "your plan", loginEmail = "" } = {}
) {
  const to = String(email || "").trim();
  const workspaceUrl = String(tenantUrl || "").trim();
  if (!to || !workspaceUrl) return { ok: false, reason: "missing_email_or_url" };
  const loginUrl = `${workspaceUrl.replace(/\/+$/, "")}/login`;
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Your workspace is ready`;
  const text = [
    `Hi ${firstName},`,
    ``,
    `Your ${companyName} workspace is ready to use.`,
    `Workspace URL: ${workspaceUrl}`,
    `Login page: ${loginUrl}`,
    `Plan: ${packageName}`,
    `Login email: ${loginEmail || to}`,
    ``,
    `Please use your workspace URL for all future logins.`,
    ``,
    `- ${appName} Team`,
  ].join("\n");
  return sendEmailWithRetry({
    to,
    subject,
    text,
    html: pendingEmailHtml({
      subject,
      title: "Workspace ready",
      subtitle: `your ${companyName} database has been activated. You can now log in on your workspace URL.`,
      firstName,
      companyName,
      tenantUrl: workspaceUrl,
      ctaUrl: loginUrl,
      ctaLabel: "Log in to workspace",
      statusLabel: "Workspace active",
      packageName,
      loginEmail: loginEmail || to,
    }).replace(
      "Your workspace URL is reserved, but login on that domain will work only after super-admin database activation.",
      "Your workspace database is active. Use this workspace URL for all future logins."
    ),
    meta: { type: "workspace_ready", package: packageName },
  });
}

/**
 * Fired when a payment is successful.
 */
async function sendPaymentDoneEmail(
  email,
  { firstName = "there", packageName = "your plan", tenantUrl = "", companyName = "your workspace" } = {}
) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };

  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const subject = `Payment successful — ${appName}`;
  const workspaceUrl = String(tenantUrl || "").trim();
  const loginUrl = workspaceUrl ? `${workspaceUrl}/login` : "";

  const text = [
    `Hi ${firstName},`,
    ``,
    `We have successfully received your payment for the ${packageName} plan.`,
    workspaceUrl
      ? `Your ${companyName} workspace is now ready to use.`
      : `Your workspace will be ready shortly.`,
    ...(workspaceUrl
      ? [
          ``,
          `Workspace URL: ${workspaceUrl}`,
          `Login page: ${loginUrl}`,
        ]
      : []),
    ``,
    `— ${appName} Team`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg, #10b981 0%, #059669 100%);padding:40px 40px;text-align:center;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${appName}</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;text-transform:uppercase;">Payment Successful</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <div style="width:72px;height:72px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:40px;line-height:72px;text-align:center;color:#10b981;">✓</div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#111827;text-align:center;">Thank You For Your Payment!</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;text-align:center;line-height:1.6;">
                Hi <strong style="color:#111827;">${firstName}</strong>, your payment for the <strong style="color:#111827;">${packageName}</strong> plan has been successfully processed. 
                ${workspaceUrl ? `Your workspace is now ready.` : `Your workspace will be ready shortly.`}
              </p>
              
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Status</span>
                    <span style="font-size:14px;font-weight:600;color:#10b981;">✓ Paid Successfully</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Plan</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${packageName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Workspace</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${companyName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Email Used</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${to}</span>
                  </td>
                </tr>
                ${workspaceUrl ? `
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Workspace URL</span>
                    <a href="${workspaceUrl}" style="font-size:14px;font-weight:600;color:#1d4ed8;text-decoration:none;word-break:break-all;">${workspaceUrl}</a>
                  </td>
                </tr>
                ` : ""}
              </table>
              
              ${workspaceUrl ? `
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${loginUrl}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;border:none;cursor:pointer;">Go to Workspace Login</a>
              </div>
              ` : ""}
              
              <div style="background:#f9fafb;border-radius:8px;padding:24px;border:1px solid #e5e7eb;">
                <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Production Label</p>
                <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;">
                  This confirms an official payment processing for ${companyName}.
                </p>
              </div>

            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                Have questions? We're here to help at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@fitnessvitness.com'}" style="color:#10b981;text-decoration:none;font-weight:600;">${process.env.SUPPORT_EMAIL || 'support@fitnessvitness.com'}</a>
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">${appName} © 2024</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmailWithRetry({
    to,
    subject,
    text,
    html,
    meta: { type: "payment_done" },
  });
}

/**
 * Send unified workspace activation email for both free trial and paid subscriptions.
 * Notifies users that their workspace is activated with payment complete.
 */
async function sendWorkspaceActivatedEmail(
  email,
  {
    firstName = "there",
    companyName = "your workspace",
    tenantUrl = "",
    packageName = "your plan",
    paymentType = "paid", // 'trial' or 'paid'
    loginEmail = "",
  } = {}
) {
  const to = String(email || "").trim();
  if (!to) return { ok: false, reason: "missing_email" };

  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const workspaceUrl = String(tenantUrl || "").trim();
  const loginUrl = workspaceUrl ? `${workspaceUrl}/login` : "";
  const isTrial = String(paymentType || "").toLowerCase() === "trial";

  const subject = "Payment Successful - Workspace Activated";

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your workspace has been successfully activated!`,
    ``,
    ...(isTrial
      ? [
          `You are now on a 7-day free trial with full access to the ${packageName} plan.`,
          `Your trial starts now and expires in 7 days.`,
        ]
      : [
          `Your payment has been processed successfully.`,
          `Your ${packageName} subscription is now active.`,
        ]),
    ``,
    ...(workspaceUrl
      ? [
          `Workspace URL: ${workspaceUrl}`,
          `Login page: ${loginUrl}`,
          `Company: ${companyName}`,
          `Plan: ${packageName}`,
          `Login email: ${loginEmail || to}`,
        ]
      : []),
    ``,
    `Next steps:`,
    `• Log in to your workspace and set up your team`,
    `• Invite team members to collaborate`,
    `• Configure your workspace settings`,
    ``,
    `Bookmark your workspace URL for future logins.`,
    ``,
    `— ${appName} Team`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg, #10b981 0%, #059669 100%);padding:40px 40px;text-align:center;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${appName}</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;text-transform:uppercase;">Workspace Activated</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <!-- Check icon -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <div style="width:72px;height:72px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:40px;line-height:72px;text-align:center;color:#10b981;">✓</div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#111827;text-align:center;">Payment Successful!</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;text-align:center;line-height:1.6;">
                Your <strong style="color:#111827;">${companyName}</strong> workspace is now fully activated and ready to use.
                ${isTrial ? "Enjoy your 7-day free trial with full access!" : "Thank you for your subscription."}
              </p>

              <!-- Workspace details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 16px;font-size:13px;text-transform:uppercase;letter-spacing:0.8px;color:#047857;font-weight:700;">Workspace Ready</p>
                    
                    ${workspaceUrl ? `
                    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">Workspace URL</p>
                    <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#10b981;font-family:'Courier New',monospace;word-break:break-all;">${workspaceUrl}</p>
                    
                    <a href="${loginUrl}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;border:none;cursor:pointer;text-align:center;">Log in Now</a>
                    ` : ""}
                  </td>
                </tr>
              </table>

              <!-- Details grid -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Status</span>
                    <span style="font-size:14px;font-weight:600;color:#10b981;">✓ Activated</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Plan</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${packageName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #f3f4f6;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Workspace</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${companyName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-size:12px;color:#9ca3af;display:block;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Login Email</span>
                    <span style="font-size:14px;font-weight:600;color:#111827;">${loginEmail || to}</span>
                  </td>
                </tr>
              </table>

              <!-- Next steps -->
              <div style="background:#f9fafb;border-radius:8px;padding:24px;margin-bottom:24px;">
                <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Next Steps</p>
                <ul style="margin:0;padding-left:20px;color:#6b7280;font-size:13px;line-height:1.8;">
                  <li>Log in to your workspace and explore the features</li>
                  <li>Invite your team members to start collaborating</li>
                  <li>Configure your workspace settings and preferences</li>
                  <li>${isTrial ? "Upgrade to a paid plan before your trial expires" : "Enjoy unlimited access to your workspace"}</li>
                </ul>
              </div>

              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                <strong style="color:#374151;">Bookmark your workspace URL</strong> — you will use it every time you log in. Share it with your team members to get started.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                Have questions? We're here to help at <a href="mailto:${process.env.SUPPORT_EMAIL || "support@fitnessvitness.com"}" style="color:#10b981;text-decoration:none;font-weight:600;">${process.env.SUPPORT_EMAIL || "support@fitnessvitness.com"}</a>
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">${appName} © 2024</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmailWithRetry({
    to,
    subject,
    text,
    html,
    meta: { type: "workspace_activated", paymentType },
  });
}

module.exports = {
  sendEmailWithRetry,
  sendViaResend,
  sendPasswordReset,
  sendWelcomeEmail,
  sendAccountCreatedEmail,
  sendWorkspaceCreatedPendingEmail,
  sendPackageTrialPendingVerificationEmail,
  sendPaymentPendingVerificationEmail,
  sendWorkspaceReadyEmail,
  sendPaymentDoneEmail,
  sendWorkspaceActivatedEmail,
  canUseSmtp,
  logProductionEmailConfig,
};
