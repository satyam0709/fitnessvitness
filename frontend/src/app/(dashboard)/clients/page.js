"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { apiFetch, connectGlobalSocket } from "@/lib/api";
import { updateClient } from "@/lib/fitnessApi";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import styles from "./clients.module.css";

const STATUS_COLORS = {
  Active: { color: "#10b981", bg: "#dcfce7" },
  Hold: { color: "#f59e0b", bg: "#fef3c7" },
  Inactive: { color: "#64748b", bg: "#f1f5f9" },
};

const PROGRESS_COLORS = {
  "Very Good": "#10b981",
  Good: "#22c55e",
  Neutral: "#64748b",
  Poor: "#f59e0b",
  "Very Poor": "#ef4444",
};

const QUICK_CHIPS = ["all", "Active", "Hold", "Overdue", "High Risk", "Next Due"];

const PROGRESS_OPTIONS = ["Very Good", "Good", "Neutral", "Poor", "Very Poor"];
const SOURCE_OPTIONS = [
  "BNI",
  "Instagram",
  "Facebook",
  "Referral - Existing Client",
  "Friend / Family",
  "Walk-in",
  "Online / Website",
  "Corporate / Company",
];
const PLAN_OPTIONS = ["1 Month Plan", "3 Month Plan", "6 Month Plan", "1 Year Plan"];

const SORT_OPTIONS = [
  { value: "next_due", label: "Next due — earliest first" },
  { value: "next_due_desc", label: "Next due — latest first" },
  { value: "plan_expiry", label: "Plan expiry — soonest first" },
  { value: "plan_expiry_desc", label: "Plan expiry — latest first" },
  { value: "name", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "tier", label: "Tier low → high" },
  { value: "tier_desc", label: "Tier high → low" },
  { value: "created", label: "Joined — newest" },
  { value: "created_asc", label: "Joined — oldest" },
];

const DEFAULT_FILTERS = {
  status: "all",
  progress: "",
  source: "",
  plan_type: "",
  tierMin: "",
  tierMax: "",
  city: "",
  priority: "",
  highRisk: false,
  expiringWithin: "",
  nextDueFrom: "",
  nextDueTo: "",
  planExpiryFrom: "",
  planExpiryTo: "",
  hasNextDue: "",
};

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function getPriorityDisplay(priority) {
  if (priority === "🔴 OVERDUE") return { label: priority, className: styles.overdue };
  if (priority === "🟡 DUE SOON") return { label: priority, className: styles.dueSoon };
  return { label: priority || "✅ OK", className: styles.ok };
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
      {"★".repeat(tier)}
      {"☆".repeat(5 - tier)}
    </span>
  );
}

function countAdvancedFilters(f) {
  let n = 0;
  if (f.progress) n++;
  if (f.source) n++;
  if (f.plan_type) n++;
  if (f.tierMin || f.tierMax) n++;
  if (f.city) n++;
  if (f.priority) n++;
  if (f.highRisk) n++;
  if (f.expiringWithin) n++;
  if (f.nextDueFrom || f.nextDueTo) n++;
  if (f.planExpiryFrom || f.planExpiryTo) n++;
  if (f.hasNextDue) n++;
  return n;
}

