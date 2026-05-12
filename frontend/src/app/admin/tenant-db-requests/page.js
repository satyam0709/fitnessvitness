"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

export default function AdminTenantDbRequestsPage() {
  useAuth();
  const { refreshNonce, bumpRefresh } = useAdminRealtime();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState("pending");

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await apiFetch(`/admin/tenant-db/requests${q}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setErr(j.message || j.error || "Load failed");
        setRows([]);
        return;
      }
      setRows(Array.isArray(j.data) ? j.data : []);
    } catch (e) {
      setErr(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  async function approve(id) {
    setBusyId(id);
    setErr(null);
    try {
      const res = await apiFetch(`/admin/tenant-db/requests/${id}/approve`, {
        method: "POST",
        body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setErr(j.message || j.error || "Approve failed");
        return;
      }
      bumpRefresh();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id) {
    const reason = window.prompt("Reject reason (optional):", "") ?? "";
    setBusyId(id);
    setErr(null);
    try {
      const res = await apiFetch(`/admin/tenant-db/requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || "Rejected by admin" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setErr(j.message || j.error || "Reject failed");
        return;
      }
      bumpRefresh();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <Link href="/admin/tenants" className={styles.rowLink} style={{ display: "inline-block", marginBottom: 8 }}>
            ← Tenants
          </Link>
          <h2 className={styles.pageTitle}>Tenant database requests</h2>
          <p className={styles.pageSubtitle}>Approve after connection test passes, or reject with a reason.</p>
        </div>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className={styles.pageSubtitle}>
          Status
          <select className={styles.roleSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </label>
        <button type="button" className={styles.pageBtn} onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {err ? <p style={{ color: "#b91c1c", marginBottom: 12 }}>{err}</p> : null}

      {loading ? (
        <p className={styles.pageSubtitle}>
          <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow, #F5C400)" }} /> Loading…
        </p>
      ) : (
        <div className={styles.tableWrap} style={{ padding: 0, overflow: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Tenant</th>
                <th>Host</th>
                <th>DB</th>
                <th>User</th>
                <th>Status</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.pageSubtitle}>
                    No rows.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>
                      <Link href={`/admin/tenants/${r.tenant_id}`} className={styles.rowLink}>
                        {r.company_name || r.subdomain || r.tenant_id}
                      </Link>
                    </td>
                    <td>
                      {r.db_host}:{r.db_port}
                    </td>
                    <td>{r.db_name}</td>
                    <td>{r.db_user}</td>
                    <td>
                      <span className={styles.roleBadge}>{r.status}</span>
                    </td>
                    <td className={styles.pageSubtitle} style={{ maxWidth: 220, fontSize: "0.85rem" }}>
                      {r.reject_reason || r.test_result || "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className={styles.pageBtn}
                            disabled={busyId != null}
                            onClick={() => approve(r.id)}
                          >
                            {busyId === r.id ? "…" : "Approve"}
                          </button>{" "}
                          <button
                            type="button"
                            className={styles.pageBtn}
                            disabled={busyId != null}
                            onClick={() => reject(r.id)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
