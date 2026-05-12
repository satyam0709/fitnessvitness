const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { mainPool } = require("../config/database");
const { getTenantDataPoolForTenantId } = require("../services/tenantDatabaseService");

let ioRef = null;

function buildAllowedOriginChecker() {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
      : []),
  ]
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, ""));

  return function isOriginAllowed(origin) {
    if (!origin) return true;
    const o = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(o)) return true;
    try {
      const { hostname } = new URL(o);
      if (hostname === "localhost" || hostname === "127.0.0.1") return true;
      if (hostname.endsWith(".vercel.app")) return true;
    } catch {
      return false;
    }
    return false;
  };
}

/**
 * Socket.io on the same HTTP server as Express. Clients authenticate with
 * the app JWT (`auth: { token }`, same secret as REST cookie/Bearer).
 */
function initMeetingsRealtime(httpServer) {
  if (ioRef) return ioRef;

  const isOriginAllowed = buildAllowedOriginChecker();

  ioRef = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) callback(null, true);
        else callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  ioRef.use(async (socket, next) => {
    try {
      let token =
        typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null;
      if (!token) {
        const cookieHeader = socket.handshake.headers?.cookie || "";
        const m = cookieHeader.match(/(?:^|;\s*)access_token=([^;]+)/);
        if (m) {
          try {
            token = decodeURIComponent(m[1]);
          } catch {
            token = m[1];
          }
        }
      }
      if (!token || typeof token !== "string") {
        return next(new Error("Unauthorized"));
      }
      const secret = process.env.JWT_SECRET;
      if (!secret || String(secret).trim() === "") {
        console.warn("meetingsRealtime: JWT_SECRET is not set; socket auth disabled");
        return next(new Error("Unauthorized"));
      }
      const payload = jwt.verify(token, secret);
      const uid = Number(payload.userId);
      if (!uid || Number.isNaN(uid)) {
        return next(new Error("Unauthorized"));
      }
      socket.data.clerkUserId = null;
      socket.data.userDbId = uid;
      next();
    } catch (e) {
      next(new Error("Unauthorized"));
    }
  });

  ioRef.on("connection", (socket) => {
    socket.join("meetings");
    socket.join("notes");
    socket.join("todos");
    socket.join("contacts");
    socket.join("opportunities");
    const clerkId = socket.data.clerkUserId;
    const dbId = socket.data.userDbId;
    if (!dbId && !clerkId) return;
    const sql = dbId
      ? "SELECT id, role, tenant_id, COALESCE(is_platform_admin, 0) AS is_platform_admin FROM users WHERE id = ? AND is_active = 1 LIMIT 1"
      : "SELECT id, role, tenant_id, COALESCE(is_platform_admin, 0) AS is_platform_admin FROM users WHERE clerk_user_id = ? AND is_active = 1 LIMIT 1";
    const params = dbId ? [dbId] : [clerkId];
    mainPool
      .query(sql, params)
      .then(async ([rows]) => {
        const row = rows?.[0];
        if (!row) return;
        socket.data.userDbId = row.id;
        socket.data.tenantId = row.tenant_id || null;
        const crm = await getTenantDataPoolForTenantId(row.tenant_id);
        socket.data.crmPool = crm;
        socket.join(`user:${row.id}`);
        if (row.tenant_id) socket.join(`tenant:${row.tenant_id}`);
        if (Number(row.is_platform_admin) === 1) socket.join("admin");
      })
      .catch((err) => console.warn("socket user room:", err.message));

    // Chat rooms are joined on-demand to keep initial subscribe light.
    socket.on("chat:join", async ({ threadId } = {}) => {
      try {
        const dbId = socket.data.userDbId;
        const tid = Number(threadId);
        if (!dbId || !tid) return;
        const crm = socket.data.crmPool || (await getTenantDataPoolForTenantId(socket.data.tenantId));
        if (!crm) return;
        const [[m]] = await crm.execute(
          "SELECT user_id FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
          [tid, dbId]
        );
        if (!m) return;
        socket.join(`chat:thread:${tid}`);
      } catch (e) {
        /* ignore */
      }
    });

    socket.on("chat:leave", ({ threadId } = {}) => {
      const tid = Number(threadId);
      if (!tid) return;
      socket.leave(`chat:thread:${tid}`);
    });

    socket.on("chat:typing", ({ threadId, isTyping } = {}) => {
      const tid = Number(threadId);
      const dbId = socket.data.userDbId;
      if (!tid || !dbId) return;
      socket.to(`chat:thread:${tid}`).emit("chat:typing", {
        threadId: tid,
        userId: dbId,
        isTyping: !!isTyping,
        ts: Date.now(),
      });
    });
  });

  return ioRef;
}

function emitMeetingsChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("meetings:changed", { ts: Date.now(), ...meta });
    else ioRef.to("meetings").emit("meetings:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitMeetingsChanged:", e.message);
  }
}

/** Unified calendar (meetings, tasks, reminders, custom events) — clients refetch /calendar feed */
function emitCalendarChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("calendar:changed", { ts: Date.now(), ...meta });
    else ioRef.to("meetings").emit("calendar:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitCalendarChanged:", e.message);
  }
}

function emitNotesChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("notes:changed", { ts: Date.now(), ...meta });
    else ioRef.to("notes").emit("notes:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitNotesChanged:", e.message);
  }
}

function emitTodosChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("todos:changed", { ts: Date.now(), ...meta });
    else ioRef.to("todos").emit("todos:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitTodosChanged:", e.message);
  }
}

function emitContactsChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("contacts:changed", { ts: Date.now(), ...meta });
    else ioRef.to("contacts").emit("contacts:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitContactsChanged:", e.message);
  }
}

function emitOpportunitiesChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("opportunities:changed", { ts: Date.now(), ...meta });
    else ioRef.to("opportunities").emit("opportunities:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitOpportunitiesChanged:", e.message);
  }
}

function emitTicketsChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("tickets:changed", { ts: Date.now(), ...meta });
    else ioRef.to("meetings").emit("tickets:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitTicketsChanged:", e.message);
  }
}

/** Notify admin dashboards (users in `admin` socket room) to refetch from API */
function emitAdminChanged(meta = {}) {
  if (!ioRef) return;
  try {
    ioRef.to("admin").emit("admin:changed", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitAdminChanged:", e.message);
  }
}

/** Notify CRM clients (same room as meetings) to refetch subscription / profile when access-relevant data changes. */
function emitWorkspaceAccessChanged(meta = {}) {
  if (!ioRef) return;
  try {
    if (meta.tenantId) ioRef.to(`tenant:${meta.tenantId}`).emit("workspace:access", { ts: Date.now(), ...meta });
    else ioRef.to("meetings").emit("workspace:access", { ts: Date.now(), ...meta });
  } catch (e) {
    console.warn("emitWorkspaceAccessChanged:", e.message);
  }
}

function emitChatThreadChanged(userIds = [], meta = {}) {
  if (!ioRef) return;
  const ids = Array.isArray(userIds) ? userIds.map((n) => Number(n)).filter(Boolean) : [];
  if (ids.length === 0) return;
  try {
    ids.forEach((uid) => ioRef.to(`user:${uid}`).emit("chat:threads:changed", { ts: Date.now(), ...meta }));
  } catch (e) {
    console.warn("emitChatThreadChanged:", e.message);
  }
}

function emitChatMessageCreated(threadId, memberUserIds = [], message = {}) {
  if (!ioRef) return;
  const tid = Number(threadId);
  if (!tid) return;
  try {
    ioRef.to(`chat:thread:${tid}`).emit("chat:message", { ts: Date.now(), threadId: tid, message });
  } catch (e) {
    console.warn("emitChatMessageCreated:", e.message);
  }
  // Also nudge thread lists for all members (including those not currently in the thread room).
  emitChatThreadChanged(memberUserIds, { reason: "message", threadId: tid });
}

function emitNotificationCreated(userId, notification = {}) {
  if (!ioRef) return;
  const uid = Number(userId);
  if (!uid) return;
  try {
    ioRef.to(`user:${uid}`).emit("notifications:new", { ts: Date.now(), notification });
  } catch (e) {
    console.warn("emitNotificationCreated:", e.message);
  }
}

function emitNotificationReadState(userId, payload = {}) {
  if (!ioRef) return;
  const uid = Number(userId);
  if (!uid) return;
  try {
    ioRef.to(`user:${uid}`).emit("notifications:read", { ts: Date.now(), ...payload });
  } catch (e) {
    console.warn("emitNotificationReadState:", e.message);
  }
}

function emitUserEvent(userId, event, payload = {}) {
  if (!ioRef) return;
  const uid = Number(userId);
  if (!uid || !event) return;
  try {
    ioRef.to(`user:${uid}`).emit(event, { ts: Date.now(), ...payload });
  } catch (e) {
    console.warn("emitUserEvent:", e.message);
  }
}

module.exports = {
  initMeetingsRealtime,
  emitMeetingsChanged,
  emitCalendarChanged,
  emitNotesChanged,
  emitTodosChanged,
  emitContactsChanged,
  emitOpportunitiesChanged,
  emitTicketsChanged,
  emitAdminChanged,
  emitWorkspaceAccessChanged,
  emitChatThreadChanged,
  emitChatMessageCreated,
  emitNotificationCreated,
  emitNotificationReadState,
  emitUserEvent,
};
