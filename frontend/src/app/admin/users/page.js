"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "./page.module.css";

const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  const { user } = useAuth();
  const { refreshNonce, bumpRefresh } = useAdminRealtime();
  const firstLoad = useRef(true);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [debounced, setDebounced] = useState("");

  const [addModal, setAddModal] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [addNotice, setAddNotice] = useState("");
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [addForm, setAddForm] = useState({
    email: "",
    mobile: "",
    firstName: "",
    lastName: "",
    role: "staff",
    password: "",
    confirmPassword: "",
  });
  const [emailCheck, setEmailCheck] = useState({
    checking: false,
    ok: false,
    message: "",
    tone: "neutral",
    clerkAccountExists: false,
    reason: "",
  });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, role]);

  const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));

  const fetchUsers = useCallback(async () => {
    if (firstLoad.current) {
      setLoading(true);
      firstLoad.current = false;
    }
    setListError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (debounced) params.set("search", debounced);
      if (role) params.set("role", role);
      const res = await apiFetch(`/admin/users?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setListError(data.message || res.statusText || "Could not load users");
        setUsers([]);
        setTotal(0);
        return;
      }
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) {
      setListError(e.message || "Network error");
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debounced, role, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers, refreshNonce]);

  useEffect(() => {
    if (!addModal) return undefined;
    const email = addForm.email.trim().toLowerCase();
    if (!email) {
      setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });
      return undefined;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck({
        checking: false,
        ok: false,
        message: "Enter a valid email address.",
        tone: "neutral",
        clerkAccountExists: false,
        reason: "",
      });
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setEmailCheck((prev) => ({ ...prev, checking: true, message: "", tone: "neutral" }));
      try {
        const res = await apiFetch(`/admin/workspace/users/check-email?email=${encodeURIComponent(email)}`);
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
            clerkAccountExists: false,
            reason: "",
          });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addModal, addForm.email]);

  async function submitAddUserToWorkspace() {
    if (addSubmitting) return;
    setAddErr(null);
    setAddNotice("");
    if (!addForm.firstName.trim()) {
      setAddErr("Display name (first name) is required.");
      return;
    }
    if (!addForm.mobile.trim()) {
      setAddErr("Mobile number is required.");
      return;
    }
    if (!addForm.password || addForm.password.length < 8) {
      setAddErr("Password must be at least 8 characters.");
      return;
    }
    if (addForm.password !== addForm.confirmPassword) {
      setAddErr("Password and confirm password do not match.");
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await apiFetch("/admin/workspace/users", {
        method: "POST",
        body: JSON.stringify({
          email: addForm.email.trim(),
          mobile: addForm.mobile.trim(),
          firstName: addForm.firstName.trim(),
          lastName: addForm.lastName.trim(),
          role: addForm.role,
          password: addForm.password,
          sendWelcomeEmail,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddErr(j.message || "Add user failed");
        return;
      }
      const loginHint = " They can sign in now with email + this password (they may be asked to change password on first login).";
      if (sendWelcomeEmail && j?.mail?.ok) {
        const ch = j?.mail?.channel ? ` (${j.mail.channel})` : "";
        setAddNotice(`User saved in the database. Invitation email sent${ch}.${loginHint}`);
      } else if (sendWelcomeEmail && !j?.mail?.ok) {
        setAddNotice(`User saved in the database, but invitation email failed (${j?.mail?.detail || j?.mail?.reason || "unknown"}).${loginHint}`);
      } else {
        setAddNotice(`User saved in the database (no invitation email).${loginHint}`);
      }
      setAddModal(false);
      setAddForm({
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
      bumpRefresh();
      fetchUsers();
    } catch (e) {
      setAddErr(e.message || "Network error");
    } finally {
      setAddSubmitting(false);
    }
  }

  return (
    <div>
      {listError ? (
        <div className={styles.toast} style={{ position: "relative", bottom: "auto", right: "auto", marginBottom: 16, border: "1px solid #fecaca", color: "#b91c1c" }}>
          <i className="fas fa-exclamation-circle" /> {listError}
        </div>
      ) : null}
      <div className={styles.pageHeader} style={{ alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className={styles.pageTitle}>Users</h2>
          <p className={styles.pageSubtitle}>
            {total} user(s) in your workspace — search, filter, <strong>Manage</strong> for trials and roles. List updates
            live when admins change data.
          </p>
        </div>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => {
            setAddErr(null);
            setAddNotice("");
            setAddModal(true);
          }}
        >
          Add company employee
        </button>
      </div>

      {addNotice ? (
        <div className={styles.toast} style={{ marginBottom: 16, border: "1px solid #bbf7d0", color: "#166534" }}>
          <i className="fas fa-circle-check" /> {addNotice}
        </div>
      ) : null}

      {addModal ? (
        <div className={styles.addUserOverlay} role="dialog" aria-modal="true" aria-labelledby="admin-add-user-title">
          <div className={styles.addUserModal}>
            <div className={styles.addUserHeader}>
              <h3 id="admin-add-user-title" className={styles.addUserHeaderTitle}>
                Add Company Employee
              </h3>
              <button
                type="button"
                className={styles.addUserClose}
                onClick={() => {
                  setAddModal(false);
                  setAddErr(null);
                  setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });
                  setAddForm({
                    email: "",
                    mobile: "",
                    firstName: "",
                    lastName: "",
                    role: "staff",
                    password: "",
                    confirmPassword: "",
                  });
                  setSendWelcomeEmail(true);
                }}
                aria-label="Close"
              >
                <i className="fas fa-times" />
              </button>
            </div>

            <form className={styles.addUserForm} onSubmit={(e) => e.preventDefault()}>
            <div className={styles.addUserBody}>
              <div className={styles.addUserScope}>
                <span className={styles.addUserScopeLabel}>Workspace</span>
                <strong>{user?.tenant_name || user?.company_name || "Your workspace"}</strong>
              </div>

              {addErr ? <p className={styles.errorText}>{addErr}</p> : null}

              <div className={styles.addUserFieldGrid3}>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Email <span className={styles.addUserReq}>*</span></label>
                  <input
                    className={styles.addUserInput}
                    placeholder="Enter email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Mobile <span className={styles.addUserReq}>*</span></label>
                  <input
                    className={styles.addUserInput}
                    placeholder="Enter mobile number"
                    value={addForm.mobile}
                    onChange={(e) => setAddForm((f) => ({ ...f, mobile: e.target.value }))}
                  />
                </div>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Role <span className={styles.addUserReq}>*</span></label>
                  <select
                    className={styles.addUserSelect}
                    value={addForm.role}
                    onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                  >
                    <option value="staff">staff</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              </div>

              {addForm.email.trim() ? (
                <p
                  className={styles.addUserEmailStatus}
                  style={{
                    color: emailCheck.ok ? (emailCheck.tone === "warning" ? "#b45309" : "#065f46") : "#b91c1c",
                  }}
                >
                  {emailCheck.checking ? "Checking email..." : emailCheck.message}
                </p>
              ) : null}

              <div className={styles.addUserFieldGrid2}>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>First name / Display name <span className={styles.addUserReq}>*</span></label>
                  <input
                    className={styles.addUserInput}
                    placeholder="Enter first name"
                    value={addForm.firstName}
                    onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                </div>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Last name</label>
                  <input
                    className={styles.addUserInput}
                    placeholder="Enter last name (optional)"
                    value={addForm.lastName}
                    onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
              </div>
              <p className={styles.addUserNote}>Password is required for direct login and stored securely.</p>

              <div className={styles.addUserFieldGrid2}>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Password <span className={styles.addUserReq}>*</span></label>
                  <input
                    className={styles.addUserInput}
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={addForm.password}
                    onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <div className={styles.addUserField}>
                  <label className={styles.addUserLabel}>Confirm password <span className={styles.addUserReq}>*</span></label>
                  <input
                    className={styles.addUserInput}
                    type="password"
                    placeholder="Re-enter password"
                    value={addForm.confirmPassword}
                    onChange={(e) => setAddForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  />
                </div>
              </div>

              <label className={styles.addUserInviteRow}>
                <input type="checkbox" checked={sendWelcomeEmail} onChange={(e) => setSendWelcomeEmail(e.target.checked)} />
                Also send invitation email (optional)
              </label>
            </div>

            <div className={styles.addUserFooter}>
              <button
                type="button"
                className={styles.addUserCancelBtn}
                onClick={() => {
                  setAddModal(false);
                  setAddErr(null);
                  setEmailCheck({ checking: false, ok: false, message: "", tone: "neutral", clerkAccountExists: false, reason: "" });
                  setAddForm({
                    email: "",
                    mobile: "",
                    firstName: "",
                    lastName: "",
                    role: "staff",
                    password: "",
                    confirmPassword: "",
                  });
                  setSendWelcomeEmail(true);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.addUserSubmitBtn}
                onClick={() => submitAddUserToWorkspace()}
                disabled={
                  addSubmitting ||
                  !addForm.email.trim() ||
                  !addForm.firstName.trim() ||
                  !addForm.mobile.trim() ||
                  !addForm.password ||
                  addForm.password.length < 8 ||
                  addForm.password !== addForm.confirmPassword ||
                  emailCheck.checking ||
                  !emailCheck.ok
                }
              >
                {addSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
            </form>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <div className={styles.searchBox}>
          <i className="fas fa-search" style={{ color: "var(--text-muted)", fontSize: 13 }} />
          <input
            className={styles.searchInput}
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
        <select
          className={styles.roleSelect}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loadingInline}>
            <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow)" }} />
            Loading…
          </div>
        ) : users.length === 0 ? (
          <p className={styles.tableEmpty}>No users match.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Subscription</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userCell}>
                      <div className={styles.tableAvatar}>
                        {(u.first_name || u.email || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={styles.tableName}>
                          {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                        </div>
                        <div className={styles.tableEmail}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={styles.rolePill}>{u.role}</span>
                  </td>
                  <td>
                    <span className={styles.subMuted}>{u.package_name || "—"}</span>
                    {u.subscription_status && (
                      <span className={styles.subBadge}>{u.subscription_status}</span>
                    )}
                  </td>
                  <td>
                    <span className={Number(u.is_active) ? styles.statusOn : styles.statusOff}>
                      {Number(u.is_active) ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/admin/users/${u.id}`} className={styles.rowLink}>
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !listError && total > PAGE_SIZE ? (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className={styles.dateText} style={{ alignSelf: "center" }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
