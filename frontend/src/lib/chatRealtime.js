import { getSocketOrigin } from "@/lib/api";

let socket = null;
let connectPromise = null;
const chatSubs = new Set();
const notifSubs = new Set();
const calendarSubs = new Set();
const workspaceSubs = new Set();

function safeNotifyChat(type, payload) {
  chatSubs.forEach((fn) => {
    try {
      fn(type, payload);
    } catch {
      /* ignore */
    }
  });
}

function safeNotifyNotif(type, payload) {
  notifSubs.forEach((fn) => {
    try {
      fn(type, payload);
    } catch {
      /* ignore */
    }
  });
}

function safeNotifyCalendar(payload) {
  calendarSubs.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  });
}

function safeNotifyWorkspace(payload) {
  workspaceSubs.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  });
}

function totalSubscribers() {
  return chatSubs.size + notifSubs.size + calendarSubs.size + workspaceSubs.size;
}

async function ensureSocket(getTokenFn) {
  if (socket?.connected) return socket;
  if (connectPromise) return connectPromise;

  const tokenFn = typeof getTokenFn === "function" ? getTokenFn : async () => "";

  connectPromise = (async () => {
    let token = null;
    try {
      token = await tokenFn();
    } catch {
      token = null;
    }
    if (token != null && typeof token === "string" && !token.trim()) {
      token = null;
    }

    const { io } = await import("socket.io-client");
    const isProdBrowser =
      typeof window !== "undefined" && process.env.NODE_ENV === "production";
    const primaryTransports = isProdBrowser ? ["websocket"] : ["websocket", "polling"];
    const s = io(getSocketOrigin(), {
      path: "/socket.io",
      auth: token ? { token } : {},
      transports: primaryTransports,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 15000,
    });
    let fallbackTried = false;

    s.on("chat:threads:changed", (payload) => safeNotifyChat("threads", payload));
    s.on("chat:message", (payload) => safeNotifyChat("message", payload));
    s.on("chat:typing", (payload) => safeNotifyChat("typing", payload));

    s.on("notifications:new", (payload) => safeNotifyNotif("new", payload));
    s.on("notifications:read", (payload) => safeNotifyNotif("read", payload));

    s.on("calendar:changed", (payload) => safeNotifyCalendar(payload));
    s.on("meetings:changed", (payload) => safeNotifyCalendar({ ...payload, _channel: "meetings" }));
    s.on("todos:changed", (payload) => safeNotifyCalendar({ ...payload, _channel: "todos" }));
    // Keep workspace access events on this same socket so the app doesn't juggle multiple connections.
    s.on("workspace:access", (payload) => safeNotifyWorkspace(payload));

    s.io.on("reconnect_attempt", async () => {
      try {
        const fresh = await tokenFn();
        if (fresh && s) s.auth = { token: fresh };
      } catch {
        /* ignore */
      }
    });
    s.on("connect_error", () => {
      // Production: prefer websocket-only (avoids polling 400 behind some proxies).
      // If websocket fails, retry once with polling fallback.
      if (!isProdBrowser || fallbackTried) return;
      fallbackTried = true;
      s.io.opts.transports = ["websocket", "polling"];
      try {
        s.connect();
      } catch {
        /* ignore reconnect error */
      }
    });

    socket = s;
    connectPromise = null;
    return s;
  })();

  return connectPromise;
}

function maybeDisconnectSocket() {
  if (totalSubscribers() > 0 || !socket) return;
  try {
    socket.removeAllListeners();
    socket.disconnect();
  } catch {
    /* ignore */
  }
  socket = null;
}

export async function getChatSocket(getTokenFn) {
  return await ensureSocket(getTokenFn);
}

export function subscribeChatEvents(handler, getTokenFn) {
  chatSubs.add(handler);
  void ensureSocket(getTokenFn);

  return () => {
    chatSubs.delete(handler);
    maybeDisconnectSocket();
  };
}

/** Shares the same Socket.io connection as chat (single connection for CRM realtime). */
export function subscribeNotificationEvents(handler, getTokenFn) {
  notifSubs.add(handler);
  void ensureSocket(getTokenFn);

  return () => {
    notifSubs.delete(handler);
    maybeDisconnectSocket();
  };
}

/** Refetch calendar when CRM data affecting the schedule changes (shared socket). */
export function subscribeCalendarLive(handler, getTokenFn) {
  calendarSubs.add(handler);
  void ensureSocket(getTokenFn);

  return () => {
    calendarSubs.delete(handler);
    maybeDisconnectSocket();
  };
}

/**
 * Workspace access updates (role/active/subscription-linked changes) using the shared CRM realtime socket.
 * This keeps one lifecycle for chat, notifications, calendar and access updates.
 */
export function subscribeWorkspaceAccess(handler, getTokenFn) {
  workspaceSubs.add(handler);
  void ensureSocket(getTokenFn);

  return () => {
    workspaceSubs.delete(handler);
    maybeDisconnectSocket();
  };
}
