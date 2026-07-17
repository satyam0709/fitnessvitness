const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { getCookie, verifyAccessToken, REFRESH_COOKIE } = require("../services/authService");
const { fetchUserRowById, isAdminRole } = require("../utils/userSchema");

const lastLoginWriteByUser = new Map();
const LAST_LOGIN_WINDOW_MS = 5 * 60 * 1000;

function extractTokens(req) {
  const tokens = [];
  // 1. Check Authorization header first
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) tokens.push(token);
  }

  // 2. Check cookie as fallback (there might be multiple due to domain overrides)
  const cookieHeader = req.headers?.cookie || "";
  const matches = [...cookieHeader.matchAll(/(?:^|;\s*)access_token=([^;]+)/g)];
  for (const match of matches) {
    try {
      tokens.push(decodeURIComponent(match[1].trim()));
    } catch {
      tokens.push(match[1].trim());
    }
  }

  return tokens;
}

function auth401Diagnostics(req, reason) {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const cookieHeader = req.headers?.cookie || "";
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "auth_401",
        reason,
        request_id: req.request_id || null,
        method: req.method,
        path: req.originalUrl || req.url,
        host: req.headers?.host || null,
        origin: req.headers?.origin || null,
        forwarded_host: req.headers?.["x-forwarded-host"] || null,
        forwarded_proto: req.headers?.["x-forwarded-proto"] || null,
        has_bearer_header: String(authHeader).startsWith("Bearer "),
        has_access_cookie: /(?:^|;\s*)access_token=/.test(cookieHeader),
        has_refresh_cookie: /(?:^|;\s*)refresh_token=/.test(cookieHeader),
      })
    );
  } catch {
    // best-effort diagnostics only
  }
}

/**
 * Cookie-based JWT auth. Sets `req.user` for downstream middleware (same shape as legacy Clerk bridge).
 */
async function verifyToken(req, res, next) {
  try {
    const tokens = extractTokens(req);
    if (!tokens.length) {
      auth401Diagnostics(req, "missing_access_token");
      // If access token is missing but refresh token exists, tell frontend to refresh
      const hasRefresh = getCookie(req, REFRESH_COOKIE);
      if (hasRefresh) {
        return res.status(401).json({
          success: false,
          code: "TOKEN_EXPIRED",
          message: "Access token missing",
        });
      }
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    let payload = null;
    let lastError = null;

    for (const raw of tokens) {
      try {
        payload = verifyAccessToken(raw);
        lastError = null; // Found a valid token
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (lastError) {
      if (lastError instanceof jwt.TokenExpiredError || lastError?.name === "TokenExpiredError") {
        auth401Diagnostics(req, "access_token_expired");
        return res.status(401).json({
          success: false,
          code: "TOKEN_EXPIRED",
          message: "Access token expired",
        });
      }
      auth401Diagnostics(req, "access_token_invalid");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = Number(payload.userId);
    if (!userId || Number.isNaN(userId)) {
      auth401Diagnostics(req, "invalid_user_id_in_token");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await fetchUserRowById(userId);
    if (!user) {
      auth401Diagnostics(req, "user_not_found");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Contact support.",
      });
    }

    const role = String(user.role || "staff").toLowerCase();
    const nameParts = String(user.full_name || "").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    req.user = {
      id: user.id,
      email: user.email,
      first_name: firstName,
      last_name: lastName,
      full_name: user.full_name || "",
      role,
      isAdmin: isAdminRole(role),
      is_platform_admin: Number(user.is_platform_admin) === 1,
      mustChangePassword: Number(user.must_change_password) === 1,
    };

    req.tenantId = null; // No multi-tenancy
    req.userRole = role;

    if (!req.auth) req.auth = {};
    req.auth.userId = null;
    req.auth.dbUserId = user.id;

    // FIXED: 6 throttle last_login writes to once per 5-minute window per user
    const now = Date.now();
    const canWriteLastLogin = !lastLoginWriteByUser.has(user.id) || now - lastLoginWriteByUser.get(user.id) > LAST_LOGIN_WINDOW_MS;
    if (canWriteLastLogin) {
      lastLoginWriteByUser.set(user.id, now);
      prisma.$executeRaw`UPDATE users SET last_login = NOW() WHERE id = ${user.id} AND (last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL 5 MINUTE))`
        .catch(() => { });
    }

    next();
  } catch (err) {
    console.error("verifyToken error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin only" });
  }

  next();
}

module.exports = { verifyToken, requireAdmin };