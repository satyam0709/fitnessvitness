"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

export default function ForcedPasswordChangePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forced = searchParams.get("forced") === "true";
  const { user } = useUser();
  const {} = useAuth();

  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!user) {
      setError("User session is not ready. Please reload.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/auth/update-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update password.");

      await apiFetch("/users/password-changed", {
        method: "POST",
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err?.errors?.[0]?.longMessage || err?.message || "Could not update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: "72vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 460, background: "var(--card-bg, #fff)", borderRadius: 14, padding: 20 }}>
        {forced ? (
          <div
            style={{
              marginBottom: 12,
              border: "1px solid rgba(245, 196, 0, 0.4)",
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(245, 196, 0, 0.1)",
            }}
          >
            Your account was created by admin. Please set a new password to continue.
          </div>
        ) : null}
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Change Password</h2>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
          <input
            type="password"
            placeholder="Current password"
            value={form.currentPassword}
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            required
          />
          <input
            type="password"
            placeholder="New password"
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            required
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={form.confirmPassword}
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            required
          />
          {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
