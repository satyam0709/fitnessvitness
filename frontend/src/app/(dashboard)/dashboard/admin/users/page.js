"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getApiBase } from "@/lib/api";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";
import styles from "@/app/admin/users/page.module.css";

export default function TenantAdminUsersPage() {
  useAuth();
  const { me } = useUserRole();
  const myId = me?.id;
  const [rows, setRows] = useState([]);
  const [seats, setSeats] = useState({ used: 0, max: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(false);
  const [tempPasswordNotice, setTempPasswordNotice] = useState("");
  const [form, setForm] = useState({
    email: "",
    mobile: "",
    firstName: "",
    lastName: "",
    role: "staff",
    password: "",
    confirmPassword: "",
  });
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [emailCheck, setEmailCheck] = useState({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/tenant-admin/users`, { credentials: "include", 
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setErr(data.message || "Could not load users");
        setRows([]);
        return;
      }
      setRows(data.data || []);
      const s = data.seats || {};
      const max = s.max ?? s.total ?? 0;
      setSeats({ used: s.used ?? 0, max, total: s.total ?? max });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribeWorkspaceAccess(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    const email = form.email.trim().toLowerCase();
    if (!email) {
      setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral" });
      return undefined;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck({ checking: false, ok: false, message: "Enter a valid email address.", tone: "neutral" });
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setEmailCheck((prev) => ({ ...prev, checking: true, message: "", tone: "neutral" }));
      try {
        const res = await fetch(
          `${getApiBase()}/tenant-admin/users/check-email?email=${encodeURIComponent(email)}`,
          {
            headers: { "Content-Type": "application/json" },
          }
        );
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && j.available === true) {
          const tone = j.reason === "pending_retry" ? "warning" : "success";
          setEmailCheck({
            checking: false,
            ok: true,
            message: j.message || "Email is available — you can add this user.",
            tone,
            clerkAccountExists: Boolean(j.clerkAccountExists),
            reason: j.reason || "ok",
          });
          return;
        }
        setEmailCheck({
          checking: false,
          ok: false,
          message: j.message || "This email cannot be added right now.",
          tone: "neutral",
          clerkAccountExists: false,
          reason: "",
        });
      } catch {
        if (!cancelled) {
          setEmailCheck({
            checking: false,
            ok: false,
            message: "Could not verify email right now.",
            tone: "neutral",
          });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.email]);

  const maxSeats = seats.max || seats.total;
  const pct = maxSeats > 0 ? Math.min(100, Math.round((seats.used / maxSeats) * 100)) : 0;
  const barColor = pct >= 100 ? "#dc2626" : pct >= 80 ? "#ca8a04" : "#15803d";
  const atSeatRoleLimit = maxSeats > 0 && seats.used >= maxSeats;
  const blockAddBySeatRole =
    atSeatRoleLimit && (form.role === "staff" || form.role === "manager");
  async function patchRole(uid, role) {
    if (uid === myId) return;
    await fetch(`${getApiBase()}/tenant-admin/users/${uid}/role`, { credentials: "include", 
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    load();
  }

  async function toggleActive(uid) {
    if (uid === myId) return;
    await fetch(`${getApiBase()}/tenant-admin/users/${uid}/active`, { credentials: "include", 
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    load();
  }

  async function removeUser(uid) {
    if (uid === myId) return;
    if (!confirm("Remove this user from your workspace?")) return;
    await fetch(`${getApiBase()}/tenant-admin/users/${uid}`, { credentials: "include", 
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    load();
  }

  async function resetPassword(uid) {
    if (uid === myId) return;
    if (!confirm("Send password-reset guidance email to this user?")) return;
    const res = await fetch(`${getApiBase()}/tenant-admin/users/${uid}/reset-password`, { credentials: "include", 
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.message || "Password reset failed");
      return;
    }
    setTempPasswordNotice(j.message || "Password reset email sent.");
    setTimeout(() => setTempPasswordNotice(""), 12000);
    load();
  }

  async function resendInvite(uid) {
    const row = rows.find((r) => Number(r.id) === Number(uid));
    if (!row) {
      setErr("User row not found for resend.");
      return;
    }
    const res = await fetch(`${getApiBase()}/tenant-admin/users/${uid}/resend-invite`, { credentials: "include", 
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    let j = await res.json().catch(() => ({}));
    if (res.ok && j?.success) {
      if (j?.mail?.ok) {
        const channel = j?.mail?.channel ? ` (${j.mail.channel})` : "";
        setTempPasswordNotice(`Invitation email re-sent${channel}.`);
      } else {
        setErr(`Invite action completed, but email may have failed: ${j?.mail?.detail || j?.mail?.reason || "unknown reason"}`);
      }
      setTimeout(() => setTempPasswordNotice(""), 10000);
      load();
      return;
    }

    setErr(j?.message || "Could not resend invitation email.");
  }

  async function addUser() {
    if (submitting) return;
    setErr(null);
    setTempPasswordNotice("");
    if (!form.firstName.trim()) {
      setErr("Display name (first name) is required.");
      return;
    }
    if (!form.mobile.trim()) {
      setErr("Mobile number is required.");
      return;
    }
    if (!form.password || form.password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setErr("Password and confirm password do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBase()}/tenant-admin/users`, { credentials: "include", 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          mobile: form.mobile.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          password: form.password,
          sendWelcomeEmail,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          const code = String(j?.code || "");
          if (code === "OTHER_WORKSPACE") {
            setErr("This email is already assigned to another workspace. Use a different email.");
            return;
          }
          if (code === "CLERK_USER_CONFLICT") {
            setErr(j.message || "Could not create user account. Please try again.");
            return;
          }
          if (code === "PASSWORD_UPDATE_CONFLICT") {
            setErr("User found, but temporary password could not be set. Try a stronger password and retry.");
            return;
          }
        }
        if (res.status === 503 && String(j?.code || "") === "CLERK_SIGNUP_DISABLED") {
          setErr(
            "Clerk email sign-up is disabled for this environment. Enable Email sign-up in Clerk or add by Clerk User ID."
          );
          return;
        }
        if (res.status === 422 && String(j?.code || "") === "CLERK_MISSING_FIELDS") {
          setErr(j.message || "Clerk requires additional fields (e.g. mobile number) to create this user. Please fill in the mobile number and try again.");
          return;
        }
        setErr(j.message || "Add user failed");
        return;
      }
      const loginHint = " They can sign in with email + the password you set (first login may require a password change).";
      if (sendWelcomeEmail && j?.mail?.ok) {
        const channel = j?.mail?.channel ? ` (${j.mail.channel})` : "";
        setTempPasswordNotice(`Saved in your company workspace. Invitation email sent${channel}.${loginHint}`);
      } else if (sendWelcomeEmail && !j?.mail?.ok) {
        setTempPasswordNotice(
          `Saved in your company workspace; invitation email failed (${j?.mail?.detail || j?.mail?.reason || "unknown"}).${loginHint}`
        );
      } else {
        setTempPasswordNotice(`Saved in your company workspace (no invitation email).${loginHint}`);
      }
      setModal(false);
      setForm({
        email: "",
        mobile: "",
        firstName: "",
        lastName: "",
        role: "staff",
        password: "",
        confirmPassword: "",
      });
      setSendWelcomeEmail(true);
      setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });
      load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHeader} style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className={styles.pageTitle}>Users</h2>
          <p className={styles.pageSubtitle}>
            People in <strong>your company only</strong> — not the RND platform team. New staff/manager seats are enforced by your
            subscription package via the API; this list refreshes live when access changes.
          </p>
          <p className={styles.pageSubtitle} style={{ marginTop: 6 }}>
            {seats.used} of {maxSeats || "—"} staff/manager seats used (admins do not consume this count)
          </p>
          <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, maxWidth: 360, marginTop: 8 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 4 }} />
          </div>
        </div>
        <button type="button" className={styles.pageBtn} onClick={() => setModal(true)}>
          Add User
        </button>
      </div>

      {atSeatRoleLimit ? (
        <p className={styles.pageSubtitle} style={{ color: "#b91c1c" }}>
          Staff/manager seat limit reached for your plan. You can still add a workspace <strong>admin</strong> from Add User, or{" "}
          <Link href="/contact" className={styles.rowLink}>
            contact support to upgrade
          </Link>
          .
        </p>
      ) : null}

      {err ? <p style={{ color: "#b91c1c" }}>{err}</p> : null}
      {tempPasswordNotice ? <p style={{ color: "#065f46", fontWeight: 600 }}>{tempPasswordNotice}</p> : null}
      {loading ? (
        <p className={styles.pageSubtitle}>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = myId && u.id === myId;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.first_name} {u.last_name}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.mobile_number || "—"}</td>
                    <td>
                      <select
                        className={styles.roleSelect}
                        value={u.role}
                        disabled={self}
                        onChange={(e) => patchRole(u.id, e.target.value)}
                      >
                        <option value="admin">admin</option>
                        <option value="manager">manager</option>
                        <option value="staff">staff</option>
                      </select>
                    </td>
                    <td>
                      {u.is_pending ? (
                        <span className={styles.statusOff} style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" }}>
                          Pending signup
                        </span>
                      ) : (
                        <span className={Number(u.is_active) ? styles.statusOn : styles.statusOff}>
                          {Number(u.is_active) ? "Active" : "Inactive"}
                        </span>
                      )}
                    </td>
                    <td>{u.last_login ? new Date(u.last_login).toLocaleString() : "—"}</td>
                    <td>
                      {u.is_pending ? (
                        <>
                          <button type="button" className={styles.pageBtn} onClick={() => resendInvite(u.id)}>
                            Resend invite
                          </button>{" "}
                          <button type="button" className={styles.pageBtn} onClick={() => removeUser(u.id)}>
                            Cancel invite
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={styles.pageBtn} disabled={self} onClick={() => toggleActive(u.id)}>
                            Toggle active
                          </button>{" "}
                          <button type="button" className={styles.pageBtn} disabled={self} onClick={() => resetPassword(u.id)}>
                            Reset password
                          </button>{" "}
                          <button type="button" className={styles.pageBtn} disabled={self} onClick={() => removeUser(u.id)}>
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
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
              Add company employee
            </h3>
            <p className={styles.pageSubtitle} style={{ marginTop: 4 }}>
              New users must use a <strong>unique email</strong> not already in CRM. Password is stored so they can log in with email +
              password; invitation email is optional.
            </p>
            {err ? (
              <p className={styles.pageSubtitle} style={{ margin: "0 0 10px", color: "#b91c1c" }}>
                {err}
              </p>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                className={styles.searchInput}
                placeholder="Email (required — sign-in)"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              {form.email.trim() ? (
                <p
                  className={styles.pageSubtitle}
                  style={{
                    margin: "2px 0 0",
                    color: emailCheck.ok
                      ? emailCheck.tone === "warning"
                        ? "#b45309"
                        : "#065f46"
                      : "#b91c1c",
                  }}
                >
                  {emailCheck.checking ? "Checking email..." : emailCheck.message}
                </p>
              ) : null}
              <input
                className={styles.searchInput}
                placeholder="Mobile (required)"
                value={form.mobile}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Display name / first name (required)"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Last name (optional)"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
              <select
                className={styles.roleSelect}
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="staff">staff</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
              <p className={styles.pageSubtitle} style={{ margin: 0, color: "#4b5563" }}>
                Password is <strong>required</strong> (min 8 characters) and is saved to the database so the employee can sign in
                immediately.
              </p>
              <input
                className={styles.searchInput}
                type="password"
                placeholder="Password (required, min 8)"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                type="password"
                placeholder="Confirm password (required)"
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              />
              <label className={styles.pageSubtitle} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                />
                Also send invitation email (optional)
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => {
                setModal(false);
                setErr(null);
                setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });
                setForm({ email: "", mobile: "", firstName: "", lastName: "", role: "staff", password: "", confirmPassword: "" });
                setSendWelcomeEmail(true);
              }}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => addUser()}
                disabled={
                  submitting ||
                  !form.email.trim() ||
                  !form.firstName.trim() ||
                  !form.mobile.trim() ||
                  !form.password ||
                  form.password.length < 8 ||
                  form.password !== form.confirmPassword ||
                  emailCheck.checking ||
                  !emailCheck.ok ||
                  blockAddBySeatRole
                }
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
