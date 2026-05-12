"use client";

import { useAuth } from "@/contexts/AuthContext";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { subscriptionGrantedFromOrdersPayload, trialEndMsFromCreated } from "@/lib/trialAccess";
import { isPlatformSuperAdmin } from "@/lib/platformUser";
import { resolvePostLoginTarget } from "@/lib/authRouting";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";
import styles from "./subscriptionGate.module.css";

const SubscriptionPayloadContext = createContext(null);

const SESSION_SUB_KEY = "crm_sub_gate";

function readSubscriptionSession(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const raw = sessionStorage.getItem(SESSION_SUB_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    return o?.userId === userId && o.v === 1;
  } catch {
    return false;
  }
}

function writeSubscriptionSession(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    sessionStorage.setItem(SESSION_SUB_KEY, JSON.stringify({ userId, v: 1, t: Date.now() }));
  } catch {
    /* quota / private mode */
  }
}

function clearSubscriptionSession() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_SUB_KEY);
  } catch {
    /* ignore */
  }
}

/** Latest GET /orders JSON for dashboard (trial countdown, refresh). Only set when access is granted. */
export function useSubscriptionPayload() {
  return useContext(SubscriptionPayloadContext);
}

const UNGATED = ["/add-package"];
/** Enough retries for transient errors; 429 uses longer waits between attempts. */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 600;
const TRIAL_POLL_MS = 45_000;
/** After rate-limit responses, wait before retrying (Render / express-rate-limit). */
const RATE_LIMIT_BACKOFF_MS = 10_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function SubscriptionGate({ children }) {
  const { isLoaded, userId, isSignedIn, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState("checking");
  const [retryKey, setRetryKey] = useState(0);
  const [ordersPayload, setOrdersPayload] = useState(null);
  const ordersPayloadRef = useRef(null);
  useEffect(() => {
    ordersPayloadRef.current = ordersPayload;
  }, [ordersPayload]);
  /** Avoid re-fetching / full-screen "Verifying..." on every in-app navigation; reset on user change. */
  const subscriptionOkRef = useRef(false);
  const prevUserIdRef = useRef(undefined);
  const trialPollRef = useRef(null);
  const trialExpireTimerRef = useRef(null);
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  /** Prevents overlapping checks (React Strict Mode + rapid re-renders). */
  const checkInFlightRef = useRef(false);

  /**
   * Restore session verification after mount (useEffect, not useLayoutEffect) so server HTML
   * matches the first client paint and we avoid hydration / RSC errors on /dashboard.
   */
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (readSubscriptionSession(userId)) {
      subscriptionOkRef.current = true;
      setStatus("ok");
    }
  }, [isLoaded, userId]);

  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prev && userId && prev !== userId) {
      subscriptionOkRef.current = false;
      setOrdersPayload(null);
      clearSubscriptionSession();
    }
    if (!userId) {
      subscriptionOkRef.current = false;
      setOrdersPayload(null);
    }
  }, [userId]);

  const clearTrialTimers = useCallback(() => {
    if (trialPollRef.current) {
      clearInterval(trialPollRef.current);
      trialPollRef.current = null;
    }
    if (trialExpireTimerRef.current) {
      clearTimeout(trialExpireTimerRef.current);
      trialExpireTimerRef.current = null;
    }
  }, []);

  const runCheck = useCallback(
    async (silent = false) => {
      if (!isLoaded) return;

      if (!userId) {
        subscriptionOkRef.current = false;
        routerRef.current.replace("/login");
        return;
      }

      if (isPlatformSuperAdmin(user)) {
        subscriptionOkRef.current = true;
        if (typeof document !== "undefined") {
          document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
        }
        setOrdersPayload(null);
        setStatus("ok");
        return;
      }

      // Enforce workspace subdomain before proceeding
      if (typeof window !== "undefined") {
        try {
          const sp = new URLSearchParams(window.location.search);
          const target = await resolvePostLoginTarget(sp);
          if (target.kind === "full") {
            window.location.href = target.href;
            return;
          }
        } catch (err) {
          console.warn("SubscriptionGate workspace enforcement error:", err);
        }
      }

      const isWorkspaceMemberNonOwner =
        Boolean(user?.tenant_id) &&
        !isPlatformSuperAdmin(user) &&
        user?.is_workspace_owner !== true &&
        (user?.invited_by != null ||
          user?.role === "staff" ||
          user?.role === "manager" ||
          user?.tenant_role_slug === "staff" ||
          user?.tenant_role_slug === "manager" ||
          user?.tenant_role_slug === "viewer");
      if (isWorkspaceMemberNonOwner) {
        subscriptionOkRef.current = true;
        writeSubscriptionSession(userId);
        if (typeof document !== "undefined") {
          document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
        }
        setStatus("ok");
        return;
      }

      const pathNow = pathnameRef.current;
      const ungatedNow = UNGATED.some((p) => pathNow.startsWith(p));

      if (ungatedNow) {
        setStatus("ok");
        return;
      }

      /* Same browser session already passed /orders for this user — render fast, refresh in background. */
      if (!subscriptionOkRef.current && readSubscriptionSession(userId)) {
        subscriptionOkRef.current = true;
      }

      if (!silent && subscriptionOkRef.current) {
        setStatus("ok");
        if (ordersPayloadRef.current != null) {
          return;
        }
      }

      if (checkInFlightRef.current) {
        return;
      }
      checkInFlightRef.current = true;

      if (!silent && !subscriptionOkRef.current) {
        setStatus("checking");
      }

      let lastErr = null;

      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            const res = await apiFetch("/orders");

            if (res.status === 401) {
              clearSubscriptionSession();
              routerRef.current.replace("/login");
              return;
            }

            const data = await res.json().catch(() => ({}));

            if (res.status === 429) {
              lastErr = new Error(data.message || "Too many requests. Try again later.");
              if (attempt < MAX_ATTEMPTS - 1) {
                await sleep(RATE_LIMIT_BACKOFF_MS + attempt * 4000);
              }
              continue;
            }

            if (!res.ok) {
              throw new Error(data.message || `Request failed (${res.status})`);
            }

            const hasValidSub = subscriptionGrantedFromOrdersPayload(data);

            if (hasValidSub) {
              subscriptionOkRef.current = true;
              writeSubscriptionSession(userId);
              if (typeof document !== "undefined") {
                document.cookie = "onboarding_lock=; Path=/; Max-Age=0; SameSite=Lax";
              }
              setOrdersPayload(data);
              setStatus("ok");
              return;
            }

            subscriptionOkRef.current = false;
            clearSubscriptionSession();
            setOrdersPayload(null);
            setStatus("locked");
            routerRef.current.replace("/add-package");
            return;
          } catch (e) {
            lastErr = e;
            if (attempt < MAX_ATTEMPTS - 1) {
              await sleep(BASE_DELAY_MS * 2 ** attempt);
            }
          }
        }

        console.error("SubscriptionGate: orders check failed after retries", lastErr);
        subscriptionOkRef.current = false;
        clearSubscriptionSession();
        setOrdersPayload(null);
        if (!silent) setStatus("error");
      } finally {
        checkInFlightRef.current = false;
      }
    },
    [isLoaded, userId, user]
  );

  /** Intentionally depend only on stable primitives + retryKey so runCheck identity stays stable. */
  useEffect(() => {
    void runCheck(false);
    return () => {
      checkInFlightRef.current = false;
    };
  }, [isLoaded, userId, retryKey, runCheck]);

  /** Re-run orders check when backend signals this user's access changed (role / active). */
  useEffect(() => {
    if (!isLoaded || !userId) return undefined;
    return subscribeWorkspaceAccess((payload) => {
      if (payload?.clerkUserId && payload.clerkUserId !== userId) return;
      subscriptionOkRef.current = false;
      clearSubscriptionSession();
      setRetryKey((k) => k + 1);
    });
  }, [isLoaded, userId]);

  /** While on an exact-time trial, re-fetch periodically and once at expiry so access revokes without navigation. */
  useEffect(() => {
    clearTrialTimers();
    if (status !== "ok" || !ordersPayload) return;

    if (
      ordersPayload.subscriptionAccess?.source === "admin" ||
      ordersPayload.subscriptionAccess?.isAdmin === true
    ) {
      return undefined;
    }

    const trialOrder = Array.isArray(ordersPayload.orders)
      ? ordersPayload.orders.find((o) => o.status === "trial")
      : null;
    if (!trialOrder) return;

    const endMs = trialEndMsFromCreated(trialOrder.created_at);
    if (endMs == null) return;

    const delay = endMs - Date.now() + 250;
    if (delay > 0 && delay < 2147483647) {
      trialExpireTimerRef.current = setTimeout(() => {
        subscriptionOkRef.current = false;
        clearSubscriptionSession();
        setOrdersPayload(null);
        setRetryKey((k) => k + 1);
      }, delay);
    }

    trialPollRef.current = setInterval(() => {
      runCheck(true);
    }, TRIAL_POLL_MS);

    return clearTrialTimers;
  }, [status, ordersPayload, clearTrialTimers, runCheck]);

  const refreshOrders = useCallback(() => {
    subscriptionOkRef.current = false;
    clearSubscriptionSession();
    setRetryKey((k) => k + 1);
  }, []);

  if (!isLoaded) {
    return (
      <div className={styles.shell} aria-busy="true">
        <div className={styles.bar} />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className={styles.shell} aria-busy="true">
        <div className={styles.bar} />
      </div>
    );
  }

  const onDashboard =
    pathname === "/dashboard" || pathname === "/dashboard/" || pathname.startsWith("/dashboard?");
  const firstSubscriptionCheck =
    typeof window !== "undefined" &&
    userId &&
    !readSubscriptionSession(userId);

  if (status === "checking") {
    return (
      <div className={styles.shell} aria-busy="true" aria-live="polite">
        <div className={styles.bar} />
        {onDashboard ? (
          <div className={styles.hintDashboard}>
            {firstSubscriptionCheck ? "Verifying your account…" : "Setting up your workspace…"}
          </div>
        ) : (
          <div className={styles.hintSubtle}>Almost ready…</div>
        )}
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          gap: "10px",
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          color: "var(--text-muted)",
        }}
      >
        <i className="fas fa-spinner fa-spin" style={{ color: "#F5C400" }} />
        Redirecting to package setup...
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          padding: "24px",
        }}
      >
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "32px 28px",
            maxWidth: "440px",
            width: "100%",
            textAlign: "center",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚠️</div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: "20px",
              color: "var(--text-main)",
              margin: "0 0 10px",
            }}
          >
            Could not verify subscription
          </h2>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              margin: "0 0 24px",
            }}
          >
            We could not reach the server to confirm your plan after several tries. If you recently saw
            &quot;too many requests&quot;, wait a minute and retry — the app may have retried too quickly during
            load. Otherwise check your connection and API URL, then retry.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              style={{
                padding: "12px 22px",
                background: "var(--yellow)",
                color: "var(--bg-deep)",
                border: "none",
                borderRadius: "10px",
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
            <Link
              href="/add-package"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "12px 22px",
                background: "transparent",
                color: "var(--text-main)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "14px",
                textDecoration: "none",
              }}
            >
              Add package
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === "ok" && ordersPayload) {
    return (
      <SubscriptionPayloadContext.Provider
        value={{ payload: ordersPayload, refresh: refreshOrders }}
      >
        {children}
      </SubscriptionPayloadContext.Provider>
    );
  }

  if (status === "ok") {
    return (
      <SubscriptionPayloadContext.Provider value={null}>
        {children}
      </SubscriptionPayloadContext.Provider>
    );
  }

  return children;
}
