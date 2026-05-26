"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch, connectGlobalSocket } from "@/lib/api";
import { updateClient } from "@/lib/fitnessApi";
import styles from "./clients.module.css";

const STATUS_COLORS = {
  Active: { color: "#10b981", bg: "#dcfce7" },
  Hold: { color: "#f59e0b", bg: "#fef3c7" },
  Inactive: { color: "#64748b", bg: "#f1f5f9" },
};

const PROGRESS_COLORS = {
  'Very Good': "#10b981",
  'Good': "#22c55e",
  'Neutral': "#64748b",
  'Poor': "#f59e0b",
  'Very Poor': "#ef4444",
};

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function getPriorityDisplay(priority) {
  if (priority === '🔴 OVERDUE') return { label: priority, className: styles.overdue };
  if (priority === '🟡 DUE SOON') return { label: priority, className: styles.dueSoon };
  return { label: priority || '✅ OK', className: styles.ok };
}

function getDaysRemaining(planExpiryDate) {
  if (!planExpiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(planExpiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function renderTier(tier) {
  return (
    <span className={styles.tier}>
      {"★".repeat(tier)}{"☆".repeat(5 - tier)}
    </span>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [savingDue, setSavingDue] = useState({});

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== "all") params.append("status", filter);
      if (search) params.append("search", search);

      const res = await apiFetch(`/fitness/clients?${params}`);
      const json = await res.json();
      if (json.success) {
        setClients(json.data);
      }
    } catch (err) {
      console.error("Failed to load clients:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const handleDueDateChange = async (clientId, value) => {
    setSavingDue((prev) => ({ ...prev, [clientId]: true }));
    try {
      await updateClient(clientId, { next_due_date: value || null });
      await loadClients();
    } catch (err) {
      console.error("Failed to update due date:", err);
      alert(err.message || "Could not update next due date");
    } finally {
      setSavingDue((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    let mounted = true;
    let sockRef = null;
    const onFitness = () => loadClients();
    (async () => {
      const s = await connectGlobalSocket(true);
      if (!mounted || !s) return;
      sockRef = s;
      s.on("fitness:changed", onFitness);
    })();
    return () => {
      mounted = false;
      if (sockRef) sockRef.off("fitness:changed", onFitness);
    };
  }, [loadClients]);

  const stats = {
    active: clients.filter(c => c.status === "Active").length,
    onHold: clients.filter(c => c.status === "Hold").length,
    needAttention: clients.filter(c => c.progress === "Poor" || c.progress === "Very Poor").length,
    overdue: clients.filter(c => {
      if (!c.next_due_date || c.status !== "Active") return false;
      return new Date(c.next_due_date) < new Date();
    }).length,
    expiringSoon: clients.filter(c => {
      if (!c.plan_expiry_date || c.status !== "Active") return false;
      const days = getDaysRemaining(c.plan_expiry_date);
      return days !== null && days >= 0 && days <= 7;
    }).length,
    fiveStar: clients.filter(c => c.tier === 5).length,
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Fitness Clients</h1>
          <p style={{color: '#64748b', margin: '4px 0 0', fontSize: '15px'}}>Manage your portfolio and track progress</p>
        </div>
        <Link href="/clients/new" className={styles.addBtn}>
          <i className="fa-solid fa-plus"></i> Add Client
        </Link>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><span className={styles.statValue}>{stats.active}</span><span className={styles.statLabel}>Active</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.onHold}</span><span className={styles.statLabel}>On Hold</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.needAttention}</span><span className={styles.statLabel}>Attention</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.overdue}</span><span className={styles.statLabel}>Overdue</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.expiringSoon}</span><span className={styles.statLabel}>Expiring</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.fiveStar}</span><span className={styles.statLabel}>5-Star</span></div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterBtns}>
          {["all", "Active", "Hold", "Overdue", "High Risk", "Next Due"].map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.active : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All Base" : f}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search portfolio..."
          className={styles.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className={styles.loading}>
          <div style={{width: '40px', height: '40px', border: '4px solid #f1f5f9', borderTopColor: '#f5c400', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px'}}></div>
          Synchronizing client database...
          <style jsx>{` @keyframes spin { to { transform: rotate(360deg); } } `}</style>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Client Name</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Next Due</th>
                <th>Follow-up</th>
                <th>Days</th>
                <th>Expiry</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => {
                const daysLeft = client.days_remaining;
                const priority = getPriorityDisplay(client.follow_up_priority);
                const risk = client.risk_status || '✅ OK';

                return (
                  <tr
                    key={client.client_id}
                    className={`${client.tier === 5 ? styles.goldRow : ""} ${client.is_high_risk ? styles.highRisk : ""}`}
                  >
                    <td><Link href={`/clients/${client.client_id}`} className={styles.clientLink}>{client.client_id}</Link></td>
                    <td>
                      <Link href={`/clients/${client.client_id}`} className={styles.clientLink}>
                        <strong>{client.full_name}</strong>
                      </Link>
                    </td>
                    <td><span className={`${styles.riskBadge} ${client.is_high_risk ? styles.highRiskBadge : ""}`}>{risk}</span></td>
                    <td>
                      <span className={styles.badge} style={{ 
                        color: STATUS_COLORS[client.status]?.color || "#64748b",
                        background: STATUS_COLORS[client.status]?.bg || "#f1f5f9"
                      }}>
                        {client.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: PROGRESS_COLORS[client.progress] || "#64748b" }}>
                        {client.progress}
                      </span>
                    </td>
                    <td>
                      <input
                        type="date"
                        className={styles.dueInput}
                        value={client.next_due_date ? String(client.next_due_date).slice(0, 10) : ""}
                        disabled={!!savingDue[client.client_id]}
                        title={formatDate(client.next_due_date)}
                        onChange={(e) => handleDueDateChange(client.client_id, e.target.value)}
                      />
                    </td>
                    <td><span className={`${styles.priority} ${priority.className}`}>{priority.label}</span></td>
                    <td>
                      {daysLeft !== null && (
                        <span className={`${styles.daysLeft} ${daysLeft < 0 ? styles.expired : daysLeft <= 7 ? styles.urgent : ""}`}>
                          {daysLeft < 0 ? "EX" : daysLeft}
                        </span>
                      )}
                    </td>
                    <td>{formatDate(client.plan_expiry_date)}</td>
                    <td>{renderTier(client.tier)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clients.length === 0 && <div className={styles.empty}>No matching clients in current view</div>}
        </div>
      )}
    </div>
  );
}