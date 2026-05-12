"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

export default function AdminWorkspaceAdminsPage() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await apiFetch("/admin/tenant-admins");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setErr(data.message || "Could not load tenant admins");
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

  return (
    <div>
      {err ? (
        <div className={styles.toast} style={{ marginBottom: 16, border: "1px solid #fecaca", color: "#b91c1c" }}>
          <i className="fas fa-exclamation-circle" /> {err}
        </div>
      ) : null}

      <div className={styles.pageHeader} style={{ alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className={styles.pageTitle}>Workspace admins</h2>
          <p className={styles.pageSubtitle}>
            Buyers promoted after payment (same users as each tenant’s member list). Updates live when subscriptions or
            tenants change.
          </p>
        </div>
      </div>

      {loading ? (
        <p className={styles.pageSubtitle}>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Admin</th>
                <th>Workspace</th>
                <th>Days left</th>
                <th>Status</th>
                <th>Tenant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.tenant_id}-${r.user_id}`}>
                  <td>
                    <div>
                      {r.first_name || r.last_name
                        ? `${r.first_name || ""} ${r.last_name || ""}`.trim()
                        : "—"}
                    </div>
                    <div className={styles.pageSubtitle} style={{ margin: 0 }}>
                      {r.email}
                    </div>
                    <Link href={`/admin/users/${r.user_id}`} className={styles.rowLink}>
                      User profile →
                    </Link>
                  </td>
                  <td>{r.tenant_name || "—"}</td>
                  <td>{r.days_left != null ? r.days_left : "—"}</td>
                  <td>{r.subscription_status || r.tenant_status || "—"}</td>
                  <td>
                    <Link href={`/admin/tenants/${r.tenant_id}`} className={styles.rowLink}>
                      Open tenant →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className={styles.pageSubtitle}>No workspace admins yet.</p> : null}
        </div>
      )}
    </div>
  );
}
