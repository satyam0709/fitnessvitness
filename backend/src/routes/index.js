const express = require("express");
const { getMe, syncCurrentUser } = require("../controllers/userController");
const { submitContact, getContacts, markAsRead } = require("../controllers/contactController");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
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
const collectionsRouter  = require("./collections");
const todayRouter        = require("./today");
const { ensureCrmSchemaMiddleware } = require("../middleware/ensureCrmSchema");

const router = express.Router();
const protectedRoute = [verifyToken];
const crmSchemaReady = ensureCrmSchemaMiddleware();

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
    message: "FitnessVitness CRM API is running",
    timestamp: new Date().toISOString(),
  })
);

router.get("/health/db", async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw`SELECT 1 AS ok`;
    res.json({
      success: true,
      db: { ok: rows?.[0]?.ok === 1 || rows?.[0]?.ok === 1n },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database health check failed",
      error: String(error.message || "db_unavailable"),
    });
  }
});

router.use("/auth", authRouter);

router.post("/users/sync", verifyToken, syncCurrentUser);
router.get("/users/me", verifyToken, getMe);
router.get("/me", verifyToken, getMe);
router.get("/me/features", verifyToken, (req, res) => {
  // Standalone CRM has all features enabled for the single user
  res.json({
    success: true,
    data: {
      features: ["leads", "opportunities", "tickets", "tasks", "reminders", "meetings", "todos", "calendar", "contacts", "companies", "storage", "reports", "fitness", "analytics"],
      featureMap: {
        leads: true,
        opportunities: true,
        tickets: true,
        tasks: true,
        reminders: true,
        meetings: true,
        todos: true,
        calendar: true,
        contacts: true,
        companies: true,
        storage: true,
        reports: true,
        fitness: true,
        analytics: true
      },
      planStatus: "pro",
      packageName: "Standalone Lifetime",
      validUntil: null
    }
  });
});

router.use("/users",        usersRouter);
router.use("/leads", ...protectedRoute, crmSchemaReady, leadsRouter);
router.use("/opportunities", ...protectedRoute, opportunitiesRouter);
router.use("/tickets", ...protectedRoute, crmSchemaReady, ticketsRouter);
router.use("/tasks", ...protectedRoute, crmSchemaReady, tasksRouter);
router.use("/reminders", ...protectedRoute, crmSchemaReady, remindersRouter);
router.use("/meetings", ...protectedRoute, crmSchemaReady, meetingsRouter);
router.use("/todos", ...protectedRoute, crmSchemaReady, todosRouter);
router.use("/notifications", ...protectedRoute, notificationsRouter);
router.use("/dashboard", ...protectedRoute, dashboardRouter);
router.use("/today", ...protectedRoute, todayRouter);
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
router.use("/collections", ...protectedRoute, collectionsRouter);

module.exports = router;