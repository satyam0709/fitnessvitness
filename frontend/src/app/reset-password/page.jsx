"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getApiBase } from "@/lib/api";
import styles from "./page.module.css";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = String(searchParams.get("token") || "").trim();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canSubmit = useMemo(() => {
    return Boolean(token) && password.length >= 8 && confirmPassword.length >= 8 && password === confirmPassword;
  }, [token, password, confirmPassword]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!token) {
      setError("Reset token is missing.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.message || "Could not reset password.");
        return;
      }
      setNotice("Password updated. Signing you in...");
      try {
        // Email is not available from token context; send user to login for explicit auth.
        router.replace("/login");
      } catch {
        router.replace("/login");
      }
    } catch (err) {
      setError(err?.message || "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Reset Password</h1>
        {!token ? <p className={styles.error}>Reset token is missing or invalid.</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            New password
            <input
              className={styles.input}
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className={styles.label}>
            Confirm password
            <input
              className={styles.input}
              type="password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          <div className={styles.actions}>
            <button type="button" className={styles.btnSecondary} onClick={() => router.push("/login")}>
              Back to login
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={submitting || !canSubmit}>
              {submitting ? "Updating..." : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className={styles.page}>Loading...</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}

