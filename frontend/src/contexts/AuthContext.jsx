"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import {
  getApiBase,
  getTenantSubdomainFromHost,
  disconnectGlobalSocket,
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  setRefreshToken,
  clearRefreshToken,
  getRefreshToken,
} from "@/lib/api";

const AuthContext = createContext(null);

let globalAuthData = { user: null, mePayload: null };

export function getGlobalAuthData() {
  return globalAuthData;
}

let loadSessionInFlight = null;

function isPublicRoutePath(pathname) {
  const p = String(pathname || "").toLowerCase();
  return (
    p.startsWith("/login") ||
    p.startsWith("/signup") ||
    p.startsWith("/invite") ||
    p.startsWith("/sign-in") ||
    p.startsWith("/register")
  );
}

function tenantHeaders() {
  const headers = {};
  const sub = getTenantSubdomainFromHost();
  if (sub) {
    headers["X-Tenant-Subdomain"] = sub;
    headers["X-Tenant-Slug"] = sub;
  }
  return headers;
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [mePayload, setMePayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadSessionRef = useRef(false);

  const loadSession = useCallback(async (force = false) => {
    // Deduplicate concurrent calls — share one in-flight promise
    if (!force && loadSessionInFlight) return loadSessionInFlight;
    if (loadSessionRef.current && !force) return loadSessionInFlight || Promise.resolve();
    loadSessionRef.current = true;

    const run = async () => {
      const base = getApiBase();
      const headers = {
        "Content-Type": "application/json",
        ...tenantHeaders(),
      };
      const token = getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const fetchMe = async () =>
        fetch(`${base}/auth/me`, { credentials: "include", headers });

      let res;
      try {
        res = await fetchMe();
      } catch (err) {
        console.warn("auth loadSession: network error", err.message);
        globalAuthData = { user: null, mePayload: null };
        setUser(null);
        setMePayload(null);
        return;
      }

      if (res.status === 401) {
        const j = await parseJsonSafe(res.clone());

        if (j?.code === "TOKEN_EXPIRED") {
          try {
            const ref = await fetch(`${base}/auth/refresh`, {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({
                refreshToken: getRefreshToken(),
              }),
            });

            if (ref.ok) {
              res = await fetchMe();
            } else {
              globalAuthData = { user: null, mePayload: null };
              setUser(null);
              setMePayload(null);
              return;
            }
          } catch (err) {
            console.warn("auth refresh: network error", err.message);
            globalAuthData = { user: null, mePayload: null };
            setUser(null);
            setMePayload(null);
            return;
          }
        } else {
          // Plain 401 — not logged in yet, handle silently
          globalAuthData = { user: null, mePayload: null };
          setUser(null);
          setMePayload(null);
          return;
        }
      }

      if (!res.ok) {
        globalAuthData = { user: null, mePayload: null };
        setUser(null);
        setMePayload(null);
        return;
      }

      const body = await parseJsonSafe(res);
      const data = body?.data;
      if (!data?.user) {
        globalAuthData = { user: null, mePayload: null };
        setUser(null);
        setMePayload(null);
        return;
      }

      const u = data.user;
      const finalUser = {
        ...u,
        mustChangePassword: Boolean(u.mustChangePassword ?? Number(u.must_change_password) === 1),
      };

      if (typeof document !== "undefined") {
        if (data?.onboarding_locked === true) {
          document.cookie = "onboarding_lock=1; Path=/; SameSite=Lax";
        } else {
          document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
        }
      }

      globalAuthData = { user: finalUser, mePayload: data };
      setMePayload(data);
      setUser(finalUser);
    };

    loadSessionInFlight = run().finally(() => {
      loadSessionInFlight = null;
      loadSessionRef.current = false;
    });
    return loadSessionInFlight;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        if (typeof window !== "undefined" && isPublicRoutePath(window.location.pathname)) {
          globalAuthData = { user: null, mePayload: null };
          setUser(null);
          setMePayload(null);
          return;
        }
        await loadSession();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // When apiFetch can't refresh the session, it fires this event.
  // We clear state and let the middleware redirect to /login on next navigation,
  // or force it immediately here.
  useEffect(() => {
    function handleSessionExpired() {
      setUser(null);
      setMePayload(null);
      if (typeof window !== "undefined") {
        const current = window.location.pathname;
        const isProtected = !["/login", "/signup", "/invite"].some((p) =>
          current.startsWith(p)
        );
        if (isProtected) {
          window.location.href = `/login?returnTo=${encodeURIComponent(current)}`;
        }
      }
    }
    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("auth:session-expired", handleSessionExpired);
    };
  }, []);

  const login = useCallback(
    async (email, password) => {
      const base = getApiBase();
      const headers = {
        "Content-Type": "application/json",
        ...tenantHeaders(),
      };
      let res;
      try {
        res = await fetch(`${base}/auth/login`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new Error("Unable to reach server. Check backend/CORS configuration.");
      }
      const j = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(j?.message || "Login failed");
      }
      if (j?.token) {
        setAccessToken(j.token);
      }
      if (j?.refreshToken || j?.refresh_token) {
        setRefreshToken(j.refreshToken || j.refresh_token);
      }
      if (j?.user) {
        setUser((prev) => ({ ...prev, ...j.user }));
      }
      await loadSession(true);
      let after = null;
      for (let i = 0; i < 8; i++) {
        after = getGlobalAuthData().user;
        if (after) break;
        await new Promise((r) => setTimeout(r, 60));
      }
      if (!after) {
        // Fallback for environments where cookie persistence is flaky:
        // trust the verified login response and continue with bearer-token auth.
        if (j?.user) {
          globalAuthData = { user: j.user, mePayload: { user: j.user } };
          setUser(j.user);
          setMePayload((prev) => ({ ...(prev || {}), user: j.user }));
          return j;
        }
        throw new Error(
          "Sign-in succeeded but the session could not be restored. " +
            "Please retry and, if it persists, share /api/auth/login response headers and body."
        );
      }
      return j;
    },
    [loadSession]
  );

  const logout = useCallback(async () => {
    const base = getApiBase();
    const headers = {
      "Content-Type": "application/json",
      ...tenantHeaders(),
    };
    try {
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers,
      });
    } finally {
      globalAuthData = { user: null, mePayload: null };
      setUser(null);
      setMePayload(null);
      clearAccessToken();
      clearRefreshToken();
      if (typeof document !== "undefined") {
        document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
      }
      disconnectGlobalSocket();
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      me: mePayload,
      isLoading,
      isAuthenticated: Boolean(user),
      isLoaded: !isLoading,
      isSignedIn: Boolean(user),
      userId: user?.id != null ? String(user.id) : null,
      login,
      logout,
      refreshSession: loadSession,
      getToken: async () => "",
    }),
    [user, mePayload, isLoading, login, logout, loadSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function useUser() {
  const { user, isLoading } = useAuth();
  const email = user?.email || "";
  const clerkLike = user
    ? {
        id: String(user.id),
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        imageUrl: user.profile_image || "",
        primaryEmailAddress: email ? { emailAddress: email } : null,
        emailAddresses: email ? [{ emailAddress: email }] : [],
        publicMetadata: {
          role: user.role || user.tenant_role_slug || "staff",
        },
      }
    : null;
  return {
    isLoaded: !isLoading,
    user: clerkLike,
  };
}

export function useClerk() {
  const { logout } = useAuth();
  const router = useRouter();
  return {
    signOut: async (opts) => {
      await logout();
      const dest =
        typeof opts?.redirectUrl === "string"
          ? opts.redirectUrl
          : typeof opts?.redirectUrl === "object" && opts?.redirectUrl?.url
            ? opts.redirectUrl.url
            : "/login";
      router.push(dest || "/login");
    },
  };
}

export function SignedIn({ children }) {
  const { isSignedIn } = useAuth();
  return isSignedIn ? children : null;
}

export function SignedOut({ children }) {
  const { isSignedIn } = useAuth();
  return !isSignedIn ? children : null;
}

export function ClerkProvider({ children }) {
  return children;
}

export function UserButton({ afterSignOutUrl = "/" }) {
  const { user, logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!isAuthenticated || !user) return null;

  const label =
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "Account";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#fff",
          cursor: "pointer",
          fontSize: 14,
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#111827",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {(label[0] || "?").toUpperCase()}
        </span>
        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
              background: "transparent",
              border: "none",
              cursor: "default",
            }}
          />
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: "100%",
              marginTop: 6,
              minWidth: 180,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
              zIndex: 50,
              padding: 8,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push("/profile");
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 6,
              }}
            >
              Profile
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.push(afterSignOutUrl || "/");
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 6,
                color: "#b91c1c",
              }}
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}