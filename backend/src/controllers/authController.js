const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { mainPool } = require("../config/database");
const { sendPasswordReset } = require("../services/emailService");
const { reserveSubdomain } = require("../services/subdomainService");
const {
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  sha256hex,
  verifyRefreshToken,
  getCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} = require("../services/authService");
const { validateTenantSubdomain } = require("../services/tenantDatabaseService");

const RESET_TOKEN_BYTES = 32;
const RESET_EXPIRY_HOURS = 1;

function superAdminEmailSet() {
  const raw = [
    String(process.env.PLATFORM_SUPERADMIN_EMAILS || ""),
    String(process.env.SUPERADMIN_EMAILS || ""),
    String(process.env.SUPERADMIN_EMAIL || ""),
    String(process.env.SEED_SUPERADMIN_EMAIL || "iamsatyamsingh91@gmail.com"),
  ]
    .filter(Boolean)
    .join(",");
  return new Set(
    raw
      .split(",")
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

async function reconcileConfiguredPlatformSuperAdmin(user) {
  if (!user?.id || !user?.email) return user;
  const normalizedEmail = String(user.email).trim().toLowerCase();
  const configured = superAdminEmailSet();
  if (!configured.has(normalizedEmail)) return user;

  const needsUpdate =
    Number(user.is_platform_admin) !== 1 ||
    String(user.role || "").toLowerCase() !== "admin" ||
    (user.tenant_id != null && String(user.tenant_id).trim() !== "");
  if (!needsUpdate) return user;

  await mainPool.execute(
    `UPDATE users
     SET is_platform_admin = 1,
         role = 'admin',
         tenant_id = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [user.id]
  );
  return {
    ...user,
    is_platform_admin: 1,
    role: "admin",
    tenant_id: null,
  };
}

function requestHostOnly(req) {
  const forwarded = String(req?.headers?.["x-forwarded-host"] || "").trim();
  const host = (forwarded || String(req?.headers?.host || "")).split(",")[0].trim();
  return host.split(":")[0].toLowerCase();
}

function normalizedDomain(raw) {
  return String(raw || "").trim().replace(/^\./, "").toLowerCase();
}

function shouldForceHostOnlyCookies(host) {
  const h = String(host || "").toLowerCase();
  // Managed shared domains frequently enforce public-suffix-like isolation.
  // Setting Domain cookies there can be rejected silently by browsers.
  return h.endsWith(".vercel.app") || h.endsWith(".onrender.com");
}

function cookieBaseOpts(req) {
  const domainRaw = String(process.env.COOKIE_DOMAIN || "").trim();
  const sameSiteRaw = String(process.env.COOKIE_SAMESITE || "lax").trim().toLowerCase();
  const sameSite = ["lax", "strict", "none"].includes(sameSiteRaw) ? sameSiteRaw : "lax";
  // Cross-site cookies require SameSite=None + Secure=true.
  let secure =
    sameSite === "none"
      ? true
      : String(process.env.COOKIE_SECURE || "").trim() === "true" || process.env.NODE_ENV === "production";

  // Override secure flag for localhost development
  const host = requestHostOnly(req);
  if (host === "localhost" || host === "127.0.0.1") {
    secure = false;
  }

  // Host-only cookies are safest by default; only set explicit domain when configured.
  // For workspace subdomains (tenant_slug.APP_DOMAIN) to share auth with the apex app after
  // post-login redirect, set e.g. COOKIE_DOMAIN=.365rndcrm.vercel.app on the API (Render).
  let domain = undefined;
  if (domainRaw && domainRaw.toLowerCase() !== "auto") {
    const cfg = normalizedDomain(domainRaw);
    if (shouldForceHostOnlyCookies(host)) {
      console.warn(
        `[auth] Host '${host}' is on a managed shared domain; using host-only cookies (ignoring COOKIE_DOMAIN='${domainRaw}').`
      );
    } else {
      const matchesHost = host && (host === cfg || host.endsWith(`.${cfg}`));
      if (matchesHost) {
        domain = domainRaw;
      } else if (host) {
        console.warn(
          `[auth] COOKIE_DOMAIN '${domainRaw}' does not match request host '${host}'. Falling back to host-only cookies.`
        );
      }
    }
  }
  const opts = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };
  if (domain) {
    opts.domain = domain;
  }
  return opts;
}

function clearCookieOpts(o) {
  const out = { path: o.path, httpOnly: o.httpOnly, secure: o.secure, sameSite: o.sameSite };
  if (o.domain) out.domain = o.domain;
  return out;
}

function normalizeOrigin(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function buildConfiguredOrigins() {
  const out = [];
  const push = (value) => {
    const normalized = normalizeOrigin(value);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  };
  for (const src of String(process.env.ALLOWED_ORIGINS || "").split(",")) {
    push(src);
  }
  push(process.env.FRONTEND_URL);
  push(process.env.CLIENT_URL);
  push(process.env.APP_URL);
  return out;
}

function isOriginAllowedForAuth(origin, configuredOrigins) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const base = String(process.env.APP_BASE_DOMAIN || "localhost")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost") ||
      host === base ||
      host.endsWith(`.${base}`)
    );
  } catch {
    return false;
  }
}

function buildAuthDiagnostics(req, extra = {}) {
  const configuredOrigins = buildConfiguredOrigins();
  const origin = String(req.get("origin") || "").trim() || null;
  const host = requestHostOnly(req) || null;
  const sameSiteRaw = String(process.env.COOKIE_SAMESITE || "lax").trim().toLowerCase();
  const sameSite = ["lax", "strict", "none"].includes(sameSiteRaw) ? sameSiteRaw : "lax";
  const cookieDomain = String(process.env.COOKIE_DOMAIN || "").trim() || null;
  const cookieSecure =
    sameSite === "none"
      ? true
      : String(process.env.COOKIE_SECURE || "").trim() === "true" || process.env.NODE_ENV === "production";

  return {
    request_id: req.request_id || null,
    node_env: process.env.NODE_ENV || "development",
    auth_configured: {
      jwt_secret: Boolean(String(process.env.JWT_SECRET || "").trim()),
      jwt_refresh_secret: Boolean(String(process.env.JWT_REFRESH_SECRET || "").trim()),
    },
    request: {
      origin,
      host,
      origin_allowed: isOriginAllowedForAuth(origin, configuredOrigins),
      tenant_subdomain: String(req.get("x-tenant-subdomain") || "").trim() || null,
    },
    cookie_policy: {
      sameSite,
      secure: cookieSecure,
      domain: cookieDomain,
      host_only: !cookieDomain || cookieDomain.toLowerCase() === "auto",
    },
    ...extra,
  };
}

function setAccessCookie(req, res, token) {
  res.cookie(ACCESS_COOKIE, token, {
    ...cookieBaseOpts(req),
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
  });
}

function setRefreshCookie(req, res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieBaseOpts(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function setTenantIdCookie(req, res, tenantId) {
  res.cookie("tenant_id", tenantId, {
    ...cookieBaseOpts(req),
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function clearAuthCookies(req, res) {
  const o = cookieBaseOpts(req);
  const c = clearCookieOpts(o);
  res.clearCookie(ACCESS_COOKIE, c);
  res.clearCookie(REFRESH_COOKIE, c);
}

function publicUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    role: String(row.role || "staff").toLowerCase(),
    tenant_id: row.tenant_id || null,
    is_platform_admin: Number(row.is_platform_admin) === 1,
    email_verified: Number(row.email_verified) === 1,
  };
}

function slugFromCompanyName(name, tenantId) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = String(tenantId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  const candidate = `${base || "tenant"}${suffix ? `-${suffix}` : ""}`.slice(0, 40);
  const checked = validateTenantSubdomain(candidate);
  if (checked.ok) return checked.slug;
  return `tenant-${suffix || "crm"}`.slice(0, 40);
}

async function loadUserById(id) {
  const [rows] = await mainPool.execute(
    `SELECT id, clerk_user_id, email, first_name, last_name, role, tenant_id, is_active,
            COALESCE(is_platform_admin, 0) AS is_platform_admin,
            COALESCE(email_verified, 0) AS email_verified,
            password_hash
     FROM users WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function login(req, res) {
  try {
    console.log(`[auth] Login attempt received`);
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    const password = req.body?.password;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: "AUTH_BAD_INPUT",
        message: "email and password are required.",
        diagnostics: buildAuthDiagnostics(req, { stage: "input_validation" }),
      });
    }

    // FIXED: login reads user directly via mainPool (no transaction connection)
    const [rows] = await mainPool.execute(
      `SELECT * FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
    let user = rows[0];
    if (!user) {
      console.log('[auth] Login failed: user not found');
      return res.status(401).json({
        success: false,
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Invalid email or password.",
        diagnostics: buildAuthDiagnostics(req, { stage: "user_lookup" }),
      });
    }

    user = await reconcileConfiguredPlatformSuperAdmin(user);
    console.log(`[auth] User found for login, id=${user.id}`);

    const passwordField = user.password_hash || user.password || user.hashed_password;

    if (!passwordField) {
      console.log('LOGIN ATTEMPT: User has no password field, triggering migration logic');
      // 🚀 MIGRATION LOGIC: User exists but has no password (migrated from Clerk)
      // Automatically generate a reset token and send them an email to set a password.
      try {
        const plain = crypto.randomBytes(32).toString("hex");
        const tokenHash = sha256hex(plain);
        const expires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour expiry
        await mainPool.execute(
          `UPDATE users SET password_reset_token = ?, password_reset_expires = ?, updated_at = NOW() WHERE id = ?`,
          [tokenHash, expires, user.id]
        );

        const link = `${frontendBaseUrl()}/reset-password?token=${encodeURIComponent(plain)}`;

        await sendPasswordReset(user.email, {
          link,
          expiresHours: 1,
          userId: user.id,
        });

        return res.status(403).json({
          success: false,
          code: "AUTH_PASSWORD_SETUP_REQUIRED",
          message: "We've upgraded our secure login system! An email has just been sent to you with a link to set your new password. Please check your inbox.",
          diagnostics: buildAuthDiagnostics(req, { stage: "password_migration" }),
        });
      } catch (err) {
        console.error("Auto password reset failed:", err);
        return res.status(401).json({
          success: false,
          code: "AUTH_PASSWORD_SETUP_FAILED",
          message: "Please use the 'Forgot Password' link to set a password for your account.",
          diagnostics: buildAuthDiagnostics(req, { stage: "password_migration_email", error: String(err?.message || "") }),
        });
      }
    }

    // FIXED: login password verification via bcrypt.compare
    const ok = await bcrypt.compare(String(password), String(passwordField));
    if (!ok) {
      console.log('LOGIN FAIL: Password did not match bcrypt hash for user:', email);
      return res.status(401).json({
        success: false,
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Invalid email or password.",
        diagnostics: buildAuthDiagnostics(req, { stage: "password_compare" }),
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        code: "AUTH_USER_DEACTIVATED",
        message: "Your account has been deactivated. Contact support.",
        diagnostics: buildAuthDiagnostics(req, { stage: "active_check" }),
      });
    }

    if (user.tenant_id && !user.is_platform_admin) {
      const [tenantRows] = await mainPool.execute(
        "SELECT subdomain, slug, subdomain_status, status FROM tenants WHERE id = ? LIMIT 1",
        [user.tenant_id]
      );
      const tenant = tenantRows[0];

      if (!tenant) {
        return res.status(403).json({
          success: false,
          code: "AUTH_WORKSPACE_NOT_FOUND",
          message: "Workspace not found or not created yet for this account.",
        });
      }

      const reqSubdomain = String(req.headers["x-tenant-subdomain"] || req.headers["x-tenant-slug"] || "").trim().toLowerCase();
      const tenantSub = String(tenant.subdomain || tenant.slug || "").trim().toLowerCase();

      const assignedWorkspaceUrl = tenantSub
        ? `https://${tenantSub}.${process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app"}`
        : "";

      // Block apex login when tenant status is active (paid + workspace live).
      // Don't gate on subdomain_status — that field may lag behind actual workspace state.
      const workspaceActive = tenantSub && tenant.status === "active";

      if (tenantSub) {
        if (reqSubdomain && reqSubdomain !== tenantSub) {
          // Always block wrong-subdomain attempts regardless of status.
          return res.status(403).json({
            success: false,
            code: "AUTH_WORKSPACE_MISMATCH",
            message: `Please log in via your assigned workspace URL: ${assignedWorkspaceUrl}`,
            assigned_workspace_url: assignedWorkspaceUrl,
          });
        }
        if (!reqSubdomain && workspaceActive) {
          // Apex login blocked — workspace is live.
          return res.status(403).json({
            success: false,
            code: "AUTH_WORKSPACE_MISMATCH",
            message: `Please log in via your assigned workspace URL: ${assignedWorkspaceUrl}`,
            assigned_workspace_url: assignedWorkspaceUrl,
          });
        }
      }
    }

    const tenantId = user.tenant_id && String(user.tenant_id).trim() !== "" ? user.tenant_id : null;
    const access = generateAccessToken({
      userId: user.id,
      tenantId,
      role: user.role,
      is_platform_admin: user.is_platform_admin,
    });
    const refresh = generateRefreshToken({ userId: user.id });
    await saveRefreshToken(user.id, refresh);

    setAccessCookie(req, res, access);
    setRefreshCookie(req, res, refresh);

    // Set tenant_id cookie for pending_payment redirects
    if (tenantId) {
      setTenantIdCookie(req, res, tenantId);
    }

    // Build tenant info for response
    let tenantInfo = null;
    let redirectUrl = "/dashboard";
    if (tenantId && !user.is_platform_admin) {
      const [tenantRows] = await mainPool.execute(
        "SELECT subdomain, slug, subdomain_status, status FROM tenants WHERE id = ? LIMIT 1",
        [tenantId]
      );
      const tenant = tenantRows[0];
      if (tenant) {
        tenantInfo = {
          subdomain: tenant.subdomain || tenant.slug,
          status: tenant.status,
          subdomain_status: tenant.subdomain_status,
        };
        if (tenant.status === "pending_payment") {
          redirectUrl = "/add-package?onboarding=1";
        }
      }
    }

    res.json({
      success: true,
      message: "Signed in",
      token: access,
      refreshToken: refresh,
      user: {
        id: user.id,
        email: user.email,
        role: String(user.role || "staff").toLowerCase(),
        tenant_id: tenantId,
        is_platform_admin: Number(user.is_platform_admin) === 1 ? 1 : 0,
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        profile_image: user.profile_profile || null,
      },
      tenant: tenantInfo,
      redirectUrl,
    });
  } catch (e) {
    if (/JWT_SECRET|JWT_REFRESH_SECRET/.test(e.message || "")) {
      return res.status(503).json({
        success: false,
        code: "AUTH_SERVER_MISCONFIGURED",
        message: "Server auth is not configured.",
        diagnostics: buildAuthDiagnostics(req, { stage: "token_config", error: String(e?.message || "") }),
      });
    }
    console.error("auth login:", e);
    res.status(500).json({
      success: false,
      code: "AUTH_LOGIN_INTERNAL_ERROR",
      message: e.message || "Login failed",
      diagnostics: buildAuthDiagnostics(req, { stage: "login_catch", error: String(e?.message || "") }),
    });
  }
}

async function refresh(req, res) {
  try {
    const cookieHeader = req.headers?.cookie || "";
    const matches = [...cookieHeader.matchAll(new RegExp(`(?:^|;\\s*)${REFRESH_COOKIE}=([^;]+)`, "g"))];
    const tokens = [];

    for (const match of matches) {
      try {
        tokens.push(decodeURIComponent(match[1].trim()));
      } catch {
        tokens.push(match[1].trim());
      }
    }

    const bodyToken = req.body?.refreshToken || req.body?.refresh_token;
    if (bodyToken) tokens.push(bodyToken);

    if (!tokens.length) {
      return res.status(401).json({ success: false, message: "No refresh token" });
    }

    let decoded = null;
    let validTokenRaw = null;

    for (const raw of tokens) {
      try {
        decoded = verifyRefreshToken(raw);
        validTokenRaw = raw;
        break; // Found a valid token
      } catch {
        // Continue trying other tokens
      }
    }

    if (!decoded || !validTokenRaw) {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const userId = Number(decoded.sub);
    if (!userId || Number.isNaN(userId)) {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const tokenHash = sha256hex(validTokenRaw);
    const [tokRows] = await mainPool.execute(
      `SELECT id FROM refresh_tokens WHERE token_hash = ? AND user_id = ? AND expires_at > NOW() LIMIT 1`,
      [tokenHash, userId]
    );
    if (!tokRows.length) {
      return res.status(401).json({ success: false, message: "Refresh token revoked or expired" });
    }

    let user = await loadUserById(userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    user = await reconcileConfiguredPlatformSuperAdmin(user);

    // Same subdomain enforcement as login.
    // Refresh is a silent re-auth — if the user has a workspace subdomain,
    // they must be calling this from that subdomain, not the apex domain.
    if (user.tenant_id && !user.is_platform_admin) {
      const [tenantRows] = await mainPool.execute(
        "SELECT subdomain, slug, subdomain_status, status FROM tenants WHERE id = ? LIMIT 1",
        [user.tenant_id]
      );
      const tenant = tenantRows[0];
      const tenantSub = String(tenant?.subdomain || tenant?.slug || "").trim().toLowerCase();
      // Same rule as login: block apex refresh when tenant is active.
      const workspaceActive = tenantSub && tenant?.status === "active";

      if (workspaceActive) {
        const reqSubdomain = String(req.headers["x-tenant-subdomain"] || req.headers["x-tenant-slug"] || "").trim().toLowerCase();
        if (!reqSubdomain || reqSubdomain !== tenantSub) {
          const assignedUrl = `https://${tenantSub}.${process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app"}`;
          return res.status(403).json({
            success: false,
            code: "AUTH_WORKSPACE_MISMATCH",
            message: `Please access your workspace at: ${assignedUrl}`,
            assigned_workspace_url: assignedUrl,
          });
        }
      }
    }

    const tenantId = user.tenant_id && String(user.tenant_id).trim() !== "" ? user.tenant_id : null;
    const access = generateAccessToken({
      userId: user.id,
      tenantId,
      role: user.role,
      is_platform_admin: user.is_platform_admin,
    });
    setAccessCookie(req, res, access);

    res.json({ success: true, message: "Token refreshed", token: access });
  } catch (e) {
    if (/JWT_SECRET|JWT_REFRESH_SECRET/.test(e.message || "")) {
      return res.status(503).json({ success: false, message: "Server auth is not configured." });
    }
    console.error("auth refresh:", e);
    res.status(500).json({ success: false, message: e.message || "Refresh failed" });
  }
}

async function logout(req, res) {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (raw) {
      await revokeRefreshToken(sha256hex(raw));
    }
    clearAuthCookies(req, res);
    res.json({ success: true, message: "Signed out" });
  } catch (e) {
    console.error("auth logout:", e);
    clearAuthCookies(req, res);
    res.json({ success: true, message: "Signed out" });
  }
}

function frontendBaseUrl() {
  const u =
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return String(u).replace(/\/+$/, "");
}

async function forgotPassword(req, res) {
  const generic = {
    success: true,
    message: "If an account exists for that email, a reset link has been sent.",
  };
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "email is required." });
    }

    const [rows] = await mainPool.execute(
      `SELECT id, email, first_name FROM users WHERE LOWER(email) = ? LIMIT 1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.json(generic);
    }

    const plain = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
    const tokenHash = sha256hex(plain);
    const expires = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);
    await mainPool.execute(
      `UPDATE users SET password_reset_token = ?, password_reset_expires = ?, updated_at = NOW() WHERE id = ?`,
      [tokenHash, expires, user.id]
    );

    const link = `${frontendBaseUrl()}/reset-password?token=${encodeURIComponent(plain)}`;
    // FIXED: 11 emailService bad SMTP should not block password reset response
    await sendPasswordReset(user.email, {
      link,
      expiresHours: RESET_EXPIRY_HOURS,
      userId: user.id,
    });

    return res.json(generic);
  } catch (e) {
    console.error("auth forgotPassword:", e);
    return res.json(generic);
  }
}

async function resetPassword(req, res) {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = req.body?.password ?? req.body?.newPassword;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: "token and password are required." });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const tokenHash = sha256hex(token);
    const [rows] = await mainPool.execute(
      `SELECT id FROM users
       WHERE password_reset_token = ? AND password_reset_expires IS NOT NULL AND password_reset_expires > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
    }

    const userId = rows[0].id;
    const pw = await hashPassword(newPassword);
    await mainPool.execute(
      `UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL, updated_at = NOW()
       WHERE id = ?`,
      [pw, userId]
    );
    await revokeAllUserTokens(userId);

    res.json({ success: true, message: "Password updated. You can sign in with your new password." });
  } catch (e) {
    console.error("auth resetPassword:", e);
    res.status(500).json({ success: false, message: e.message || "Reset failed" });
  }
}

