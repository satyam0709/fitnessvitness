"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBase } from "@/lib/api";
import { runPostLoginDashboardRouting } from "@/lib/authRouting";

function AcceptInvitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const token = String(searchParams.get("token") || "").trim();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError("Invitation token is missing.");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`${getApiBase()}/invitations/${encodeURIComponent(token)}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.success) {
          if (!cancelled) setError(j?.message || "Invalid invitation link.");
          return;
        }
        if (!j.valid) {
          if (!cancelled) setError("This invitation is expired or already used.");
          return;
        }
        if (!cancelled) setInvite(j.data || null);
      } catch {
        if (!cancelled) setError("Could not validate invitation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    if (!invite || submitting) return;
    setError("");
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
      const res = await fetch(`${getApiBase()}/invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        const code = String(j?.code || "");
        console.warn("invite_accept_failed", { code, status: res.status, hasToken: Boolean(token) });
        if (code === "INVITE_EXPIRED") {
          setError("This invitation link has expired. Ask your admin to send a new invitation.");
          return;
        }
        if (code === "INVITE_INACTIVE") {
          setError("This invitation is already used or inactive. Try signing in directly.");
          return;
        }
        if (code === "INVITE_NOT_FOUND") {
          setError("Invitation not found. Check the full link from your email.");
          return;
        }
        setError(j?.message || "Could not accept invitation.");
        return;
      }
      try {
        await login(invite.email, password);
        await runPostLoginDashboardRouting(router, searchParams);
      } catch (e2) {
        console.warn("invite_accept_autologin_failed", {
          email: invite?.email || null,
          reason: e2?.message || "unknown",
        });
        setError(
          e2?.message ||
            "Invitation accepted and password saved, but auto sign-in failed. Please log in manually with your new password."
        );
      }
    } catch (e) {
      setError(e?.message || "Could not complete sign-in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#f8fafc" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: 24 }}>Accept Invitation</h1>
        {loading ? <p style={{ margin: 0 }}>Verifying invitation...</p> : null}
        {!loading && error ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p>
            <button
              type="button"
              onClick={() => router.push(`/login?email=${encodeURIComponent(invite?.email || "")}`)}
              style={{
                width: "fit-content",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "8px 12px",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Go to login
            </button>
          </div>
        ) : null}
        {!loading && !error && invite ? (
          <>
            <p style={{ marginTop: 0, color: "#374151" }}>
              Invited as <strong>{invite.role}</strong> to <strong>{invite.workspace_name}</strong> ({invite.email})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="password"
                placeholder="Set your new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px" }}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px" }}
              />
              <button
                type="button"
                onClick={accept}
                disabled={submitting}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: "#111827",
                  color: "#fff",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Please wait..." : "Set password and login"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading invite...</div>}>
      <AcceptInvitePageInner />
    </Suspense>
  );
}

