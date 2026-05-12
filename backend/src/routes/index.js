const express = require("express");
const { handleClerkWebhook } = require("../controllers/webhookController");
const { getMe, syncCurrentUser } = require("../controllers/userController");
const { submitContact, getContacts, markAsRead } = require("../controllers/contactController");
const { verifyToken } = require("../middleware/verifyToken");
const { getTenantPoolStats, mainPool } = require("../config/database");
const leadsRouter        = require("./leads");
const opportunitiesRouter = require("./opportunities");
const ticketsRouter      = require("./tickets");
const tasksRouter        = require("./tasks");
const usersRouter        = require("./users");
const integrationsRouter = require("./integrations");
const v2Router           = require("./v2");
const remindersRouter    = require("./reminders");    // ← NEW
const meetingsRouter     = require("./meetings");     // ← NEW
const todosRouter          = require("./todos");
const notificationsRouter = require("./notifications");
const dashboardRouter    = require("./dashboard");    // ← NEW (user-facing stats)
const calendarRouter     = require("./calendar");
const contactsRouter     = require("./contacts");
const companiesRouter    = require("./companies");
const crmRouter          = require("./crm");
const authRouter         = require("./auth");
const fitnessRouter      = require("./fitness");
const { getMeContext } = require("../controllers/meController");

const router = express.Router();
const protectedRoute = [verifyToken];

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
    const n = normalizeOrigin(value);
    if (n && !out.includes(n)) out.push(n);
  };
  for (const src of String(process.env.ALLOWED_ORIGINS || "").split(",")) push(src);
  push(process.env.FRONTEND_URL);
  push(process.env.CLIENT_URL);
  push(process.env.APP_URL);
  return out;
}

router.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    message: "RND TECHNOSOFT API is running",
    timestamp: new Date().toISOString(),
  })
);

router.get("/health/db", async (_req, res) => {
  try {
    const [rows] = await mainPool.execute("SELECT 1 AS ok");
    res.json({
      success: true,
      db: { ok: rows?.[0]?.ok === 1 },
      tenantPools: getTenantPoolStats(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database health check failed",
      error: String(error.message || "db_unavailable"),
      tenantPools: getTenantPoolStats(),
    });
  }
});

router.get("/health/auth", (req, res) => {
  const configuredOrigins = buildConfiguredOrigins();
  const origin = String(req.get("origin") || "").trim() || null;
  const cookieHeader = String(req.get("cookie") || "");
  const hasAccessCookie = cookieHeader.includes("access_token=");
  const hasRefreshCookie = cookieHeader.includes("refresh_token=");
  const cookieDomain = String(process.env.COOKIE_DOMAIN || "").trim() || null;
  const cookieSecure = process.env.NODE_ENV === "production";
  const sameSite = "lax";

  const jwtConfigured = Boolean(String(process.env.JWT_SECRET || "").trim());
  const jwtRefreshConfigured = Boolean(String(process.env.JWT_REFRESH_SECRET || "").trim());
  const frontendUrlConfigured = Boolean(
    String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || "").trim()
  );

  const originAllowed =
    !origin ||
    configuredOrigins.includes(origin) ||
    (() => {
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
    })();

  res.json({
    success: true,
    message: "Auth runtime health snapshot",
    checks: {
      jwt_secret_configured: jwtConfigured,
      jwt_refresh_secret_configured: jwtRefreshConfigured,
      frontend_url_configured: frontendUrlConfigured,
      cookie: {
        domain: cookieDomain,
        secure: cookieSecure,
        sameSite,
      },
      request: {
        origin,
        origin_allowed: originAllowed,
        has_access_cookie: hasAccessCookie,
        has_refresh_cookie: hasRefreshCookie,
      },
      configured_origins: configuredOrigins,
    },
    timestamp: new Date().toISOString(),
  });
});

router.post("/webhook/clerk", handleClerkWebhook);
router.use("/auth", authRouter);

router.post("/users/sync", verifyToken, syncCurrentUser);
router.get("/users/me", verifyToken, getMe);
router.get("/me", verifyToken, getMeContext);

router.use("/users",        usersRouter);
router.use("/leads", ...protectedRoute, leadsRouter);
router.use("/opportunities", ...protectedRoute, opportunitiesRouter);
router.use("/tickets", ...protectedRoute, ticketsRouter);
router.use("/tasks", ...protectedRoute, tasksRouter);
router.use("/reminders", ...protectedRoute, remindersRouter);
router.use("/meetings", ...protectedRoute, meetingsRouter);
router.use("/todos", ...protectedRoute, todosRouter);
router.use("/notifications", ...protectedRoute, notificationsRouter);
router.use("/dashboard", ...protectedRoute, dashboardRouter);
router.use("/calendar", ...protectedRoute, calendarRouter);
router.use("/contacts", ...protectedRoute, contactsRouter);
router.use("/companies", ...protectedRoute, companiesRouter);
router.use("/integrations", ...protectedRoute, integrationsRouter);

router.post("/contact",            submitContact);
router.get("/contact", verifyToken, getContacts);
router.patch("/contact/:id/read", verifyToken, markAsRead);

router.use("/crm", crmRouter);
router.use("/v2",      v2Router);
router.use("/fitness", ...protectedRoute, fitnessRouter);

module.exports = router;