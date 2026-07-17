const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");
const { sendPasswordReset } = require("../services/emailService");
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
    full_name: row.full_name || "",
    role: String(row.role || "staff").toLowerCase(),
    is_platform_admin: false,
    email_verified: Number(row.email_verified) === 1,
  };
}


async function loadUserById(id) {
  const user = await prisma.users.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      role: true,
      is_active: true,
      email_verified: true,
      password_hash: true
    }
  });
  if (user) {
    user.full_name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  }
  return user || null;
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

    // FIXED: login reads user directly via prisma
    const user = await prisma.users.findUnique({
      where: { email: email }
    });
    if (user) {
      user.full_name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    }
    if (!user) {
      console.log('[auth] Login failed: user not found');
      return res.status(401).json({
        success: false,
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Invalid email or password.",
        diagnostics: buildAuthDiagnostics(req, { stage: "user_lookup" }),
      });
    }


    const passwordField = user.password_hash || user.password || user.hashed_password;


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


    const access = generateAccessToken({
      userId: user.id,
      role: user.role,
      is_platform_admin: false,
    });
    const refresh = generateRefreshToken({ userId: user.id });
    await saveRefreshToken(user.id, refresh);

    setAccessCookie(req, res, access);
    setRefreshCookie(req, res, refresh);

    const redirectUrl = "/dashboard";

    res.json({
      success: true,
      message: "Signed in",
      token: access,
      refreshToken: refresh,
      user: {
        id: user.id,
        email: user.email,
        role: String(user.role || "staff").toLowerCase(),
        is_platform_admin: 0,
        full_name: user.full_name || "",
      },
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
    const tokRow = await prisma.refresh_tokens.findFirst({
      where: {
        token_hash: tokenHash,
        user_id: userId,
        expires_at: { gt: new Date() }
      }
    });
    if (!tokRow) {
      return res.status(401).json({ success: false, message: "Refresh token revoked or expired" });
    }

    let user = await loadUserById(userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const access = generateAccessToken({
      userId: user.id,
      role: user.role,
      is_platform_admin: false,
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

    const user = await prisma.users.findFirst({
      where: { email: { equals: email } }
    });
    if (user) {
      user.full_name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    }
    if (!user) {
      return res.json(generic);
    }

    const plain = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
    const tokenHash = sha256hex(plain);
    const expires = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);
    await prisma.users.update({
      where: { id: user.id },
      data: {
        password_reset_token: tokenHash,
        password_reset_expires: expires,
        updated_at: new Date()
      }
    });

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
    const user = await prisma.users.findFirst({
      where: {
        password_reset_token: tokenHash,
        password_reset_expires: { gt: new Date() }
      }
    });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
    }

    const userId = user.id;
    const pw = await hashPassword(newPassword);
    await prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: pw,
        password_reset_token: null,
        password_reset_expires: null,
        updated_at: new Date()
      }
    });
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
    const { name, email, password } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: "name, email, password are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts.shift() || "";
    const lastName = nameParts.join(" ") || "";
    const emailNorm = String(email).trim().toLowerCase();
    const pwHash = await hashPassword(password);

    let userId;
    try {
      const newUser = await prisma.users.create({
        data: {
          email: emailNorm,
          password_hash: pwHash,
          first_name: firstName,
          last_name: lastName,
          role: "manager",
          is_active: true,
          email_verified: false
        }
      });
      userId = newUser.id;
    } catch (e) {
      if (e.code === "P2002") {
        return res.status(409).json({ success: false, message: "An account with this email already exists." });
      }
      throw e;
    }

    const user = await loadUserById(userId);

    // Automatically log the user in after signup
    const access = generateAccessToken({
      userId: user.id,
      role: user.role,
      is_platform_admin: false,
    });
    const refresh = generateRefreshToken({ userId: user.id });
    await saveRefreshToken(user.id, refresh);

    setAccessCookie(req, res, access);
    setRefreshCookie(req, res, refresh);

    res.status(201).json({
      success: true,
      message: "Account created. You can sign in now.",
      data: { user: publicUserRow(user) },
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

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { password_hash: true }
    });
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
    await prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: pwHash,
        updated_at: new Date()
      }
    });

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
};