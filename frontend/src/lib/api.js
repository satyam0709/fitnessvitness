function normalizeUrl(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function readBackendUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  const s = normalizeUrl(raw);
  if (s) {
    try {
      return new URL(s);
    } catch {
      return new URL("http://localhost:5000");
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return new URL("http://localhost:5000");
  }

  const vercelHost = normalizeUrl(process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL || "");
  if (vercelHost) {
    return new URL(`${vercelHost}/_/backend`);
  }

  if (typeof window !== "undefined") {
    return new URL(`${window.location.origin}/_/backend`);
  }

  const appBase = String(process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || "").trim();
  if (appBase) {
    return new URL(`https://${appBase}/_/backend`);
  }

  return new URL("http://localhost:5000");
}

const ACCESS_TOKEN_STORAGE_KEY = "crm_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "crm_refresh_token";

export function getAccessToken() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

export function setAccessToken(token) {
  if (typeof window === "undefined") return;
  try {
    const v = String(token || "").trim();
    if (!v) {
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, v);
  } catch {
    // Ignore storage failures (private mode / storage policies).
  }
}

export function clearAccessToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function getRefreshToken() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

export function setRefreshToken(token) {
  if (typeof window === "undefined") return;
  try {
    const v = String(token || "").trim();
    if (!v) {
      window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, v);
  } catch {}
}

export function clearRefreshToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {}
}

function productionBrowserUseSameOriginProxy() {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return false;
  const noProxy =
    process.env.NEXT_PUBLIC_API_NO_PROXY === "1" ||
    process.env.NEXT_PUBLIC_API_NO_PROXY === "true";
  if (noProxy) return false;

  const prodProxy =
    process.env.NEXT_PUBLIC_API_PROD_PROXY === "1" ||
    process.env.NEXT_PUBLIC_API_PROD_PROXY === "true";
  if (prodProxy) return true;

  const raw = String(process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return true;

  // If the public API URL is a different host than this app, calling it directly makes the browser
  // store auth cookies on the API host — /dashboard on the Vercel host then has no session and
  // middleware sends you back to /login?returnTo=/dashboard. Same-origin /api + Next rewrites fixes that.
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const apiOrigin = new URL(href).origin;
    if (apiOrigin !== window.location.origin) return true;
  } catch {
    return true;
  }

  return false;
}

export function getApiBase() {
  const u = readBackendUrl();
  const absolute = `${u.origin}/api`;

  const noProxy =
    process.env.NEXT_PUBLIC_API_NO_PROXY === "1" ||
    process.env.NEXT_PUBLIC_API_NO_PROXY === "true";
  if (noProxy) return absolute;

  if (process.env.NODE_ENV !== "production") {
    const devProxyFlag = String(process.env.NEXT_PUBLIC_API_DEV_PROXY || "").toLowerCase();
    const forceAbsoluteInDev = devProxyFlag === "0" || devProxyFlag === "false";
    if (!forceAbsoluteInDev) return "/api";
    return absolute;
  }

  // In production browser, always use same-origin proxy route so auth cookies are set on app origin.
  // This prevents cross-origin credential/CORS breakage during invite accept + login flows.
  if (typeof window !== "undefined") {
    return "/api";
  }
  return productionBrowserUseSameOriginProxy() ? "/api" : absolute;
}

export function getApiOrigin() {
  if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
    const raw = String(process.env.NEXT_PUBLIC_API_URL || "").trim();
    if (!raw || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) {
      return window.location.origin;
    }
  }
  return readBackendUrl().origin;
}

export function getSocketOrigin() {
  const raw = String(process.env.NEXT_PUBLIC_SOCKET_URL || "").trim();
  if (!raw) return getApiOrigin();
  const normalized = raw.replace(/\/+$/, "");
  const href = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    return new URL(href).origin;
  } catch {
    return getApiOrigin();
  }
}

function tenantFetchHeaders() {
  return {};
}

export function publicFileUrl(storedPath) {
  if (!storedPath) return "";
  if (String(storedPath).startsWith("http")) return storedPath;
  const origin = getApiOrigin();
  const p = String(storedPath).startsWith("/") ? storedPath : `/${storedPath}`;
  return `${origin}${p}`;
}

