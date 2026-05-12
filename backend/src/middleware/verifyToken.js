const jwt = require("jsonwebtoken");
const { mainPool } = require("../config/database");
const { isPlatformSuperAdmin } = require("./platformAdmin");
const { getMapsForClerkUser } = require("../services/tenantUserMapService");
const { getTenantDataPoolForTenantId } = require("../services/tenantDatabaseService");
const { getCookie, verifyAccessToken, REFRESH_COOKIE } = require("../services/authService");

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

    // FIXED: 12 use execute() for parameterized DB reads
    const [rows] = await mainPool.execute(
      `SELECT id, clerk_user_id, email, first_name, last_name, role, tenant_id, is_active,
              COALESCE(is_platform_admin, 0) AS is_platform_admin,
              COALESCE(must_change_password, 0) AS must_change_password
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

    const user = rows[0];
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

    const clerkKey = user.clerk_user_id ? String(user.clerk_user_id).trim() : "";
    const maps = clerkKey ? await getMapsForClerkUser(clerkKey) : [];

    let effectiveTenantId =
      user.tenant_id && String(user.tenant_id).trim() !== "" ? user.tenant_id : null;
    if (!effectiveTenantId && maps.length) {
      effectiveTenantId = maps[0].tenant_id;
    }

    const fromSub = req.tenantFromSubdomain;
    if (fromSub?.tenant_id) {
      if (String(fromSub.status || "").toLowerCase() !== "active") {
        const plat = { is_platform_admin: user.is_platform_admin, role: user.role, tenant_id: user.tenant_id };
        if (!isPlatformSuperAdmin(plat)) {
          return res.status(423).json({
            success: false,
            code: "WORKSPACE_DATABASE_PENDING",
            message:
              "This workspace URL is reserved but locked until super-admin database activation is complete.",
          });
        }
      }
      const inWorkspace =
        (effectiveTenantId && String(effectiveTenantId) === String(fromSub.tenant_id)) ||
        maps.some((m) => String(m.tenant_id) === String(fromSub.tenant_id)) ||
        (user.tenant_id && String(user.tenant_id) === String(fromSub.tenant_id));
      if (!inWorkspace) {
        const plat = { is_platform_admin: user.is_platform_admin, role: user.role, tenant_id: user.tenant_id };
        if (isPlatformSuperAdmin(plat)) {
          effectiveTenantId = fromSub.tenant_id;
        } else {
          return res.status(403).json({
            success: false,
            message:
              "This account is not a member of this workspace. Sign in using your company URL or contact an admin.",
          });
        }
      } else {
        effectiveTenantId = fromSub.tenant_id;
      }
    }

    if (!fromSub?.tenant_id && req.tenantSubdomain) {
      const [tenantRows] = await mainPool.execute(
        "SELECT id, subdomain_status FROM tenants WHERE subdomain = ? OR slug = ? LIMIT 1",
        [req.tenantSubdomain, req.tenantSubdomain]
      );
      const pendingTenant = tenantRows[0];
      if (pendingTenant?.id) {
        const plat = { is_platform_admin: user.is_platform_admin, role: user.role, tenant_id: user.tenant_id };
        if (!isPlatformSuperAdmin(plat)) {
          return res.status(423).json({
            success: false,
            code: "WORKSPACE_DATABASE_PENDING",
            message:
              "This workspace URL is reserved but locked until super-admin database activation is complete.",
          });
        }
        effectiveTenantId = pendingTenant.id;
      }
    }

    // REWRITTEN: fetch tenant status + subdomain in one query.
    // pending_payment check runs first so payment flow is never blocked by subdomain enforcement.
    let tenantStatus = null;
    let tenantSubdomain = null;
    let tenantSubdomainStatus = null;

    if (effectiveTenantId) {
      try {
        const [tenantRows] = await mainPool.execute(
          "SELECT status, subdomain, slug, subdomain_status FROM tenants WHERE id = ? LIMIT 1",
          [effectiveTenantId]
        );
        if (tenantRows[0]) {
          tenantStatus = String(tenantRows[0].status || "").toLowerCase();
          tenantSubdomain = String(tenantRows[0].subdomain || tenantRows[0].slug || "").trim().toLowerCase();
          tenantSubdomainStatus = String(tenantRows[0].subdomain_status || "").toLowerCase();
        }
      } catch (e) {
        console.warn("verifyToken: tenant info fetch:", e.message);
      }
    }

    if (tenantStatus === "pending_payment") {
      const path = String(req.originalUrl || req.url || "").toLowerCase();
      const allowedPaths = [
        "/api/payment/checkout",
        "/api/payment/checkout/unified",
        "/api/payment/status",
        "/api/orders/start-trial",
        "/api/orders",
        "/api/users/me",
        "/api/users/sync",
        "/api/auth/me",
        "/api/auth/refresh",
        "/api/auth/logout",
      ];
      const isAllowed = allowedPaths.some((p) => path.startsWith(p.toLowerCase()));
      if (!isAllowed) {
        return res.status(402).json({
          success: false,
          code: "PENDING_PAYMENT",
          message: "Please complete your payment to access this workspace. Visit the add-package page to select a plan.",
        });
      }
    }

    // Enforce subdomain-only API access only when workspace is fully active:
    // DB provisioned (subdomain_status=active) AND payment done (not pending_payment).
    // Apex domain is allowed during onboarding/pending states.
    // Block apex access when tenant has an active workspace.
    // status="active" means paid + provisioned. We don't gate on subdomain_status
    // because that field may not be set even when the workspace is fully operational.
    if (effectiveTenantId && !user.is_platform_admin && !fromSub?.tenant_id &&
      tenantSubdomain && tenantStatus === "active") {
      const path = String(req.originalUrl || req.url || "").toLowerCase().split("?")[0];
      // These endpoints must work on the apex domain even after workspace activation.
      // Payment confirmation lands here after Stripe redirect before the user
      // is sent to their subdomain. Auth endpoints needed for session cleanup.
      const apexAllowed = [
        "/api/auth/logout",
        "/api/auth/refresh",
        "/api/auth/me",
        "/api/payment/status",
        "/api/payment/checkout",
        "/api/payment/checkout/unified",
        "/api/orders",
        "/api/users/me",
        "/api/users/sync",
      ];
      const isApexAllowed = apexAllowed.some((p) => path === p || path.startsWith(p + "/"));
      if (!isApexAllowed) {
        const assignedUrl = `https://${tenantSubdomain}.${process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app"}`;
        return res.status(403).json({
          success: false,
          code: "WORKSPACE_SUBDOMAIN_REQUIRED",
          message: `Please access your workspace at: ${assignedUrl}`,
          assigned_workspace_url: assignedUrl,
        });
      }
    }

    let crmUser = null;
    if (effectiveTenantId) {
      try {
        const tPool = await getTenantDataPoolForTenantId(effectiveTenantId);
        if (clerkKey) {
          const [tUsers] = await tPool.execute(
            `SELECT id, clerk_user_id, email, first_name, last_name, role, is_active, tenant_id,
                    profile_image, must_change_password
             FROM users WHERE clerk_user_id = ? LIMIT 1`,
            [clerkKey]
          );
          if (tUsers[0] && (tUsers[0].is_active == null || Number(tUsers[0].is_active) === 1)) {
            crmUser = tUsers[0];
          }
        } else {
          const [tUsers] = await tPool.execute(
            `SELECT id, clerk_user_id, email, first_name, last_name, role, is_active, tenant_id,
                    profile_image, must_change_password
             FROM users WHERE email = ? LIMIT 1`,
            [user.email]
          );
          // FIXED: 4 tenant user lookup uses globally unique email instead of tenant-local integer id
          if (tUsers[0] && (tUsers[0].is_active == null || Number(tUsers[0].is_active) === 1)) {
            crmUser = tUsers[0];
          }
        }
      } catch (te) {
        console.warn("verifyToken: tenant user lookup:", te.message);
      }
    }

    const mapForTenant = effectiveTenantId
      ? maps.find((m) => String(m.tenant_id) === String(effectiveTenantId))
      : null;

    let role = String(user.role || "staff").toLowerCase();
    if (mapForTenant?.role) {
      const mr = String(mapForTenant.role).toLowerCase();
      if (["admin", "manager", "staff"].includes(mr)) {
        role = mr;
      }
    } else if (crmUser?.role) {
      const r = String(crmUser.role).toLowerCase();
      if (["admin", "manager", "staff"].includes(r)) {
        role = r;
      }
    }

    const mustPw =
      crmUser && crmUser.must_change_password != null
        ? Number(crmUser.must_change_password) === 1
        : Number(user.must_change_password) === 1;

    req.user = {
      id: user.id,
      clerkUserId: user.clerk_user_id,
      email: user.email,
      first_name: (crmUser && crmUser.first_name) || user.first_name || "",
      last_name: (crmUser && crmUser.last_name) || user.last_name || "",
      role,
      tenantId: effectiveTenantId || null,
      tenant_id: effectiveTenantId || null,
      tenantStatus: tenantStatus || null,
      isAdmin: role === "admin",
      is_platform_admin: Number(user.is_platform_admin) === 1,
      mustChangePassword: mustPw,
    };

    req.tenantId = effectiveTenantId || null;
    req.userRole = role;

    if (crmUser) {
      req.crmUser = crmUser;
    }
    if (mapForTenant) {
      req.tenantUserMap = mapForTenant;
    }

    if (!req.auth) req.auth = {};
    req.auth.userId = user.clerk_user_id || null;
    req.auth.dbUserId = user.id;

    // FIXED: 6 throttle last_login writes to once per 5-minute window per user
    const now = Date.now();
    const canWriteLastLogin = !lastLoginWriteByUser.has(user.id) || now - lastLoginWriteByUser.get(user.id) > LAST_LOGIN_WINDOW_MS;
    if (canWriteLastLogin) {
      lastLoginWriteByUser.set(user.id, now);
      mainPool
        .execute(
          "UPDATE users SET last_login = NOW() WHERE id = ? AND (last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL 5 MINUTE))",
          [user.id]
        )
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