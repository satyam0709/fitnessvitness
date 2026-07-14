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
const { ensureSchema } = require("./config/ensureSchema");
const { validateRuntimeEnv } = require("./config/runtimeValidation");
const routes = require("./routes/index");
const reportsRouter = require("./routes/reports");
const { verifyToken: jwtCookieAuth } = require("./middleware/verifyToken");
const { initMeetingsRealtime } = require("./realtime/meetingsRealtime");
const { logProductionEmailConfig } = require("./services/emailService");

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
  ],
  optionsSuccessStatus: 204,
  // Avoid sticky preflight cache during local dev when origin rules change.
  maxAge: process.env.NODE_ENV === "production" ? 86400 : 0,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use("/api/webhook/clerk", express.raw({ type: "application/json" }));
app.use("/api/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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
      return `ip:${req.ip || ""}`;
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
          user_id: req.user?.id || null,
        })
      );
    }
  });
  next();
});

const crmApiGuard = [jwtCookieAuth];
app.use("/api/reports", ...crmApiGuard, reportsRouter);

app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
  })
);

app.use("/api", routes);

// Health check endpoint
app.get("/api/health", async (_req, res) => {
  let dbStatus = "ok";
  let dbLatency = null;
  try {
    const start = Date.now();
    await testConnection();
    dbLatency = Date.now() - start;
  } catch (err) {
    dbStatus = "error";
    console.error("Health check DB error:", err.message);
  }

  const status = {
    status: dbStatus === "ok" ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: { status: dbStatus, latency_ms: dbLatency }
    },
    version: process.env.APP_VERSION || "1.0.0",
    // Bumped when lead create undefined-bind fix ships — check live /api/health
    fixes: {
      leadBindNull: "2026-07-14-bind-null-v3",
      leadsRoute: "prisma-leadService-2026-07-14-v3",
    },
  };

  res.status(dbStatus === "ok" ? 200 : 503).json(status);
});

app.get("/", (_req, res) =>
  res.json({ status: "ok", message: "FitnessVitness CRM API running" })
);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  const requestId = req.request_id || 'unknown';
  const isProduction = process.env.NODE_ENV === 'production';

  // Log full error for debugging
  if (isProduction) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'unhandled_error',
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      error: err.message,
      stack: err.stack
    }));
  } else {
    console.error(`[ERROR] ${err.message}`);
    if (err.stack) console.error(err.stack);
  }

  // Handle specific error types
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS not allowed" });
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "Uploaded file is too large. Please keep CSV size under 50 MB.",
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError' || err.name === 'JsonWebTokenError') {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  // Handle unauthorized errors
  if (err.name === 'UnauthorizedError' || err.status === 401) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  // Generic error response - never expose stack traces in production
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: isProduction
      ? "An internal error occurred. Please try again later."
      : err.message
  });
});

async function start() {
  validateRuntimeEnv();
  await logProductionEmailConfig();
  await testConnection();
  await ensureSchema();
  try {
    const { ensureCrmSchemaCompat } = require("./utils/ensureCrmSchemaCompat");
    const { pool } = require("./config/database");
    await ensureCrmSchemaCompat(pool);
  } catch (e) {
    console.warn("start: ensureCrmSchemaCompat:", e.message);
  }
  const httpServer = http.createServer(app);
  initMeetingsRealtime(httpServer);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀  API → http://localhost:${PORT}/api/health`);
    console.log(`📡  Realtime (meetings + admin) → ws://localhost:${PORT}/socket.io`);
    console.log(`✅  Leads create path: prisma-leadService-2026-07-14-v3\n`);
  });
}

start();
