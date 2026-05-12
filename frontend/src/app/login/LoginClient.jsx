"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, getGlobalAuthData } from "@/contexts/AuthContext";
import { runPostLoginDashboardRouting } from "@/lib/authRouting";
import styles from "./page.module.css";

import Image from "next/image";

/**
 * @param {{ initialReturnTo?: string; initialEmail?: string }} props
 * Query is supplied by the server `page.js` so we avoid `useSearchParams()` + Suspense
 * stalling the whole login shell on production (stuck "Loading…").
 */
export default function LoginClient({ initialReturnTo = "", initialEmail = "" }) {
  const { isLoaded, isSignedIn, login } = useAuth();
  const router = useRouter();
  const searchParams = useMemo(() => {
    const u = new URLSearchParams();
    const rt = String(initialReturnTo || "").trim();
    const em = String(initialEmail || "").trim();
    if (rt) u.set("returnTo", rt);
    if (em) u.set("email", em);
    return u;
  }, [initialReturnTo, initialEmail]);

  const postLoginRedirectStarted = useRef(false);
  const [checking, setChecking] = useState(false);
  const [email, setEmail] = useState(() => String(initialEmail || "").trim());
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const emailPrefill = String(initialEmail || "").trim();
    if (emailPrefill) setEmail(emailPrefill);
  }, [initialEmail]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      postLoginRedirectStarted.current = false;
      setChecking(false);
      return;
    }

    if (postLoginRedirectStarted.current) return;
    postLoginRedirectStarted.current = true;

    let cancelled = false;
    const run = async () => {
      setChecking(true);
      try {
        const isFullRedirect = await runPostLoginDashboardRouting(router, searchParams);
        if (cancelled || typeof window === "undefined") return;
        if (isFullRedirect) return; // Prevent fallback logic since we are navigating away
        
        if (window.location.pathname === "/login" || window.location.pathname.startsWith("/login/")) {
          const rt = searchParams.get("returnTo");
          const dest =
            rt && rt.startsWith("/") && !rt.startsWith("//") ? rt : "/dashboard";
          window.location.assign(dest);
        }
      } catch (err) {
        console.error("post-login redirect", err);
        router.replace("/dashboard");
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, router, searchParams]);

  function normalizeEmailInput(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");
    const emailNorm = normalizeEmailInput(email);
    if (!emailNorm || !password) {
      setFormError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await login(emailNorm, password);
      const { user } = getGlobalAuthData();
      if (!user) {
        setFormError("Session could not be established. Please try again.");
        return;
      }
      postLoginRedirectStarted.current = true;
      setChecking(true);
      try {
        const isFullRedirect = await runPostLoginDashboardRouting(router, searchParams);
        if (isFullRedirect) return; // Prevent fallback logic since we are navigating away
        
        if (typeof window !== "undefined") {
          if (
            window.location.pathname === "/login" ||
            window.location.pathname.startsWith("/login/")
          ) {
            const rt = searchParams.get("returnTo");
            const dest =
              rt && rt.startsWith("/") && !rt.startsWith("//") ? rt : "/dashboard";
            window.location.assign(dest);
          }
        }
      } catch (err) {
        console.error("post-login redirect", err);
        router.replace("/dashboard");
      } finally {
        setChecking(false);
      }
    } catch (err) {
      const msg = err?.message || "Sign in failed.";
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className={styles.page}>
        <div className={styles.formPanel}>
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <p className={styles.loading}>Processing your secure login…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.orb1} />
        <div className={styles.orb2} />

        <div className="animate-fadeIn" style={{ animationDelay: "0.1s" }}>
          <h1 className={styles.panelTitle}>
            Welcome back to your <span>sales command center</span>
          </h1>
          <p className={styles.panelDesc}>
            Everything you need to manage your business, leads, and team in one powerful dashboard.
          </p>
        </div>

        <ul className={styles.bullets}>
          {[
            { text: "All your leads in one place", icon: "fas fa-layer-group" },
            { text: "Follow-ups that never fall through", icon: "fas fa-check-circle" },
            { text: "Real-time team collaboration", icon: "fas fa-users" },
            { text: "Instant alerts on every new lead", icon: "fas fa-bolt" },
          ].map((item, idx) => (
            <li
              key={item.text}
              className={`${styles.bullet} animate-fadeIn`}
              style={{ animationDelay: `${0.2 + idx * 0.1}s` }}
            >
              <div className={styles.bulletIcon}>
                <i className={item.icon} />
              </div>
              {item.text}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.formPanel}>
        <div className={`${styles.formCard} animate-fadeInScale`}>
          <div className={styles.formHeader}>
            <div className={styles.cardLogoWrapper}>
              <Image
                src="/assets/logo.png"
                alt="RND TECHNOSOFT"
                width={160}
                height={54}
                className="logo-blend"
                priority
              />
            </div>
            <h2 className={styles.formTitle}>Sign in</h2>
            <p className={styles.formSubtitle}>Access your professional workspace</p>
          </div>

          {formError ? (
            <div className={`${styles.errorAlert} animate-fadeIn`} role="alert">
              <i className="fas fa-exclamation-circle" />
              {formError}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="email">Email Address</label>
              <div className={styles.inputWrapper}>
                <i className={`fas fa-envelope ${styles.inputIcon}`} />
                <input
                  id="email"
                  className={styles.input}
                  type="email"
                  placeholder="name@company.com"
                  autoComplete="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <div className={styles.inputWrapper}>
                <i className={`fas fa-lock ${styles.inputIcon}`} />
                <input
                  id="password"
                  className={styles.input}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  required
                />
              </div>
            </div>

            <button className={styles.submitBtn} type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className={styles.btnSpinner} />
                  Signing in…
                </>
              ) : (
                "Continue to Dashboard"
              )}
            </button>
          </form>

          <div className={styles.formFooter}>
            <p>Don&apos;t have a workspace?</p>
            <div className={styles.footerLinks}>
              <Link href="/signup">Create workspace</Link>
              <span className={styles.separator}>•</span>
              <span>Use invitation link from email</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