/**
 * Fires a custom event so any listener (e.g. AuthContext) can redirect to /login.
 * This avoids importing router here which would break SSR.
 */
function dispatchAuthFailure() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth:session-expired"));
}

let refreshInFlight = null;

async function refreshSessionCookie() {
  if (typeof window === "undefined") return false;
  if (!refreshInFlight) {
    const base = getApiBase();
    refreshInFlight = fetch(`${base}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...tenantFetchHeaders(),
      },
      body: JSON.stringify({
        refreshToken: getRefreshToken(),
      }),
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  const r = await refreshInFlight;
  if (!r.ok) return false;
  const j = await parseJsonSafe(r.clone());
  if (j?.token) {
    setAccessToken(j.token);
  }
  return true;
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

let globalSocket = null;

export async function connectGlobalSocket(isSignedIn = true) {
  if (typeof window === "undefined") return null;
  if (!isSignedIn) {
    disconnectGlobalSocket();
    return null;
  }
  if (globalSocket && globalSocket.connected) {
    return globalSocket;
  }
  if (!globalSocket) {
    const { io } = await import("socket.io-client");
    const isProdBrowser =
      typeof window !== "undefined" && process.env.NODE_ENV === "production";
    const primaryTransports = isProdBrowser ? ["websocket"] : ["websocket", "polling"];
    globalSocket = io(getSocketOrigin(), {
      path: "/socket.io",
      auth: {},
      transports: primaryTransports,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    let fallbackTried = false;
    globalSocket.on("connect_error", () => {
      if (!isProdBrowser || fallbackTried) return;
      fallbackTried = true;
      globalSocket.io.opts.transports = ["websocket", "polling"];
      try {
        globalSocket.connect();
      } catch {
        /* ignore reconnect error */
      }
    });
  } else {
    globalSocket.connect();
  }
  return globalSocket;
}

export function disconnectGlobalSocket() {
  if (globalSocket) {
    globalSocket.removeAllListeners();
    globalSocket.disconnect();
    globalSocket = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:session-expired", () => {
    disconnectGlobalSocket();
  });
  window.addEventListener("auth:session-recovered", () => {
    connectGlobalSocket(true);
  });
}


export async function apiFetch(path, getTokenOrOptions, maybeOptions) {
  const options =
    typeof getTokenOrOptions === "function"
      ? maybeOptions || {}
      : getTokenOrOptions || {};

  const base = getApiBase();
  let p = path.startsWith("/") ? path : `/${path}`;

  if (/^\/limit=\d+/i.test(p)) {
    p = `/reminders?${p.slice(1)}`;
  } else if (/^\/\?/i.test(p) && /limit=/i.test(p)) {
    p = `/reminders${p.slice(1)}`;
  }

  const url = `${base}${p}`;
  const isForm = options.body instanceof FormData;

  const doFetch = async () => {
    const token = getAccessToken();
    const headers = {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...tenantFetchHeaders(),
      ...(options.headers || {}),
    };
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    const request = {
      ...options,
      credentials: "include",
      headers,
    };
    const useProxy = p.startsWith('/auth/') || p.startsWith('/api/auth/');
    const fetchUrl = useProxy ? `/api${p}` : url;
    try {
      return await fetch(fetchUrl, request);
    } catch (err) {
      const canRetryViaProxy =
        typeof window !== "undefined" &&
        /^https?:\/\//i.test(base) &&
        base !== "/api" &&
        !useProxy;
      if (!canRetryViaProxy) throw err;
      return fetch(`/api${p}`, request);
    }
  };

  const processResponse = async (res) => {
    if (res.status === 401) {
      const j = await parseJsonSafe(res.clone());
      const hasRefreshFallback = Boolean(getRefreshToken());
      if (j?.code === "TOKEN_EXPIRED" || hasRefreshFallback) {
        const ok = await refreshSessionCookie();
        if (ok) {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("auth:session-recovered"));
          }
          return doFetch();
        }
      }
      dispatchAuthFailure();
      // Return a fake 401 response instead of hanging so callers can handle it
      return new Response(JSON.stringify({ success: false, message: "Session expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return res;
  };

  let res = await doFetch();
  res = await processResponse(res);
  return res;
}
