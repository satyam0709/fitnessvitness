"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import styles from "./clients.module.css";

const STATUS_COLORS = {
  Active: { color: "#10b981", bg: "rgba(16,185,129,0.15)" },
  Hold: { color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  Inactive: { color: "#6b7280", bg: "rgba(107,114,128,0.15)" },
};

const PROGRESS_COLORS = {
  'Very Good': "#10b981",
  'Good': "#22c55e",
  'Neutral': "#6b7280",
  'Poor': "#f59e0b",
  'Very Poor': "#ef4444",
};

function getFollowUpPriority(nextDueDate) {
  if (!nextDueDate) return { label: "—", className: "" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { label: "🔴 OVERDUE", className: styles.overdue };
  if (diffDays <= 3) return { label: "🟡 DUE SOON", className: styles.dueSoon };
  return { label: "✅ OK", className: styles.ok };
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
      {[...Array(5)].map((_, i) => (
        <span key={i} style={{ color: i < tier ? "#fbbf24" : "#d1d5db" }}>★</span>
      ))}
    </span>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadClients();
  }, [filter, search]);

  async function loadClients() {
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
  }

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
        <h1>Fitness Clients</h1>
        <Link href="/clients/new" className={styles.addBtn}>
          <i className="fa-solid fa-plus"></i> Add Client
        </Link>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><span className={styles.statValue}>{stats.active}</span>Active</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.onHold}</span>On Hold</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.needAttention}</span>Need Attention</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.overdue}</span>Overdue Follow-ups</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.expiringSoon}</span>Expiring Soon</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.fiveStar}</span>5-Star Clients</div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterBtns}>
          {["all", "Active", "Hold", "Overdue", "High Risk"].map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.active : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "Overdue" ? "Overdue" : f === "High Risk" ? "High Risk" : f}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search clients..."
          className={styles.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Last Consult</th>
                <th>Next Due</th>
                <th>Days Left</th>
                <th>Follow-up</th>
                <th>Plan Expiry</th>
                <th>Plan Type</th>
                <th>Source</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => {
                const daysLeft = getDaysRemaining(client.plan_expiry_date);
                const priority = getFollowUpPriority(client.next_due_date);
                const isHighRisk = (client.progress === "Poor" || client.progress === "Very Poor") &&
                  (priority.className === styles.overdue || (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7));

                return (
                  <tr
                    key={client.client_id}
                    className={`${client.tier === 5 ? styles.goldRow : ""} ${isHighRisk ? styles.highRisk : ""}`}
                  >
                    <td><Link href={`/clients/${client.client_id}`} className={styles.clientLink}>{client.client_id}</Link></td>
                    <td>{client.full_name}</td>
                    <td>
                      <span className={styles.badge} style={STATUS_COLORS[client.status] || STATUS_COLORS.Active}>
                        {client.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: PROGRESS_COLORS[client.progress] || "#6b7280" }}>
                        {client.progress}
                      </span>
                    </td>
                    <td>{client.last_consultation_date || "—"}</td>
                    <td>{client.next_due_date || "—"}</td>
                    <td>
                      {daysLeft !== null && (
                        <span className={`${styles.daysLeft} ${daysLeft < 0 ? styles.expired : daysLeft <= 7 ? styles.urgent : ""}`}>
                          {daysLeft < 0 ? "Expired" : daysLeft}
                        </span>
                      )}
                    </td>
                    <td><span className={`${styles.priority} ${priority.className}`}>{priority.label}</span></td>
                    <td>{client.plan_expiry_date || "—"}</td>
                    <td>{client.plan_type || "—"}</td>
                    <td>{client.source || "—"}</td>
                    <td>{renderTier(client.tier)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clients.length === 0 && <div className={styles.empty}>No clients found</div>}
        </div>
      )}
    </div>
  );
}