"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../../AdminRealtimeProvider";
import styles from "../page.module.css";

const STATUS_COLORS = {
  trial:         { bg: "#fff7e6", color: "#d4a900" },
  active:        { bg: "#f0fdf4", color: "#15803d" },
  expired:       { bg: "#fef2f2", color: "#dc2626" },
  trial_expired: { bg: "#fef2f2", color: "#dc2626" },
  cancelled:     { bg: "#f3f4f6", color: "#6b7280" },
  none:          { bg: "#f3f4f6", color: "#6b7280" },
};

export default function AdminUserDetailPage() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [grantingTrial, setGrantingTrial] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("Gold");
  const [trialPlanOptions, setTrialPlanOptions] = useState([
    { name: "Gold" },
    { name: "Diamond" },
    { name: "Platinum" },
  ]);
  const lastFetchedUserId = useRef(null);

  useEffect(() => {
    const idChanged = lastFetchedUserId.current !== params.id;
    if (idChanged) {
      lastFetchedUserId.current = params.id;
      setLoading(true);
    }
    let cancelled = false;
    async function fetchUser() {
      try {
        const res = await apiFetch(`/admin/users/${params.id}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.success) setData(json);
        else router.replace("/admin/users");
      } catch {
        if (!cancelled) router.replace("/admin/users");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchUser();
    return () => {
      cancelled = true;
    };
  }, [params.id, refreshNonce, router]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrialPlans() {
      try {
        const res = await apiFetch("/admin/catalog/packages");
        const j = await res.json().catch(() => ({}));
        if (cancelled || !j.success || !Array.isArray(j.packages)) return;
        const active = j.packages.filter((p) => p.is_active);
        if (!active.length) return;
        setTrialPlanOptions(active.map((p) => ({ name: p.name })));
        setSelectedPlan((prev) => (active.some((p) => p.name === prev) ? prev : active[0].name));
      } catch {
        /* keep defaults */
      }
    }
    loadTrialPlans();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleGrantTrial() {
    setGrantingTrial(true);
    try {
      const res = await apiFetch(`/admin/users/${params.id}/trial`, {
        method: "POST",
        body: JSON.stringify({ package_name: selectedPlan, days: 7 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not grant trial");
        return;
      }
      showToast(json.message);
      const r2 = await apiFetch(`/admin/users/${params.id}`);
      const d2 = await r2.json().catch(() => ({}));
      if (d2.success) setData(d2);
    } catch {
      showToast("Error granting trial");
    } finally {
      setGrantingTrial(false);
    }
  }

  async function handleToggleActive() {
    try {
      const res = await apiFetch(`/admin/users/${params.id}/toggle-active`, {
        method: "PATCH",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update user status");
        return;
      }
      showToast(json.message);
      setData((prev) => ({ ...prev, user: { ...prev.user, is_active: json.is_active } }));
    } catch {
      showToast("Error updating user");
    }
  }

  async function handleRoleChange(role) {
    try {
      const res = await apiFetch(`/admin/users/${params.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update role");
        return;
      }
      showToast("Role updated successfully");
      setData((prev) => ({ ...prev, user: { ...prev.user, role } }));
    } catch {
      showToast("Error updating role");
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", gap: 10, fontFamily: "var(--font-display)", color: "var(--text-muted)" }}>
        <i className="fas fa-spinner fa-spin" style={{ color: "#F5C400" }} /> Loading user...
      </div>
    );
  }

  if (!data) return null;

  const { user, orders = [], leadsCount = 0 } = data;

  return (
    <div>
      {toast && (
        <div className={styles.toast}>
          <i className="fas fa-check-circle" /> {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/admin/users" style={{ color: "var(--text-muted)", textDecoration: "none", fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="fas fa-arrow-left" /> Back to Users
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* User Profile Card */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--yellow-tint)", border: "2px solid var(--yellow)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 900, color: "var(--yellow-hover)" }}>
              {(user.first_name || user.email || "?")[0].toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--text-main)", margin: "0 0 4px" }}>
                {user.first_name || ""} {user.last_name || ""}
              </h2>
              <p style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{user.email}</p>
            </div>
          </div>

          {[
            { k: "Role", v: user.role, type: "role" },
            { k: "Status", v: user.is_active ? "Active" : "Inactive", type: "badge", color: user.is_active ? "#15803d" : "#dc2626", bg: user.is_active ? "#f0fdf4" : "#fef2f2" },
            { k: "Total Leads", v: leadsCount },
            { k: "Joined", v: user.created_at ? new Date(user.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—" },
            { k: "Last Login", v: user.last_login ? new Date(user.last_login).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never" },
          ].map((row) => (
            <div key={row.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-display)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{row.k}</span>
              {row.type === "badge" ? (
                <span style={{ background: row.bg, color: row.color, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{row.v}</span>
              ) : row.type === "role" ? (
                <span style={{ background: "var(--yellow-tint)", color: "var(--yellow-hover)", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: "capitalize" }}>{row.v}</span>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{row.v}</span>
              )}
            </div>
          ))}
        </div>

        {/* Actions Card */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Grant Trial */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, color: "var(--text-main)", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="fas fa-gift" style={{ color: "var(--yellow-hover)" }} /> Grant Free Trial
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {trialPlanOptions.map((plan) => (
                <button
                  key={plan.name}
                  type="button"
                  onClick={() => setSelectedPlan(plan.name)}
                  style={{
                    padding: "10px",
                    border: selectedPlan === plan.name ? "2px solid var(--yellow)" : "1px solid var(--border)",
                    background: selectedPlan === plan.name ? "var(--yellow-tint)" : "var(--bg-hover)",
                    borderRadius: 8,
                    fontFamily: "var(--font-display)",
                    fontSize: 13,
                    fontWeight: 700,
                    color: selectedPlan === plan.name ? "var(--yellow-hover)" : "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {plan.name}
                </button>
              ))}
            </div>
            <button
              onClick={handleGrantTrial}
              disabled={grantingTrial}
              style={{ width: "100%", padding: "11px", background: "var(--yellow)", color: "#1a1a2e", border: "none", borderRadius: 10, fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: grantingTrial ? 0.7 : 1 }}
            >
              {grantingTrial ? <><i className="fas fa-spinner fa-spin" /> Granting...</> : <><i className="fas fa-gift" /> Grant 7-Day {selectedPlan} Trial</>}
            </button>
          </div>

          {/* Change Role */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, color: "var(--text-main)", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="fas fa-user-tag" style={{ color: "var(--yellow-hover)" }} /> Change Role
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {["admin", "manager", "staff"].map((role) => (
                <button
                  key={role}
                  onClick={() => handleRoleChange(role)}
                  style={{
                    padding: "10px",
                    border: user.role === role ? "2px solid var(--yellow)" : "1px solid var(--border)",
                    background: user.role === role ? "var(--yellow-tint)" : "var(--bg-hover)",
                    borderRadius: 8,
                    fontFamily: "var(--font-display)",
                    fontSize: 13,
                    fontWeight: 700,
                    color: user.role === role ? "var(--yellow-hover)" : "var(--text-muted)",
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          {/* Activate/Deactivate */}
          <button
            onClick={handleToggleActive}
            style={{
              padding: "13px",
              background: user.is_active ? "#fef2f2" : "#f0fdf4",
              color: user.is_active ? "#dc2626" : "#15803d",
              border: `1px solid ${user.is_active ? "#fecaca" : "#bbf7d0"}`,
              borderRadius: 12,
              fontFamily: "var(--font-display)",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <i className={`fas ${user.is_active ? "fa-ban" : "fa-check-circle"}`} />
            {user.is_active ? "Deactivate User" : "Activate User"}
          </button>
        </div>
      </div>

      {/* Orders History */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, color: "var(--text-main)", margin: 0 }}>
            Order History ({orders.length})
          </h3>
        </div>
        {orders.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", fontFamily: "var(--font-display)", color: "var(--text-muted)", fontSize: 14 }}>
            No orders yet
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Plan</th>
                <th>Total</th>
                <th>Currency</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const sc = STATUS_COLORS[o.status] || { bg: "#f3f4f6", color: "#6b7280" };
                return (
                  <tr key={o.id}>
                    <td><span className={styles.dateText}>#{o.id}</span></td>
                    <td><span className={styles.planText}>{o.package_name || "—"}</span></td>
                    <td><span className={styles.tableName}>{o.currency === "USD" ? "$" : "₹"}{Number(o.total || 0).toLocaleString()}</span></td>
                    <td><span className={styles.dateText}>{o.currency}</span></td>
                    <td><span className={styles.subBadge} style={{ background: sc.bg, color: sc.color }}>{o.status}</span></td>
                    <td><span className={styles.dateText}>{o.created_at ? new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}