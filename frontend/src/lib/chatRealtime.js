import { getSocketOrigin } from "@/lib/api";

let socket = null;
let connectPromise = null;
const chatSubs = new Set();
const notifSubs = new Set();
const calendarSubs = new Set();
const workspaceSubs = new Set();
const crmSubs = new Map();

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

function safeNotifyCrm(event, payload) {
  crmSubs.forEach((handler, events) => {
    if (!events.has(event) && !events.has("*")) return;
    try {
      handler(event, payload);
    } catch {
      /* ignore */
    }
  });
}

function totalSubscribers() {
  return (
    chatSubs.size + notifSubs.size + calendarSubs.size + workspaceSubs.size + crmSubs.size
  );
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

    s.on("leads:changed", (payload) => safeNotifyCrm("leads:changed", payload));
    s.on("reminders:changed", (payload) => safeNotifyCrm("reminders:changed", payload));
    s.on("tasks:changed", (payload) => safeNotifyCrm("tasks:changed", payload));
    s.on("crm-tasks-changed", (payload) => safeNotifyCrm("tasks:changed", payload));
    s.on("tickets:changed", (payload) => safeNotifyCrm("tickets:changed", payload));
    s.on("contacts:changed", (payload) => safeNotifyCrm("contacts:changed", payload));
    s.on("notes:changed", (payload) => safeNotifyCrm("notes:changed", payload));
    s.on("opportunities:changed", (payload) => safeNotifyCrm("opportunities:changed", payload));
    s.on("collections:changed", (payload) => safeNotifyCrm("collections:changed", payload));
    s.on("invoices:changed", (payload) => safeNotifyCrm("invoices:changed", payload));

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

/**
 * Subscribe to CRM list refresh events on the shared socket.
 * @param {string[]} events e.g. ["leads:changed", "calendar:changed"] or ["*"]
 * @param {(event: string, payload: unknown) => void} handler
 */
export function subscribeCrmLive(events, handler, getTokenFn) {
  const set = new Set(Array.isArray(events) ? events : [events]);
  crmSubs.set(handler, set);
  void ensureSocket(getTokenFn);

  return () => {
    crmSubs.delete(handler);
    maybeDisconnectSocket();
  };
}

/** Refetch Today Command Center when any relevant CRM/calendar/fitness data changes. */
export function subscribeTodayLive(handler, getTokenFn) {
  const notify = () => {
    try {
      handler();
    } catch {
      /* ignore */
    }
  };

  const unsubCal = subscribeCalendarLive(notify, getTokenFn);
  const unsubCrm = subscribeCrmLive(
    [
      "tasks:changed",
      "reminders:changed",
      "leads:changed",
      "opportunities:changed",
      "collections:changed",
    ],
    notify,
    getTokenFn
  );

  let socketRef = null;
  const onFitness = () => notify();
  void ensureSocket(getTokenFn).then((s) => {
    socketRef = s;
    s.on("fitness:changed", onFitness);
  });

  return () => {
    unsubCal();
    unsubCrm();
    if (socketRef) {
      socketRef.off("fitness:changed", onFitness);
    }
  };
}
