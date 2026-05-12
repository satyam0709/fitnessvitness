"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

function planBadgeClass(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("platinum")) return { bg: "#ede9fe", color: "#5b21b6" };
  if (n.includes("gold")) return { bg: "#fef9c3", color: "#a16207" };
  return { bg: "#e5e7eb", color: "#374151" };
}

function statusBadgeClass(st) {
  const s = String(st || "").toLowerCase();
  if (s === "trial") return { bg: "#fef9c3", color: "#a16207" };
  if (s === "active") return { bg: "#dcfce7", color: "#15803d" };
  if (s === "expired") return { bg: "#fee2e2", color: "#b91c1c" };
  return { bg: "#f3f4f6", color: "#6b7280" };
}

export default function AdminTenantsPage() {
  useAuth();
  const { refreshNonce, tenantActivationEvent, clearTenantActivationEvent, bumpRefresh } = useAdminRealtime();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [purgeBusyId, setPurgeBusyId] = useState(null);
  const [activationToast, setActivationToast] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    tenantName: "",
    ownerClerkUserId: "",
    ownerEmail: "",
    ownerFirstName: "",
    ownerLastName: "",
    packageName: "Silver",
  });

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await apiFetch("/admin/tenants");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setErr(data.message || "Could not load tenants");
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
    load();
  }, [load, refreshNonce]);

  useEffect(() => {
    if (!tenantActivationEvent) return;
    const billing = tenantActivationEvent.billing === "trial" ? "trial" : "paid";
    const company = tenantActivationEvent.company_name || "Workspace";
    const sub = tenantActivationEvent.subdomain ? String(tenantActivationEvent.subdomain) : "";
    const plan = tenantActivationEvent.plan ? String(tenantActivationEvent.plan) : "";
    setActivationToast({
      billing,
      text: `${billing === "trial" ? "New trial" : "New paid signup"}: ${company}${sub ? ` · ${sub}` : ""}${plan ? ` · ${plan}` : ""}`,
    });
    clearTenantActivationEvent();
    const t = setTimeout(() => setActivationToast(null), 10000);
    return () => clearTimeout(t);
  }, [tenantActivationEvent, clearTenantActivationEvent]);

  async function submitCreate() {
    const res = await apiFetch("/admin/tenants", {
      method: "POST",
      body: JSON.stringify({
        tenantName: form.tenantName.trim(),
        ownerClerkUserId: form.ownerClerkUserId.trim(),
        ownerEmail: form.ownerEmail.trim(),
        ownerFirstName: form.ownerFirstName.trim(),
        ownerLastName: form.ownerLastName.trim(),
        packageName: form.packageName,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.message || "Create failed");
      return;
    }
    setModal(false);
    setForm({
      tenantName: "",
      ownerClerkUserId: "",
      ownerEmail: "",
      ownerFirstName: "",
      ownerLastName: "",
      packageName: "Silver",
    });
    load();
  }

  async function deleteTenantWorkspace(tenantId, displayName) {
    const ok = window.confirm(
      `Permanently delete workspace "${displayName || tenantId}"?\n\n` +
        "This removes tenant + all linked workspace data (users, subscriptions/trial, " +
        "workspace URL/subdomain mapping, and related records). This cannot be undone."
    );
    if (!ok) return;
    setPurgeBusyId(tenantId);
    setErr(null);
    try {
      const res = await apiFetch(`/admin/tenants/${tenantId}/purge-workspace`, {
        method: "POST",
        body: JSON.stringify({ force: true, acknowledge: "DELETE_WORKSPACE" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.message || "Purge failed");
        return;
      }
      bumpRefresh();
      await load();
    } catch (e) {
      setErr(e.message || "Purge failed");
    } finally {
      setPurgeBusyId(null);
    }
  }

  return (
    <div>
      {activationToast ? (
        <div
          className={styles.toast}
          style={{
            position: "relative",
            marginBottom: 16,
            border: activationToast.billing === "trial" ? "1px solid #fde68a" : "1px solid #bbf7d0",
            background: activationToast.billing === "trial" ? "#fffbeb" : "#f0fdf4",
            color: activationToast.billing === "trial" ? "#92400e" : "#166534",
          }}
          role="status"
        >
          <i className="fas fa-bolt" style={{ marginRight: 8 }} />
          {activationToast.text}
          <button
            type="button"
            onClick={() => setActivationToast(null)}
            style={{
              marginLeft: 12,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 700,
              color: "inherit",
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {err ? (
        <div
          className={styles.toast}
          style={{
            position: "relative",
            marginBottom: 16,
            border: "1px solid #fecaca",
            color: "#b91c1c",
          }}
        >
          <i className="fas fa-exclamation-circle" /> {err}
        </div>
      ) : null}

      <div className={styles.pageHeader} style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className={styles.pageTitle}>Tenants</h2>
          <p className={styles.pageSubtitle}>
            Buying companies, plans, seat usage, and add-ons. Open a row to manage package status, features, trials, and deletion.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className={styles.pageBtn} onClick={() => setModal(true)}>
            Add Tenant
          </button>
        </div>
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
                <th>Company</th>
                <th>Owner email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Users</th>
                <th>Active add-ons</th>
                <th>Valid until</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const plan = r.plan || {};
                const pb = planBadgeClass(plan.package_name);
                const sb = statusBadgeClass(plan.status);
                const vu = plan.valid_until ? new Date(plan.valid_until) : null;
                const now = Date.now();
                const warn7 = vu && vu.getTime() - now < 7 * 86400000 && vu.getTime() > now;
                const past = vu && vu.getTime() < now;
                return (
                  <tr key={r.id}>
                    <td>
                      <Link className={styles.rowLink} href={`/admin/tenants/${r.id}`}>
                        {r.name || "—"}
                      </Link>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                        <span>{r.owner_email || (r.owner_missing ? "No owner record" : "—")}</span>
                        <button
                          type="button"
                          style={{
                            fontSize: "0.8rem",
                            padding: "4px 10px",
                            cursor: purgeBusyId === r.id ? "wait" : "pointer",
                            background: "#fef2f2",
                            color: "#991b1b",
                            borderColor: "#fecaca",
                          }}
                          className={styles.rowLink}
                          disabled={purgeBusyId === r.id}
                          onClick={() => deleteTenantWorkspace(r.id, r.name)}
                        >
                          {purgeBusyId === r.id ? "Deleting…" : "Delete tenant"}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        style={{ background: pb.bg, color: pb.color, fontWeight: 600 }}
                      >
                        {plan.package_name || "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        style={{ background: sb.bg, color: sb.color, fontWeight: 600 }}
                      >
                        {plan.status || "—"}
                      </span>
                    </td>
                    <td>
                      {r.user_count} / {plan.max_users ?? "—"}
                    </td>
                    <td>{r.addon_count ?? 0}</td>
                    <td style={{ color: past ? "#b91c1c" : warn7 ? "#a16207" : undefined }}>
                      {vu ? vu.toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <Link className={styles.rowLink} href={`/admin/tenants/${r.id}`}>
                        View
                      </Link>
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
          <div className={styles.tableWrap} style={{ maxWidth: 520, width: "100%", padding: 20, background: "var(--card-bg, #fff)" }}>
            <h3 className={styles.pageTitle} style={{ marginTop: 0 }}>
              Add tenant
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                className={styles.searchInput}
                placeholder="Company name"
                value={form.tenantName}
                onChange={(e) => setForm((f) => ({ ...f, tenantName: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Owner Clerk User ID"
                value={form.ownerClerkUserId}
                onChange={(e) => setForm((f) => ({ ...f, ownerClerkUserId: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Owner email"
                value={form.ownerEmail}
                onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Owner first name"
                value={form.ownerFirstName}
                onChange={(e) => setForm((f) => ({ ...f, ownerFirstName: e.target.value }))}
              />
              <input
                className={styles.searchInput}
                placeholder="Owner last name"
                value={form.ownerLastName}
                onChange={(e) => setForm((f) => ({ ...f, ownerLastName: e.target.value }))}
              />
              <select
                className={styles.roleSelect}
                value={form.packageName}
                onChange={(e) => setForm((f) => ({ ...f, packageName: e.target.value }))}
              >
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => setModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.pageBtn}
                onClick={submitCreate}
                disabled={!form.tenantName.trim() || !form.ownerClerkUserId.trim()}
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