/**
 * Email/password signup (no Clerk). Creates tenant + trial subscription when needed.
 */
async function signup(req, res) {
  try {
    const { name, company_name, email, password } = req.body || {};
    if (!email || !password || !name || !company_name) {
      return res.status(400).json({ success: false, message: "name, company_name, email, password are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts.shift() || "";
    const lastName = nameParts.join(" ") || "";
    const emailNorm = String(email).trim().toLowerCase();
    const pwHash = await hashPassword(password);

    // FIXED: 2 signup wrapped in transaction for atomic user+tenant provisioning
    const conn = await mainPool.getConnection();
    let user;
    try {
      await conn.beginTransaction();
      let userId;
      try {
        const [ins] = await conn.execute(
          `INSERT INTO users (clerk_user_id, email, password_hash, first_name, last_name, role, is_active, email_verified)
           VALUES (NULL, ?, ?, ?, ?, 'manager', 1, 0)`,
          [emailNorm, pwHash, firstName, lastName]
        );
        userId = ins.insertId;
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") {
          await conn.rollback();
          return res.status(409).json({ success: false, message: "An account with this email already exists." });
        }
        throw e;
      }

      const [fresh] = await conn.execute(
        `SELECT id, email, first_name, last_name, role, tenant_id, is_platform_admin, email_verified FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );
      user = fresh[0];

      const tenantId = user.tenant_id || crypto.randomUUID();
      if (!user.tenant_id) {
        const subdomain = await reserveSubdomain(company_name);
        await conn.execute(
          `INSERT INTO tenants
             (id, company_name, subdomain, subdomain_status, slug, owner_user_id, status, trial_ends_at)
           VALUES (?, ?, ?, 'pending', ?, ?, 'trial', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
          [tenantId, String(company_name).trim().slice(0, 180), subdomain, subdomain, user.id]
        );
        await conn.execute("UPDATE users SET tenant_id = ?, role = 'manager' WHERE id = ?", [tenantId, user.id]);
        const [again] = await conn.execute(
          `SELECT id, email, first_name, last_name, role, tenant_id, is_platform_admin, email_verified FROM users WHERE id = ? LIMIT 1`,
          [userId]
        );
        user = again[0];

        const [pkg] = await conn.execute(
          "SELECT id FROM subscription_packages WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 1"
        );
        if (pkg.length) {
          await conn.execute(
            `INSERT INTO subscriptions (id, tenant_id, package_id, status, starts_at, ends_at)
             VALUES (?, ?, ?, 'trial', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
            [crypto.randomUUID(), tenantId, pkg[0].id]
          );
        }
      }
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* ignore rollback error */
      }
      throw e;
    } finally {
      conn.release();
    }

    // Automatically log the user in after signup
    const tenantId = user.tenant_id && String(user.tenant_id).trim() !== "" ? user.tenant_id : null;
    const access = generateAccessToken({
      userId: user.id,
      tenantId,
      role: user.role,
      is_platform_admin: user.is_platform_admin,
    });
    const refresh = generateRefreshToken({ userId: user.id });
    await saveRefreshToken(user.id, refresh);

    setAccessCookie(req, res, access);
    setRefreshCookie(req, res, refresh);

    // Set tenant_id cookie for pending_payment redirects
    if (tenantId) {
      setTenantIdCookie(req, res, tenantId);
    }

    res.status(201).json({
      success: true,
      message: "Account created. You can sign in now.",
      data: { user: publicUserRow(user), tenant_id: user.tenant_id || null },
    });
  } catch (err) {
    console.error("auth signup:", err);
    res.status(500).json({ success: false, message: err.message || "Signup failed" });
  }
}

async function updatePassword(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    const [rows] = await mainPool.execute(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, [userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (user.password_hash && currentPassword) {
      const ok = await bcrypt.compare(String(currentPassword), String(user.password_hash));
      if (!ok) {
        return res.status(400).json({ success: false, message: "Incorrect current password." });
      }
    } else if (user.password_hash && !currentPassword) {
      return res.status(400).json({ success: false, message: "Current password is required." });
    }

    const pwHash = await hashPassword(newPassword);
    await mainPool.execute(`UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`, [pwHash, userId]);

    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("auth updatePassword:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update password." });
  }
}

module.exports = {
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  signup,
  setAccessCookie,
  setRefreshCookie,
  setTenantIdCookie,
};