require("dotenv").config();

const http = require("http");
const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const { testConnection } = require("./config/database");
const { ensureSchema, validateTenantDatabases } = require("./config/ensureSchema");
const { validateRuntimeEnv } = require("./config/runtimeValidation");
const routes = require("./routes/index");
const reportsRouter = require("./routes/reports");
const { verifyToken: jwtCookieAuth } = require("./middleware/verifyToken");
const { resolveTenantContext, enforceSubscription } = require("./middleware/tenantAccess");
const { requireCrmTenant } = require("./middleware/crmTenant");
const { tenantDbMiddleware } = require("./middleware/tenantDbMiddleware");
const { subdomainMiddleware } = require("./middleware/subdomain");
const { initMeetingsRealtime } = require("./realtime/meetingsRealtime");
const { startChatRetentionLoop } = require("./services/chatRetention");
const { startTrialSubscriptionJobs } = require("./services/trialSubscriptionJobs");
const { logProductionEmailConfig } = require("./services/emailService");
const tenantDbRoutes = require("./routes/tenantDatabaseRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === "0" || trustProxy === "false") {
  app.set("trust proxy", false);
} else if (trustProxy != null && String(trustProxy).trim() !== "") {
  app.set("trust proxy", Number(trustProxy) || trustProxy);
} else {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

function pushNormalizedOrigin(list, raw) {
  if (raw == null) return;
  const t = String(raw).trim();
  if (!t) return;
  let href = t.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(href)) {
    href = `https://${href}`;
  }
  try {
    const origin = new URL(href).origin;
    if (origin && !list.includes(origin)) list.push(origin);
  } catch {
  }
}

const allowedOrigins = [];
if (process.env.ALLOWED_ORIGINS) {
  for (const part of process.env.ALLOWED_ORIGINS.split(",")) {
    pushNormalizedOrigin(allowedOrigins, part);
  }
}
for (const key of ["FRONTEND_URL", "CLIENT_URL", "APP_URL"]) {
  pushNormalizedOrigin(allowedOrigins, process.env[key]);
}
if (!allowedOrigins.length) {
  allowedOrigins.push("http://localhost:3000");
}
if (process.env.NODE_ENV === "production") {
  const hasRemote = allowedOrigins.some((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o));
  if (!hasRemote) {
    console.warn(
      "[CORS] No non-localhost origin in ALLOWED_ORIGINS / FRONTEND_URL — browser apps on Vercel will fail CORS until you set them (e.g. ALLOWED_ORIGINS=https://your-app.vercel.app)."
    );
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;

  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    const BASE_DOMAIN = (process.env.APP_BASE_DOMAIN || "localhost")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .toLowerCase();

    // allow localhost + subdomains
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".localhost")) return true;

    // allow main domain
    if (host === BASE_DOMAIN) return true;

    // allow subdomains → THIS IS THE MAIN FIX
    if (host.endsWith(`.${BASE_DOMAIN}`)) return true;

  } catch {
    return false;
  }

  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, origin || allowedOrigins[0]);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  // Include PATCH for lead status and other partial updates; browsers preflight OPTIONS must echo these.
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Integration-Secret",
    "X-Requested-With",
    "X-Tenant-Subdomain",
    "X-Tenant-Slug",
    "X-Subdomain",
  ],
  optionsSuccessStatus: 204,
  // Avoid sticky preflight cache during local dev when origin rules change.
  maxAge: process.env.NODE_ENV === "production" ? 86400 : 0,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use("/api/webhook/clerk", express.raw({ type: "application/json" }));
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use("/api/payment/webhook/stripe", express.raw({ type: "application/json" }));
app.use("/api/webhooks/razorpay", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(subdomainMiddleware);

const rateWindowMs = Number(process.env.API_RATE_WINDOW_MS) || 60 * 1000;
const rateMax = Number(process.env.API_RATE_LIMIT_MAX || 1000);
app.use(
  "/api/",
  rateLimit({
    windowMs: rateWindowMs,
    max: rateMax,
    message: { success: false, message: "Too many requests. Try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    keyGenerator: (req) => {
      const sub = String(req.tenantSubdomain || req.get("x-tenant-subdomain") || "").trim();
      return sub ? `sub:${sub}:${req.ip || ""}` : `ip:${req.ip || ""}`;
    },
  })
);

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.use((req, res, next) => {
  req.request_id = crypto.randomUUID();
  res.setHeader("x-request-id", req.request_id);
  const started = Date.now();
  res.on("finish", () => {
    if (res.statusCode >= 500) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "http_response",
          request_id: req.request_id,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Date.now() - started,
          tenant_id: req.user?.tenant_id || req.tenantId || null,
          user_id: req.user?.id || null,
        })
      );
    }
  });
  next();
});

const crmApiGuard = [
  jwtCookieAuth,
  resolveTenantContext,
  tenantDbMiddleware,
  requireCrmTenant,
  enforceSubscription(),
];
app.use("/api/reports", ...crmApiGuard, reportsRouter);

app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
  })
);

app.use("/api", routes);
app.use(jwtCookieAuth, resolveTenantContext, tenantDbRoutes);
app.get("/", (_req, res) =>
  res.json({ status: "ok", message: "RND CRM API running" })
);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err.stack || err.message);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS not allowed" });
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "Uploaded file is too large. Please keep CSV size under 50 MB.",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

async function start() {
  validateRuntimeEnv();
  await logProductionEmailConfig();
  await testConnection();
  await ensureSchema();
  await validateTenantDatabases();
  const httpServer = http.createServer(app);
  initMeetingsRealtime(httpServer);
  startChatRetentionLoop();
  startTrialSubscriptionJobs();
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀  API → http://localhost:${PORT}/api/health`);
    console.log(`📡  Realtime (meetings + admin) → ws://localhost:${PORT}/socket.io\n`);
  });
}

start();
