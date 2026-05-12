"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

const SHOW_PLATFORM_USERS = false;

export default function AdminPlatformUsersPage() {
  useAuth();
  const router = useRouter();
  const { refreshNonce } = useAdminRealtime();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    clerkUserId: "",
    email: "",
    firstName: "",
    lastName: "",
    role: "staff",
    password: "",
    confirmPassword: "",
  });
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);

  useEffect(() => {
    if (!SHOW_PLATFORM_USERS) {
      router.replace("/admin/users");
    }
  }, [router]);

  const load = useCallback(async () => {
    if (!SHOW_PLATFORM_USERS) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await apiFetch("/admin/platform-users");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setErr(data.message || "Could not load platform users");
        setRows([]);
        return;
      }
      setRows(data.data || []);
    } catch (e) {
      setErr(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!SHOW_PLATFORM_USERS) return;
    load();
  }, [load, refreshNonce]);

  async function submitAdd() {
    if (!SHOW_PLATFORM_USERS) return;
    setErr(null);
    setNotice("");
    if (form.password && form.password.length < 8) {
      setErr("Temporary password must be at least 8 characters.");
      return;
    }
    if ((form.password || form.confirmPassword) && form.password !== form.confirmPassword) {
      setErr("Temporary password and confirm password do not match.");
      return;
    }
    const res = await apiFetch("/admin/platform-users", {
      method: "POST",
      body: JSON.stringify({
        clerkUserId: form.clerkUserId.trim(),
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        role: form.role,
        password: form.password,
        sendWelcomeEmail,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rawMessage = String(j?.message || "").toLowerCase();
      if (res.status === 409 && rawMessage.includes("exist")) {
        setErr("This email already exists in Clerk and could not be linked automatically. Ask the user to sign in once, then try Add User again.");
      } else {
        setErr(j.message || "Create failed");
      }
      return;
    }
    const linkedText = j?.linkedExistingClerkUser ? " Existing Clerk account linked." : "";
    if (!sendWelcomeEmail) {
      setNotice(`User added (invitation email disabled).${linkedText}`);
    } else if (j?.mail?.ok) {
      const channel = j?.mail?.channel ? ` (${j.mail.channel})` : "";
      setNotice(`User added and invitation email sent${channel}.${linkedText}`);
    } else {
      setErr(
        `User added, but invitation email failed: ${j?.mail?.detail || j?.mail?.reason || "unknown reason"}.${linkedText}`
      );
    }
    setModal(false);
    setForm({
      clerkUserId: "",
      email: "",
      firstName: "",
      lastName: "",
      role: "staff",
      password: "",
      confirmPassword: "",
    });
    setSendWelcomeEmail(true);
    load();
  }

  async function patchRole(id, role) {
    if (!SHOW_PLATFORM_USERS) return;
    await apiFetch(`/admin/platform-users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    load();
  }

  async function deactivate(id) {
    if (!SHOW_PLATFORM_USERS) return;
    if (!confirm("Deactivate this platform user?")) return;
    await apiFetch(`/admin/platform-users/${id}`, { method: "DELETE" });
    load();
  }

  if (!SHOW_PLATFORM_USERS) return null;

  return (
    <div>
      {notice ? (
        <div className={styles.toast} style={{ marginBottom: 16, border: "1px solid #bbf7d0", color: "#166534" }}>
          <i className="fas fa-circle-check" /> {notice}
        </div>
      ) : null}
      {err ? (
        <div className={styles.toast} style={{ marginBottom: 16, border: "1px solid #fecaca", color: "#b91c1c" }}>
          <i className="fas fa-exclamation-circle" /> {err}
        </div>
      ) : null}

      <div className={styles.pageHeader} style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 className={styles.pageTitle}>Platform team</h2>
          <p className={styles.pageSubtitle}>
            Internal operators for the control center (no customer tenant). For <strong>customer company employees</strong>, use{" "}
            <Link href="/admin/users" className={styles.rowLink}>
              Users &amp; roles → Add company employee
            </Link>{" "}
            or a tenant&apos;s Users section — not here.
          </p>
        </div>
        <button type="button" className={styles.pageBtn} onClick={() => setModal(true)}>
          Add Platform User
        </button>
      </div>

      {loading ? (
        <div className={styles.pageSubtitle}>
          <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow, #F5C400)" }} /> Loading…
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.first_name || ""} {u.last_name || ""}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className={styles.roleSelect}
                      value={u.role}
                      onChange={(e) => patchRole(u.id, e.target.value)}
                    >
                      <option value="admin">admin</option>
                      <option value="manager">manager</option>
                      <option value="staff">staff</option>
                    </select>
                  </td>
                  <td>
                    <span className={Number(u.is_active) ? styles.statusOn : styles.statusOff}>
                      {Number(u.is_active) ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleString() : "—"}</td>
                  <td>
                    <button type="button" className={styles.pageBtn} onClick={() => deactivate(u.id)}>
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.tableWrap} style={{ maxWidth: 480, width: "100%", padding: 20, background: "var(--card-bg, #fff)" }}>
            <h3 className={styles.pageTitle} style={{ marginTop: 0 }}>
              Add platform user
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                className={styles.searchInput}
                placeholder="Clerk User ID"
                value={form.clerkUserId}
                onChange={(e) => setForm((f) => ({ ...f, clerkUserId: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="First name"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                type="password"
                placeholder={
                  sendWelcomeEmail
                    ? "Password (optional - not used if invitation is on)"
                    : "Temporary password (optional, min 8 chars)"
                }
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                type="password"
                placeholder={sendWelcomeEmail ? "Confirm (optional)" : "Confirm temporary password"}
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Last name"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
              <select
                className={styles.roleSelect}
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="staff">staff</option>
              </select>
              <label className={styles.pageSubtitle} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                />
                Send invitation email
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => setModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={submitAdd}
                disabled={
                  (!form.email.trim() && !form.clerkUserId.trim()) ||
                  ((form.password || form.confirmPassword) && form.password !== form.confirmPassword)
                }
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
