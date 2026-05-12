"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, getApiBase, getAppBaseDomain, setAccessToken, setRefreshToken } from "@/lib/api";
import { setAccessTokenCookie } from "@/lib/auth";
import loginStyles from "../login/page.module.css";
import styles from "./page.module.css";
import Image from "next/image";

function slugifyCompany(name) {
  const s = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.length >= 2 ? s : "";
}

function SignupInner() {
  const router = useRouter();
  const { login } = useAuth();

  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const [globalErr, setGlobalErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyName.trim() || slugTouched) return;
    const s = slugifyCompany(companyName);
    if (s) setCompanySlug(s);
  }, [companyName, slugTouched]);

  const validateStep1 = useCallback(() => {
    if (!companyName.trim() || !fullName.trim() || !email.trim()) {
      setGlobalErr("Company name, your name, and email are required.");
      return false;
    }
    if (!companySlug.trim() || companySlug.length < 2) {
      setGlobalErr("Choose a workspace URL (slug) at least 2 characters, lowercase letters, numbers, and hyphens.");
      return false;
    }
    if (!/^([a-z0-9]+(-[a-z0-9]+)*)$/.test(companySlug.trim())) {
      setGlobalErr("Workspace URL may only contain lowercase letters, numbers, and single hyphens.");
      return false;
    }
    if (password.length < 8) {
      setGlobalErr("Password must be at least 8 characters.");
      return false;
    }
    if (password !== password2) {
      setGlobalErr("Passwords do not match.");
      return false;
    }
    setGlobalErr("");
    return true;
  }, [companyName, fullName, email, companySlug, password, password2]);

  async function registerWorkspace() {
    const res = await apiFetch("/auth/register-company", {
      method: "POST",
      body: JSON.stringify({
        name: fullName.trim(),
        company_name: companyName.trim(),
        company_slug: companySlug.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim() || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.message || "Registration failed.";
      throw new Error(msg);
    }
    return j;
  }

  async function completeStep1AndContinue() {
    setBusy(true);
    setGlobalErr("");
    try {
      const resp = await registerWorkspace();
      if (typeof window !== "undefined") {
        if (resp?.data?.token) {
          setAccessToken(resp.data.token);
          await setAccessTokenCookie(resp.data.token);
        }
        if (resp?.data?.refreshToken) {
          setRefreshToken(resp.data.refreshToken);
        }
        try {
          window.localStorage.setItem(
            "rnd_onboarding",
            JSON.stringify({
              from: "workspace-signup",
              companyName: companyName.trim(),
              companySlug: companySlug.trim().toLowerCase(),
              email: email.trim().toLowerCase(),
              createdAt: Date.now(),
            })
          );
        } catch {
          /* ignore storage errors */
        }
      }
      
      const nextUrl =
        resp?.data?.nextUrl && String(resp.data.nextUrl).startsWith("/")
          ? resp.data.nextUrl
          : "/add-package?onboarding=1";
      
      if (typeof window !== "undefined") {
        // Hard redirect to ensure cookies are processed by browser before middleware runs
        window.location.href = nextUrl;
      } else {
        router.replace(nextUrl);
      }
    } catch (e) {
      setGlobalErr(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function nextFromStep1() {
    if (!validateStep1()) return;
    void completeStep1AndContinue();
  }

  return (
    <div className={loginStyles.page}>
      <div className={loginStyles.panel}>
        {/* Decorative elements */}
        <div className={loginStyles.orb1} />
        <div className={loginStyles.orb2} />
        
        <div className="animate-fadeIn" style={{ animationDelay: '0.1s' }}>
          <h1 className={loginStyles.panelTitle}>
            Launch your <span>workspace</span> in minutes
          </h1>
          <p className={loginStyles.panelDesc}>
            Join thousands of businesses scaling their operations with our high-performance CRM platform.
          </p>
        </div>

        <ul className={loginStyles.bullets}>
          {[
            { text: "Dedicated subdomain & isolated data", icon: "fas fa-server" },
            { text: "7-day trial included on signup", icon: "fas fa-calendar-check" },
            { text: "Role-based access for your team", icon: "fas fa-user-shield" },
            { text: "Upgrade or add-ons anytime", icon: "fas fa-rocket" },
          ].map((item, idx) => (
            <li 
              key={item.text} 
              className={`${loginStyles.bullet} animate-fadeIn`}
              style={{ animationDelay: `${0.2 + idx * 0.1}s` }}
            >
              <div className={loginStyles.bulletIcon}>
                <i className={item.icon} />
              </div>
              {item.text}
            </li>
          ))}
        </ul>
      </div>

      <div className={loginStyles.formPanel}>
        <div className={`${loginStyles.formCard} ${styles.formCardWide} animate-fadeInScale`}>
          <div className={loginStyles.formHeader}>
            <div className={loginStyles.cardLogoWrapper}>
              <Image 
                src="/assets/logo.png" 
                alt="RND TECHNOSOFT" 
                width={160} 
                height={54} 
                className="logo-blend"
                priority
              />
            </div>
            <h2 className={loginStyles.formTitle}>Create workspace</h2>
            <p className={loginStyles.formSubtitle}>
              Already have an account? <Link href="/login" style={{ color: 'var(--text)', fontWeight: '700' }}>Sign in</Link>
            </p>
          </div>

          <div className={styles.stepBar}>
            {[1, 2].map((n) => (
              <div key={n} className={`${styles.stepPill} ${n === 1 ? styles.stepPillActive : ""}`}>
                {`Step ${n}`}
              </div>
            ))}
          </div>

          {globalErr ? (
            <div className={`${loginStyles.errorAlert} animate-fadeIn`} role="alert">
              <i className="fas fa-exclamation-circle" />
              {globalErr}
            </div>
          ) : null}

          <form className={styles.signupForm} onSubmit={(e) => { e.preventDefault(); nextFromStep1(); }}>
              <div className={loginStyles.field}>
                <label>Company name</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-building ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    autoComplete="organization"
                    required
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Your name</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-user ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Doe"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Work email</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-envelope ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@company.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Phone <span className={styles.hint}>(optional)</span></label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-phone ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Password</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-lock ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Confirm password</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-shield-alt ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <div className={loginStyles.field}>
                <label>Workspace URL</label>
                <div className={loginStyles.inputWrapper}>
                  <i className={`fas fa-link ${loginStyles.inputIcon}`} />
                  <input
                    className={loginStyles.input}
                    value={companySlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setCompanySlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                    placeholder="your-company"
                    required
                  />
                </div>
                <span className={styles.hint}>
                  Your unique URL: <strong>{companySlug || "your-company"}.{getAppBaseDomain()}</strong>
                </span>
              </div>
              
              <button type="submit" className={loginStyles.submitBtn} style={{ marginTop: '20px' }} disabled={busy}>
                {busy ? (
                  <><span className={loginStyles.btnSpinner} /> Creating workspace…</>
                ) : (
                  <>Continue to add package <i className="fas fa-arrow-right" style={{ fontSize: '14px' }} /></>
                )}
              </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className={loginStyles.page}>
          <div className={loginStyles.formPanel}>
            <p className={loginStyles.loading}>Loading…</p>
          </div>
        </div>
      }
    >
      <SignupInner />
    </Suspense>
  );
}
