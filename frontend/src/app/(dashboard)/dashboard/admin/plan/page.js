"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getApiBase } from "@/lib/api";
import styles from "@/app/admin/users/page.module.css";

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

function humanizeAddonKey(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TenantAdminPlanPage() {
  useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {      const res = await fetch(`${getApiBase()}/tenant-admin/plan`, { credentials: "include", 
        headers: { "Content-Type": "application/json" },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setErr(j.message || "Could not load plan");
        setData(null);
        return;
      }
      setData(j.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className={styles.pageSubtitle}>Loading…</p>;
  if (err) return <p style={{ color: "#b91c1c" }}>{err}</p>;

  const pkg = data?.package || {};
  const seats = data?.seats || {};
  const max = seats.max ?? 0;
  const used = seats.used ?? 0;
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const barColor = pct >= 100 ? "#dc2626" : pct >= 80 ? "#ca8a04" : "#15803d";

  return (
    <div>
      <h2 className={styles.pageTitle}>Plan</h2>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.05rem", marginTop: 0 }}>
          Subscription
        </h3>
        <p>
          <span className={styles.statusBadge} style={{ background: "#e5e7eb", marginRight: 8 }}>
            {pkg.package_name || "—"}
          </span>
          <span className={styles.statusBadge} style={{ background: "#fef9c3", color: "#854d0e" }}>
            {pkg.status || "—"}
          </span>
        </p>
        <p className={styles.pageSubtitle}>
          Valid {pkg.valid_from ? new Date(pkg.valid_from).toLocaleDateString() : "—"} →{" "}
          {pkg.valid_until ? new Date(pkg.valid_until).toLocaleDateString() : "—"}
        </p>
        <p className={styles.pageSubtitle}>
          Seats: {used} / {max || "—"}
        </p>
        <div style={{ height: 10, background: "#e5e7eb", borderRadius: 4, maxWidth: 400 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 4 }} />
        </div>
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.05rem", marginTop: 0 }}>
          Features
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(data?.features || []).map((f) => (
            <span
              key={f.feature_key}
              className={styles.statusBadge}
              style={{
                background: f.is_enabled ? "#dcfce7" : "#f3f4f6",
                color: f.is_enabled ? "#166534" : "#6b7280",
              }}
            >
              {FEATURE_LABELS[f.feature_key] || f.feature_key}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.tableWrap} style={{ marginBottom: 24, padding: 16 }}>
        <h3 className={styles.pageTitle} style={{ fontSize: "1.05rem", marginTop: 0 }}>
          Add-ons
        </h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Add-on</th>
              <th>Status</th>
              <th>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {(data?.addons || []).length ? (
              data.addons.map((a) => (
                <tr key={a.addon_key}>
                  <td>{humanizeAddonKey(a.addon_key)}</td>
                  <td>
                    <span className={Number(a.is_active) ? styles.statusOn : styles.statusOff}>
                      {Number(a.is_active) ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{a.valid_until ? new Date(a.valid_until).toLocaleDateString() : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className={styles.pageSubtitle}>
                  None
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className={styles.pageSubtitle}>
        Need more seats or features?{" "}
        <Link href="/contact-us" className={styles.rowLink}>
          Contact 365 RND support
        </Link>
      </p>
    </div>
  );
}
