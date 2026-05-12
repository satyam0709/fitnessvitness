"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getApiBase } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "@/app/admin/users/page.module.css";

export default function TenantAdminIntegrationsPage() {
  useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {      const res = await fetch(`${getApiBase()}/tenant-admin/integrations`, { credentials: "include", 
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setErr(data.message || "Could not load integrations");
        setRows([]);
        return;
      }
      setRows(data.data || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(row, next) {
    const prev = rows.map((r) => ({ ...r }));
    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, is_active: next } : r)));
    try {      const res = await fetch(`${getApiBase()}/tenant-admin/integrations/${encodeURIComponent(row.key)}`, { credentials: "include", 
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRows(prev);
        showToast(j.message || "Update failed", "error");
        return;
      }
      showToast("Integration updated");
      load();
    } catch (e) {
      setRows(prev);
      showToast(e.message || "Network error", "error");
    }
  }

  return (
    <div>
      <h2 className={styles.pageTitle}>Integrations</h2>
      <p className={styles.pageSubtitle}>Enable channels included in your plan. Add-ons must be valid to toggle on.</p>
      {err ? <p style={{ color: "#b91c1c" }}>{err}</p> : null}
      {loading ? (
        <p className={styles.pageSubtitle}>Loading…</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {rows.map((r) => {
            const expired = r.valid_until && new Date(r.valid_until).getTime() < Date.now();
            const locked = !r.is_plan_enabled;
            const toggleDisabled = locked || expired;
            return (
              <div
                key={r.key}
                className={styles.tableWrap}
                style={{
                  padding: 16,
                  opacity: locked ? 0.65 : 1,
                  border: locked ? "1px dashed #9ca3af" : "1px solid var(--border, #e5e7eb)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: "#f3f4f6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                    }}
                  >
                    {(r.name || r.key || "?").slice(0, 1)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className={styles.tableName}>{r.name}</div>
                    <div className={styles.tableEmail}>{r.description}</div>
                    {locked ? (
                      <>
                        <span className={styles.statusOff} style={{ display: "inline-block", marginTop: 8 }}>
                          Not in your plan
                        </span>
                        <p className={styles.pageSubtitle} style={{ margin: "8px 0 0" }}>
                          <Link href="/contact-us" className={styles.rowLink}>
                            Contact support to upgrade
                          </Link>
                        </p>
                      </>
                    ) : null}
                    {!locked && expired ? (
                      <span className={styles.statusOff} style={{ display: "inline-block", marginTop: 8 }}>
                        Add-on expired
                      </span>
                    ) : null}
                    {!locked && expired ? (
                      <p className={styles.pageSubtitle} style={{ margin: "8px 0 0" }}>
                        <Link href="/contact-us" className={styles.rowLink}>
                          Contact support to renew
                        </Link>
                      </p>
                    ) : null}
                    {r.valid_until ? (
                      <p className={styles.pageSubtitle} style={{ margin: "8px 0 0" }}>
                        Valid until {new Date(r.valid_until).toLocaleDateString()}
                      </p>
                    ) : null}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(r.is_active)}
                        disabled={toggleDisabled}
                        onChange={(e) => toggle(r, e.target.checked)}
                      />
                      <span>Active</span>
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
