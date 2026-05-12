"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "./AdminRealtimeProvider";
import styles from "./page.module.css";

function StatCard({ label, value, icon, href, variant = "default" }) {
  const content = (
    <div className={`${styles.statCard} ${variant === "accent" ? styles.statCardAccent : ""}`}>
      <div className={styles.statIcon}>
        <i className={`fas ${icon}`} />
      </div>
      <div className={styles.statText}>
        <p className={styles.statLabel}>{label}</p>
        <p className={styles.statValue}>{value ?? "—"}</p>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className={styles.statLink}>
      {content}
    </Link>
  ) : (
    content
  );
}

function BarRow({ label, value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.barNum}>{value}</span>
    </div>
  );
}

export default function AdminDashboard() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const firstLoad = useRef(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function fetch_() {
      if (firstLoad.current) {
        setLoading(true);
        firstLoad.current = false;
      }
      setLoadError(null);
      try {
        let res = await apiFetch("/admin/stats");
        if (res.status === 401) {
          // Wait briefly for refresh to complete, then retry once
          await new Promise((r) => setTimeout(r, 500));
          const retryRes = await apiFetch("/admin/stats");
          if (retryRes.ok) {
            res = retryRes;
          }
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(json.message || res.statusText || "Could not load admin stats");
          setData(null);
          return;
        }
        if (json.success) setData(json);
        else {
          setLoadError(json.message || "Could not load admin stats");
          setData(null);
        }
      } catch (e) {
        setLoadError(e.message || "Network error");
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetch_();
  }, [refreshNonce, reloadKey]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow)" }} />
        Loading overview…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.loading} style={{ flexDirection: "column", gap: 12 }}>
          <p style={{ color: "#dc2626", fontWeight: 700, margin: 0 }}>{loadError}</p>
          <p className={styles.sectionHint} style={{ margin: 0 }}>
            Check that you are signed in as an admin and that the API base URL is correct.
          </p>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => {
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <p className={styles.sectionHint}>No overview data available.</p>
      </div>
    );
  }

  const { stats, recentUsers = [], recentOrders = [], tenantStats = {}, tenantBreakdown = [] } = data;
  const s = stats || {};
  const ts = tenantStats || {};

  const STATUS_COLORS = {
    trial: { bg: "var(--yellow-tint)", color: "var(--yellow-hover)" },
    active: { bg: "rgba(21,128,61,0.12)", color: "#15803d" },
    expired: { bg: "rgba(220,38,38,0.1)", color: "#dc2626" },
    trial_expired: { bg: "rgba(220,38,38,0.1)", color: "#dc2626" },
    cancelled: { bg: "var(--bg-hover)", color: "var(--text-muted)" },
  };

  const workspaceMax = Math.max(
    s.totalTasks || 0,
    s.totalReminders || 0,
    s.totalMeetings || 0,
    s.totalNotes || 0,
    1
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.heroKicker}>365 RND CRM · Administration</p>
          <h2 className={styles.heroTitle}>Operations overview</h2>
        </div>
        <div className={styles.heroActions}>
          <Link href="/admin/users" className={styles.btnPrimary}>
            <i className="fas fa-users" /> Users &amp; roles
          </Link>
          <Link href="/admin/order" className={styles.btnGhost}>
            <i className="fas fa-receipt" /> Subscriptions
          </Link>
        </div>
      </section>

      <section className={styles.kpiSection}>
        <h3 className={styles.sectionTitle}>Business health</h3>
        <div className={styles.statsGrid}>
          <StatCard
            label="Registered users"
            value={s.totalUsers}
            icon="fa-users"
            href="/admin/users"
            variant="accent"
          />
          <StatCard label="Total leads (CRM)" value={s.totalLeads} icon="fa-filter" />
          <StatCard
            label="Active trials"
            value={s.activeTrials}
            icon="fa-clock"
            href="/admin/order?status=trial"
          />
          <StatCard
            label="Paying subscriptions"
            value={s.activeSubs}
            icon="fa-circle-check"
            href="/admin/order?status=active"
          />
          <StatCard
            label="Expired / lapsed"
            value={s.expiredSubs}
            icon="fa-hourglass-end"
            href="/admin/order?status=expired"
          />
          <StatCard
            label="Unread contact forms"
            value={s.contactRequests}
            icon="fa-envelope-open-text"
            href="/admin/contacts?is_read=false"
          />
        </div>
      </section>

      <section className={styles.kpiSection}>
        <h3 className={styles.sectionTitle}>Multi-tenant SaaS</h3>
        <p className={styles.sectionHint}>Buying companies (tenants), plans, and seat capacity.</p>
        <div className={styles.statsGrid}>
          <StatCard label="Total tenants" value={ts.totalTenants} icon="fa-building" href="/admin/tenants" />
          <StatCard label="Active workspaces" value={ts.activeTenants} icon="fa-building-circle-check" href="/admin/tenants" />
          <StatCard label="Trials" value={ts.trialTenants} icon="fa-flask" href="/admin/tenants" />
          <StatCard label="Expired / inactive" value={ts.expiredTenants} icon="fa-building-circle-xmark" />
          <StatCard label="Seats (sum plans)" value={ts.totalSeatsAcrossAllTenants} icon="fa-chair" />
          <StatCard label="Top plan" value={ts.topPlan || "—"} icon="fa-crown" />
          <StatCard label="Top add-on" value={ts.mostUsedAddon || "—"} icon="fa-plug" />
        </div>
        {tenantBreakdown.length ? (
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <h4 className={styles.sectionTitle} style={{ fontSize: "0.95rem" }}>
              Recent tenants (by plan end)
            </h4>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Users</th>
                  <th>Add-ons</th>
                  <th>Valid until</th>
                </tr>
              </thead>
              <tbody>
                {tenantBreakdown.map((r) => (
                  <tr key={r.tenant_id}>
                    <td>
                      <Link href={`/admin/tenants/${r.tenant_id}`}>{r.name}</Link>
                    </td>
                    <td>{r.plan || "—"}</td>
                    <td>{r.status}</td>
                    <td>{r.user_count}</td>
                    <td>{r.addon_count}</td>
                    <td>{r.valid_until ? new Date(r.valid_until).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={styles.splitSection}>
        <div className={styles.workspaceCard}>
          <h3 className={styles.sectionTitle}>Workspace activity (all tenants)</h3>
          <p className={styles.sectionHint}>
            Totals across tasks, reminders, meetings, and notes — useful for adoption and load.
          </p>
          <BarRow label="Tasks" value={s.totalTasks || 0} max={workspaceMax} />
          <BarRow label="Reminders" value={s.totalReminders || 0} max={workspaceMax} />
          <BarRow label="Meetings" value={s.totalMeetings || 0} max={workspaceMax} />
          <BarRow label="Notes" value={s.totalNotes || 0} max={workspaceMax} />
        </div>

        {/* <aside className={styles.guideCard}>
          <h4 className={styles.guideTitle}>
            <i className="fas fa-shield-halved" />  access works
          </h4>
          <ol className={styles.guideList}>
            <li>User signs in with Clerk.</li>
            <li>Backend syncs the user row and <strong>role</strong> (admin / manager / staff).</li>
            <li>Only <strong>admin</strong> passes the gate to <code>/admin</code>.</li>
            <li>Promote someone in DB or via user detail → Change role.</li>
          </ol>
          <p className={styles.guideFoot}>
            Roadmap: audit log, export, lead pipeline admin, and integration webhooks — typical for mature CRM admin consoles.
          </p>
        </aside> */}
      </section>

      <div className={styles.bottomGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Recent users</p>
            <Link href="/admin/users" className={styles.viewAll}>
              View all →
            </Link>
          </div>
          {recentUsers.length === 0 ? (
            <p className={styles.empty}>No users yet</p>
          ) : (
            recentUsers.map((u) => (
              <Link key={u.id} href={`/admin/users/${u.id}`} className={styles.userRow}>
                <div className={styles.userAvatar}>
                  {(u.first_name || u.email || "?")[0].toUpperCase()}
                </div>
                <div className={styles.userInfo}>
                  <p className={styles.userName}>
                    {u.first_name || ""} {u.last_name || ""}
                  </p>
                  <p className={styles.userEmail}>{u.email}</p>
                </div>
                <span className={styles.roleBadge}>{u.role}</span>
              </Link>
            ))
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Recent orders</p>
            <Link href="/admin/order" className={styles.viewAll}>
              View all →
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className={styles.empty}>No orders yet</p>
          ) : (
            recentOrders.map((o) => {
              const sc = STATUS_COLORS[o.status] || {
                bg: "var(--bg-hover)",
                color: "var(--text-muted)",
              };
              return (
                <div key={o.id} className={styles.orderRow}>
                  <div>
                    <p className={styles.orderUser}>{o.first_name || o.email || "Unknown"}</p>
                    <p className={styles.orderPlan}>{o.package_name || "No plan"}</p>
                  </div>
                  <span
                    className={styles.statusBadge}
                    style={{ background: sc.bg, color: sc.color }}
                  >
                    {o.status}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
