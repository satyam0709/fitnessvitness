const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { mainPool } = require("../config/database");

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

function verifyJwt(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

function initMeetingsRealtime(httpServer) {
  if (ioRef) return ioRef;

  const io = new Server(httpServer, {
    cors: {
      origin: buildAllowedOriginChecker(),
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "") ||
      socket.handshake.headers?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.userId) {
      return next(new Error("Invalid token"));
    }

    socket.data.userId = Number(payload.userId);
    socket.data.role = payload.role || "staff";
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    if (!userId) return;

    const dbId = socket.data.userDbId;
    if (!dbId && !clerkId) return;
    const sql = dbId
      ? "SELECT id, role, COALESCE(is_platform_admin, 0) AS is_platform_admin FROM users WHERE id = ? AND is_active = 1 LIMIT 1"
      : "SELECT id, role, COALESCE(is_platform_admin, 0) AS is_platform_admin FROM users WHERE clerk_user_id = ? AND is_active = 1 LIMIT 1";
    const params = dbId ? [dbId] : [clerkId];
    mainPool
      .query(sql, params)
      .then(([rows]) => {
        const row = rows?.[0];
        if (!row) return;
        socket.data.userDbId = row.id;
        socket.join(`user:${row.id}`);
        if (Number(row.is_platform_admin) === 1) socket.join("admin");
      })
      .catch((err) => console.warn("socket user room:", err.message));

    // Chat rooms are joined on-demand
    socket.on("chat:join", async ({ threadId } = {}) => {
      try {
        const dbId = socket.data.userDbId;
        const tid = Number(threadId);
        if (!dbId || !tid) return;
        const [[m]] = await mainPool.execute(
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
        isTyping,
      });
    });

    socket.on("meeting:join", async ({ meetingId }) => {
      const mid = Number(meetingId);
      if (!mid) return;
      const [rows] = await mainPool.execute(
        "SELECT id FROM meetings WHERE id = ? AND is_deleted = 0 LIMIT 1",
        [mid]
      );
      if (!rows[0]) return;
      socket.join(`meeting:${mid}`);
    });

    socket.on("meeting:leave", ({ meetingId }) => {
      const mid = Number(meetingId);
      if (!mid) return;
      socket.leave(`meeting:${mid}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected: ${socket.id} reason: ${reason}`);
    });
  });

  ioRef = io;
  return io;
}

function emitAdminChanged(tenantId) {
  if (!ioRef) return;
  const room = tenantId ? `tenant:${tenantId}` : "admin";
  ioRef.to(room).emit("admin:changed", { tenantId });
}

function emitCalendarChanged(tenantId, event) {
  if (!ioRef) return;
  const room = tenantId ? `tenant:${tenantId}` : "admin";
  ioRef.to(room).emit("calendar:changed", event);
}

function emitTodosChanged(tenantId, event) {
  if (!ioRef) return;
  const room = tenantId ? `tenant:${tenantId}` : "admin";
  ioRef.to(room).emit("todos:changed", event);
}

function emitNotification(userId, notif) {
  if (!ioRef) return;
  ioRef.to(`user:${userId}`).emit("notification", notif);
}

function getIO() {
  return ioRef;
}

module.exports = {
  initMeetingsRealtime,
  emitAdminChanged,
  emitCalendarChanged,
  emitTodosChanged,
  emitNotification,
  getIO,
};