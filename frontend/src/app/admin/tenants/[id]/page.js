"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../../AdminRealtimeProvider";
import styles from "../../users/page.module.css";

const INTEGRATION_ADDON_KEYS = [
  "facebook",
  "website_lead",
  "indiamart",
  "99acres",
  "google_ads",
  "housing",
  "just_dial",
  "magicbricks",
  "software_suggest",
  "tradeindia",
  "wordpress",
  "google_form",
  "systeme_io",
  "referral",
];

const FEATURE_LABELS = {
  lead_management: "Lead Management",
  tasks: "Tasks",
  contacts: "Contacts",
  meetings: "Meetings",
  reminders: "Reminders",
  integrations: "Integrations",
  opportunities: "Opportunities",
  tickets: "Tickets",
  companies: "Companies",
  analytics: "Analytics",
};

export default function AdminTenantDetailPage() {
  const { id } = useParams();
  useAuth();
  const { refreshNonce, bumpRefresh } = useAdminRealtime();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [nameEdit, setNameEdit] = useState("");
  const [slugEdit, setSlugEdit] = useState("");
  const [pkgStatus, setPkgStatus] = useState("trial");
  const [upgradePkg, setUpgradePkg] = useState("Silver");
  const [dbStatus, setDbStatus] = useState(null);
  const [dbForm, setDbForm] = useState({
    db_host: "",
    db_port: 3306,
    db_name: "",
    db_user: "",
    db_password: "",
  });
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState(null);


  const load = useCallback(async () => {
    if (!id) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/tenants/${id}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setErr(j.message || "Load failed");
        setData(null);
        return;
      }
      setData(j.data);
      const t = j.data?.tenant;
      setNameEdit(t?.name || "");
      setSlugEdit(t?.slug || "");
      setPkgStatus(j.data?.package?.status || "trial");
      setUpgradePkg(j.data?.package?.package_name || "Silver");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadDbStatus = useCallback(async () => {
    if (!id) return;
    setDbMsg(null);
    try {
      const res = await apiFetch(`/admin/tenants/${id}/database`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setDbStatus(null);
        setDbMsg(j.message || "Could not load database status");
        return;
      }
      setDbStatus(j.data);
    } catch (e) {
      setDbStatus(null);
      setDbMsg(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  useEffect(() => {
    if (!id || !data?.tenant) return;
    loadDbStatus();
  }, [id, data?.tenant, refreshNonce, loadDbStatus]);

  function authFetch(path, opts = {}) {
    return apiFetch(path, opts);
  }

  const addonRows = useMemo(() => {
    const list = data?.addons || [];
    const map = new Map(list.map((a) => [a.addon_key, a]));
    return INTEGRATION_ADDON_KEYS.map((k) => map.get(k) || { addon_key: k, is_active: false, valid_until: null });
  }, [data]);

  const seatConsumersUsed = useMemo(() => {
    const users = data?.users || [];
    return users.filter((u) => ["staff", "manager"].includes(String(u.role || "")) && Number(u.is_active)).length;
  }, [data?.users]);


  async function saveProfile() {
    await authFetch(`/admin/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nameEdit.trim(), slug: slugEdit.trim() || null }),
    });
    bumpRefresh();
    load();
  }

  async function savePackageStatus() {
    await authFetch(`/admin/tenants/${id}/package`, {
      method: "PATCH",
      body: JSON.stringify({ status: pkgStatus }),
    });
    bumpRefresh();
    load();
  }

  async function upgradePackage() {
    await authFetch(`/admin/tenants/${id}/package`, {
      method: "PATCH",
      body: JSON.stringify({ package_name: upgradePkg }),
    });
    bumpRefresh();
    load();
  }

  async function grantTrial() {
    await authFetch(`/admin/tenants/${id}/grant-trial`, { method: "POST", body: JSON.stringify({ days: 30 }) });
    bumpRefresh();
    load();
  }

  async function toggleTenantActive(v) {
    await authFetch(`/admin/tenants/${id}/active`, { method: "PATCH", body: JSON.stringify({ is_active: v }) });
    bumpRefresh();
    load();
  }

  async function testTenantDatabase() {
    setDbBusy(true);
    setDbMsg(null);
    try {
      const res = await authFetch(`/admin/tenants/${id}/database/test`, {
        method: "POST",
        body: JSON.stringify(dbForm),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setDbMsg(j.message || j.error || "Test failed");
        return;
      }
      setDbMsg(j.ok ? `Connection OK (${j.latencyMs ?? "?"} ms)` : j.error || "Connection failed");
    } catch (e) {
      setDbMsg(e.message);
    } finally {
      setDbBusy(false);
    }
  }

  async function activateTenantDatabase() {
    setDbBusy(true);
    setDbMsg(null);
    try {
      const res = await authFetch(`/admin/tenants/${id}/database/activate`, {
        method: "POST",
        body: JSON.stringify(dbForm),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setDbMsg(j.message || "Activate failed");
        return;
      }
      setDbMsg(j.message || "Database attached.");
      bumpRefresh();
      await loadDbStatus();
      load();
    } catch (e) {
      setDbMsg(e.message);
    } finally {
      setDbBusy(false);
    }
  }

  async function submitTenantDbRequestFromAdmin() {
    setDbBusy(true);
    setDbMsg(null);
    try {
      const res = await authFetch(`/admin/tenants/${id}/database/request`, {
        method: "POST",
        body: JSON.stringify(dbForm),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setDbMsg(j.message || "Request failed");
        return;
      }
      setDbMsg(j.message || "Request submitted.");
      bumpRefresh();
      await loadDbStatus();
    } catch (e) {
      setDbMsg(e.message);
    } finally {
      setDbBusy(false);
    }
  }

  async function setFeature(key, enabled) {
    await authFetch(`/admin/tenants/${id}/feature`, {
      method: "PATCH",
      body: JSON.stringify({ feature_key: key, is_enabled: enabled }),
    });
    bumpRefresh();
    load();
  }

  async function setAddon(key, active, valid_until) {
    await authFetch(`/admin/tenants/${id}/addon`, {
      method: "PATCH",
      body: JSON.stringify({ addon_key: key, is_active: active, valid_until: valid_until || null }),
    });
    bumpRefresh();
    load();
  }

  async function deleteTenantWorkspace() {
    const label = t?.name || t?.company_name || id;
    const ok = window.confirm(
      `Permanently delete tenant "${label}"?\n\n` +
        "This removes tenant + all linked workspace data (users, subscriptions/trial, workspace URL/subdomain mapping, and related records)."
    );
    if (!ok) return;
    const res = await authFetch(`/admin/tenants/${id}/purge-workspace`, {
      method: "POST",
      body: JSON.stringify({ force: true, acknowledge: "DELETE_WORKSPACE" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) {
      setErr(j.message || "Delete failed");
      return;
    }
    window.location.href = "/admin/tenants";
  }

  if (loading && !data) {
    return (
      <div className={styles.pageSubtitle}>
        <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow, #F5C400)" }} /> Loading tenant…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div>
        <p style={{ color: "#b91c1c" }}>{err || "Not found"}</p>
        <Link href="/admin/tenants" className={styles.rowLink}>
          Back to list
        </Link>
      </div>
    );
  }

  const t = data.tenant;
  const pkg = data.package;
  const st = data.stats || {};

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <Link href="/admin/tenants" className={styles.rowLink} style={{ display: "inline-block", marginBottom: 8 }}>
            ← Tenants
          </Link>
          <h2 className={styles.pageTitle}>{t.name || "Tenant"}</h2>
        </div>
      </div>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Company profile
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
          <label className={styles.pageSubtitle}>
            Name
            <input className={styles.searchInput} value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} />
          </label>
          <label className={styles.pageSubtitle}>
            Slug
            <input className={styles.searchInput} value={slugEdit} onChange={(e) => setSlugEdit(e.target.value)} />
          </label>
          <p className={styles.pageSubtitle}>Owner Clerk ID: {t.owner_clerk_user_id || "—"}</p>
          <p className={styles.pageSubtitle}>Created: {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</p>
          <label className={styles.pageSubtitle}>
            <input
              type="checkbox"
              checked={Number(t.is_active) === 1}
              onChange={(e) => toggleTenantActive(e.target.checked)}
            />{" "}
            Workspace active
          </label>
          <button type="button" className={styles.pageBtn} onClick={saveProfile}>
            Save profile
          </button>
        </div>
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Package
        </h3>
        {pkg ? (
          <>
            <p className={styles.pageSubtitle}>
              {pkg.package_name} · seats {pkg.max_users} · from {pkg.valid_from || "—"} → {pkg.valid_until || "—"}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <select className={styles.roleSelect} value={pkgStatus} onChange={(e) => setPkgStatus(e.target.value)}>
                <option value="trial">trial</option>
                <option value="active">active</option>
                <option value="expired">expired</option>
                <option value="cancelled">cancelled</option>
              </select>
              <button type="button" className={styles.pageBtn} onClick={savePackageStatus}>
                Save status
              </button>
              <button type="button" className={styles.pageBtn} onClick={grantTrial}>
                Grant 30-day trial
              </button>
              <select className={styles.roleSelect} value={upgradePkg} onChange={(e) => setUpgradePkg(e.target.value)}>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
              </select>
              <button type="button" className={styles.pageBtn} onClick={upgradePackage}>
                Upgrade package
              </button>
            </div>
          </>
        ) : (
          <p className={styles.pageSubtitle}>No tenant_packages row yet.</p>
        )}
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
          External tenant database (BYOD)
        </h3>
        <p className={styles.pageSubtitle} style={{ marginTop: 0 }}>
          Attach a dedicated MySQL database for this workspace, or queue credentials for review on{" "}
          <Link href="/admin/tenant-db-requests" className={styles.rowLink}>
            DB requests
          </Link>
          .
        </p>
        {dbStatus?.database ? (
          <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
            <strong>Current row:</strong> {dbStatus.database.provision_mode} · {dbStatus.database.status} ·{" "}
            {dbStatus.database.db_host}:{dbStatus.database.db_port}/{dbStatus.database.db_name}
            {Number(dbStatus.database.use_main_credentials) === 1 ? " · shared credentials" : ""}
          </div>
        ) : (
          <p className={styles.pageSubtitle}>No tenant_databases row yet (CRM may be using the platform default pool).</p>
        )}
        {dbStatus?.request ? (
          <p className={styles.pageSubtitle}>
            Latest request: #{dbStatus.request.id} — <strong>{dbStatus.request.status}</strong>
            {dbStatus.request.status === "rejected" && dbStatus.request.test_result
              ? ` (${dbStatus.request.test_result})`
              : ""}
          </p>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, maxWidth: 720 }}>
          <label className={styles.pageSubtitle}>
            Host
            <input
              className={styles.searchInput}
              value={dbForm.db_host}
              onChange={(e) => setDbForm((f) => ({ ...f, db_host: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className={styles.pageSubtitle}>
            Port
            <input
              className={styles.searchInput}
              type="number"
              value={dbForm.db_port}
              onChange={(e) => setDbForm((f) => ({ ...f, db_port: Number(e.target.value) || 3306 }))}
            />
          </label>
          <label className={styles.pageSubtitle}>
            Database name
            <input
              className={styles.searchInput}
              value={dbForm.db_name}
              onChange={(e) => setDbForm((f) => ({ ...f, db_name: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className={styles.pageSubtitle}>
            User
            <input
              className={styles.searchInput}
              value={dbForm.db_user}
              onChange={(e) => setDbForm((f) => ({ ...f, db_user: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className={styles.pageSubtitle} style={{ gridColumn: "1 / -1" }}>
            Password
            <input
              className={styles.searchInput}
              type="password"
              value={dbForm.db_password}
              onChange={(e) => setDbForm((f) => ({ ...f, db_password: e.target.value }))}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <button type="button" className={styles.pageBtn} disabled={dbBusy} onClick={testTenantDatabase}>
            Test connection
          </button>
          <button type="button" className={styles.pageBtn} disabled={dbBusy} onClick={activateTenantDatabase}>
            Activate (attach now)
          </button>
          <button type="button" className={styles.pageBtn} disabled={dbBusy} onClick={submitTenantDbRequestFromAdmin}>
            Submit for review
          </button>
        </div>
        {dbMsg ? (
          <p className={styles.pageSubtitle} style={{ marginTop: 10, color: dbMsg.includes("OK") ? "var(--success, #15803d)" : "#b45309" }}>
            {dbMsg}
          </p>
        ) : null}
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Features
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {(data.features || []).map((f) => (
            <label key={f.feature_key} className={styles.pageSubtitle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={Boolean(f.is_enabled)} onChange={(e) => setFeature(f.feature_key, e.target.checked)} />
              {FEATURE_LABELS[f.feature_key] || f.feature_key}
            </label>
          ))}
        </div>
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
          Add-ons
        </h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Active</th>
              <th>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {addonRows.map((a) => (
              <tr key={a.addon_key}>
                <td>{a.addon_key}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(a.is_active)}
                    onChange={(e) => setAddon(a.addon_key, e.target.checked, a.valid_until || null)}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className={styles.searchInput}
                    style={{ maxWidth: 160 }}
                    value={a.valid_until ? String(a.valid_until).slice(0, 10) : ""}
                    onChange={(e) => setAddon(a.addon_key, Boolean(a.is_active), e.target.value || null)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div>
            <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0 }}>
              Users
            </h3>
            <p className={styles.pageSubtitle} style={{ margin: "4px 0 0" }}>
              {data.stats?.user_count ?? (data.users || []).length} total · {seatConsumersUsed} staff/manager (package seats) · plan cap{" "}
              {pkg?.max_users != null ? pkg.max_users : "—"}
            </p>
            <p className={styles.pageSubtitle} style={{ margin: "6px 0 0", color: "#065f46", maxWidth: 520 }}>
              Cross-workspace add user is disabled. Super admins can add users only in their own workspace from the Users page.
            </p>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {(data.users || []).map((u) => (
              <tr key={u.id}>
                <td>
                  {u.first_name} {u.last_name}
                </td>
                <td>{u.email}</td>
                <td>
                  <span className={styles.roleBadge}>{u.role}</span>
                </td>
                <td>{Number(u.is_active) ? "Yes" : "No"}</td>
                <td>{u.last_login ? new Date(u.last_login).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Leads", value: st.leads_count },
          { label: "Tasks", value: st.tasks_count },
          { label: "Meetings", value: st.meetings_count },
        ].map((c) => (
          <div key={c.label} className={styles.tableWrap} style={{ padding: 16, minWidth: 140 }}>
            <p className={styles.pageSubtitle} style={{ margin: 0 }}>
              {c.label}
            </p>
            <p className={styles.pageTitle} style={{ margin: "8px 0 0", fontSize: "1.5rem" }}>
              {c.value ?? "—"}
            </p>
          </div>
        ))}
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16, border: "1px solid #fecaca" }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.1rem", marginTop: 0, color: "#991b1b" }}>
          Danger zone
        </h3>
        <p className={styles.pageSubtitle} style={{ marginTop: 0 }}>
          Delete this tenant and all linked workspace data permanently.
        </p>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={deleteTenantWorkspace}
          style={{ background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" }}
        >
          Delete tenant
        </button>
      </section>
    </div>
  );
}