function buildClientQueryParams(appliedFilters, search, sort) {
  const params = new URLSearchParams();
  const status = appliedFilters.status;
  if (status && status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  if (sort) params.set("sort", sort);
  if (appliedFilters.progress) params.set("progress", appliedFilters.progress);
  if (appliedFilters.source) params.set("source", appliedFilters.source);
  if (appliedFilters.plan_type) params.set("plan_type", appliedFilters.plan_type);
  if (appliedFilters.tierMin) params.set("tier_min", appliedFilters.tierMin);
  if (appliedFilters.tierMax) params.set("tier_max", appliedFilters.tierMax);
  if (appliedFilters.city.trim()) params.set("city", appliedFilters.city.trim());
  if (appliedFilters.priority) params.set("priority", appliedFilters.priority);
  if (appliedFilters.highRisk) params.set("high_risk", "1");
  if (appliedFilters.expiringWithin) params.set("expiring_within", appliedFilters.expiringWithin);
  if (appliedFilters.nextDueFrom) params.set("next_due_from", appliedFilters.nextDueFrom);
  if (appliedFilters.nextDueTo) params.set("next_due_to", appliedFilters.nextDueTo);
  if (appliedFilters.planExpiryFrom) params.set("plan_expiry_from", appliedFilters.planExpiryFrom);
  if (appliedFilters.planExpiryTo) params.set("plan_expiry_to", appliedFilters.planExpiryTo);
  if (appliedFilters.hasNextDue === "yes") params.set("has_next_due", "1");
  if (appliedFilters.hasNextDue === "no") params.set("has_next_due", "0");
  return params;
}

export default function ClientsPage() {
  const { isAdmin } = useUserRole();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sort, setSort] = useState("next_due");
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savingDue, setSavingDue] = useState({});
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const params = buildClientQueryParams(appliedFilters, searchDebounced, sort);
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
  }, [appliedFilters, searchDebounced, sort]);

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

  const advancedCount = useMemo(() => countAdvancedFilters(appliedFilters), [appliedFilters]);
  const draftAdvancedCount = useMemo(() => countAdvancedFilters(draftFilters), [draftFilters]);

  const setDraftField = (key, value) =>
    setDraftFilters((prev) => ({ ...prev, [key]: value }));

  const handleQuickChip = (chip) => {
    const next = { ...draftFilters, status: chip };
    setDraftFilters(next);
    setAppliedFilters(next);
    if (chip === "Next Due" || chip === "Overdue") {
      setSort("next_due");
    }
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters });
    setFiltersOpen(false);
  };

  const handleResetFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setSort("next_due");
    setSearch("");
    setSearchDebounced("");
    setFiltersOpen(false);
  };

  const stats = {
    active: clients.filter((c) => c.status === "Active").length,
    onHold: clients.filter((c) => c.status === "Hold").length,
    needAttention: clients.filter((c) => c.progress === "Poor" || c.progress === "Very Poor").length,
    overdue: clients.filter((c) => {
      if (!c.next_due_date || c.status !== "Active") return false;
      return new Date(c.next_due_date) < new Date();
    }).length,
    expiringSoon: clients.filter((c) => {
      if (!c.plan_expiry_date || c.status !== "Active") return false;
      const days = getDaysRemaining(c.plan_expiry_date);
      return days !== null && days >= 0 && days <= 7;
    }).length,
    fiveStar: clients.filter((c) => c.tier === 5).length,
  };

  const activeChip = appliedFilters.status;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Fitness Clients</h1>
          <p className={styles.subtitle}>Manage your portfolio and track progress</p>
        </div>
        <Link href="/clients/new" className={styles.addBtn}>
          <i className="fa-solid fa-plus"></i> Add Client
        </Link>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.active}</span>
          <span className={styles.statLabel}>Active</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.onHold}</span>
          <span className={styles.statLabel}>On Hold</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.needAttention}</span>
          <span className={styles.statLabel}>Attention</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.overdue}</span>
          <span className={styles.statLabel}>Overdue</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.expiringSoon}</span>
          <span className={styles.statLabel}>Expiring</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.fiveStar}</span>
          <span className={styles.statLabel}>5-Star</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.chipRow}>
          {QUICK_CHIPS.map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.filterBtn} ${activeChip === f ? styles.chipActive : ""}`}
              onClick={() => handleQuickChip(f)}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort clients"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {isAdmin ? (
            <button
              type="button"
              className={styles.filtersToggle}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <i className="fa-solid fa-sliders" /> Filters
              {(advancedCount > 0 || draftAdvancedCount > 0) && (
                <span className={styles.filterBadge}>
                  {Math.max(advancedCount, draftAdvancedCount)}
                </span>
              )}
            </button>
          ) : null}
          <input
            type="text"
            placeholder="Search portfolio..."
            className={styles.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isAdmin && filtersOpen ? (
        <div className={styles.filterPanel}>
          <div className={styles.filterGrid}>
            <label className={styles.filterField}>
              <span>Progress</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.progress}
                onChange={(e) => setDraftField("progress", e.target.value)}
              >
                <option value="">Any</option>
                {PROGRESS_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Source</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.source}
                onChange={(e) => setDraftField("source", e.target.value)}
              >
                <option value="">Any</option>
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Plan type</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.plan_type}
                onChange={(e) => setDraftField("plan_type", e.target.value)}
              >
                <option value="">Any</option>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Follow-up priority</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.priority}
                onChange={(e) => setDraftField("priority", e.target.value)}
              >
                <option value="">Any</option>
                <option value="overdue">Overdue</option>
                <option value="due_soon">Due soon</option>
                <option value="ok">OK</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Tier min</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.tierMin}
                onChange={(e) => setDraftField("tierMin", e.target.value)}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Tier max</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.tierMax}
                onChange={(e) => setDraftField("tierMax", e.target.value)}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>City</span>
              <input
                type="text"
                className={styles.filterInput}
                value={draftFilters.city}
                onChange={(e) => setDraftField("city", e.target.value)}
                placeholder="City name"
              />
            </label>
            <label className={styles.filterField}>
              <span>Plan expiring within</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.expiringWithin}
                onChange={(e) => setDraftField("expiringWithin", e.target.value)}
              >
                <option value="">Any</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Has next due</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.hasNextDue}
                onChange={(e) => setDraftField("hasNextDue", e.target.value)}
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Next due from</span>
              <input
                type="date"
                className={styles.filterInput}
                value={draftFilters.nextDueFrom}
                onChange={(e) => setDraftField("nextDueFrom", e.target.value)}
              />
            </label>
            <label className={styles.filterField}>
              <span>Next due to</span>
              <input
                type="date"
                className={styles.filterInput}
                value={draftFilters.nextDueTo}
                onChange={(e) => setDraftField("nextDueTo", e.target.value)}
              />
            </label>
            <label className={styles.filterField}>
              <span>Plan expiry from</span>
              <input
                type="date"
                className={styles.filterInput}
                value={draftFilters.planExpiryFrom}
                onChange={(e) => setDraftField("planExpiryFrom", e.target.value)}
              />
            </label>
            <label className={styles.filterField}>
              <span>Plan expiry to</span>
              <input
                type="date"
                className={styles.filterInput}
                value={draftFilters.planExpiryTo}
                onChange={(e) => setDraftField("planExpiryTo", e.target.value)}
              />
            </label>
            <label className={`${styles.filterField} ${styles.filterCheck}`}>
              <input
                type="checkbox"
                checked={draftFilters.highRisk}
                onChange={(e) => setDraftField("highRisk", e.target.checked)}
              />
              <span>High risk only</span>
            </label>
          </div>
          <div className={styles.filterActions}>
            <button type="button" className={styles.resetBtn} onClick={handleResetFilters}>
              Reset
            </button>
            <button type="button" className={styles.applyBtn} onClick={handleApplyFilters}>
              Apply filters
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          Synchronizing client database...
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
              {clients.map((client) => {
                const daysLeft = client.days_remaining;
                const priority = getPriorityDisplay(client.follow_up_priority);
                const risk = client.risk_status || "✅ OK";

                return (
                  <tr
                    key={client.client_id}
                    className={`${client.tier === 5 ? styles.goldRow : ""} ${client.is_high_risk ? styles.highRisk : ""}`}
                  >
                    <td>
                      <Link href={`/clients/${client.client_id}`} className={styles.clientLink}>
                        {client.client_id}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/clients/${client.client_id}`} className={styles.clientLink}>
                        <strong>{client.full_name}</strong>
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`${styles.riskBadge} ${client.is_high_risk ? styles.highRiskBadge : ""}`}
                      >
                        {risk}
                      </span>
                    </td>
                    <td>
                      <span
                        className={styles.badge}
                        style={{
                          color: STATUS_COLORS[client.status]?.color || "#64748b",
                          background: STATUS_COLORS[client.status]?.bg || "#f1f5f9",
                        }}
                      >
                        {client.status}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: PROGRESS_COLORS[client.progress] || "#64748b",
                        }}
                      >
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
                    <td>
                      <span className={`${styles.priority} ${priority.className}`}>{priority.label}</span>
                    </td>
                    <td>
                      {daysLeft !== null && (
                        <span
                          className={`${styles.daysLeft} ${daysLeft < 0 ? styles.expired : daysLeft <= 7 ? styles.urgent : ""}`}
                        >
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
          {clients.length === 0 && (
            <div className={styles.empty}>No matching clients in current view</div>
          )}
        </div>
      )}
    </div>
  );
}
