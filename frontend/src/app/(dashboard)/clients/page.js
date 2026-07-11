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

const QUICK_CHIPS = [
  "all",
  "Active",
  "Hold",
  "Overdue",
  "High Risk",
  "Low Risk",
  "Next Due",
];

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
  { value: "id_asc", label: "ID lowest first" },
  { value: "id_desc", label: "ID highest first" },
  { value: "risk_asc", label: "High risk first" },
  { value: "risk_desc", label: "Low risk first" },
  { value: "status_asc", label: "Status: Active first" },
  { value: "status_desc", label: "Status: Inactive/Hold first" },
  { value: "progress_asc", label: "Progress: Best first" },
  { value: "progress_desc", label: "Progress: Poor first" },
  { value: "follow_up_asc", label: "Follow-up: Overdue first" },
  { value: "follow_up_desc", label: "Follow-up: OK first" },
  { value: "days_asc", label: "Days remaining: Least first" },
  { value: "days_desc", label: "Days remaining: Most first" },
];

const SORT_HINTS = {
  next_due:
    "Who to call first: clients with the nearest follow-up date appear at the top. Clients without a date are listed last.",
  next_due_desc:
    "Furthest follow-ups first — useful when you want to defer recent contacts and focus on later dates.",
  plan_expiry:
    "Membership ending soonest appears first — ideal for renewal conversations before plans lapse.",
  plan_expiry_desc:
    "Plans expiring latest appear first — clients with no expiry date are listed last.",
  name: "Alphabetical by client name (A to Z).",
  name_desc: "Reverse alphabetical by client name (Z to A).",
  tier: "Lower star tier (1★) first, then higher tiers — spot clients who may need more attention.",
  tier_desc: "Highest tier (5★) first — your top-rated clients rise to the top.",
  created: "Most recently added clients first.",
  created_asc: "Longest-standing clients first — who joined earliest in your portfolio.",
  id_asc: "ID from lowest to highest numerical value.",
  id_desc: "ID from highest to lowest numerical value.",
  risk_asc: "Clients flagged as High Risk shown first.",
  risk_desc: "Clients flagged as OK shown first.",
  status_asc: "Active clients first, followed by On Hold and Inactive.",
  status_desc: "Inactive and On Hold clients first, followed by Active.",
  progress_asc: "Clients with Very Good progress first, going down to Very Poor.",
  progress_desc: "Clients with Very Poor progress first, going up to Very Good.",
  follow_up_asc: "Overdue follow-ups first, then Due Soon, then OK.",
  follow_up_desc: "OK follow-ups first, then Due Soon, then Overdue.",
  days_asc: "Clients with fewest plan days remaining first.",
  days_desc: "Clients with most plan days remaining first.",
};

const SORT_STORAGE_KEY = "fitness_clients_sort";

function readStoredSort() {
  if (typeof window === "undefined") return "next_due";
  const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
  return SORT_OPTIONS.some((o) => o.value === stored) ? stored : "next_due";
}

const DEFAULT_FILTERS = {
  status: "all",
  progress: "",
  source: "",
  plan_type: "",
  tierMin: "",
  tierMax: "",
  city: "",
  priority: "",
  riskLevel: "",
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
  if (f.riskLevel) n++;
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
  if (appliedFilters.riskLevel === "high") params.set("high_risk", "1");
  if (appliedFilters.riskLevel === "low") params.set("low_risk", "1");
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

  const handleSortClick = (ascKey, descKey) => {
    if (sort === ascKey) {
      setSort(descKey);
    } else {
      setSort(ascKey);
    }
  };

  const renderSortHeader = (label, ascKey, descKey) => {
    const isSortedAsc = sort === ascKey;
    const isSortedDesc = sort === descKey;
    const isSorted = isSortedAsc || isSortedDesc;

    return (
      <th
        onClick={() => handleSortClick(ascKey, descKey)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span>{label}</span>
          {isSorted ? (
            isSortedAsc ? (
              <i className="fa-solid fa-caret-up" style={{ color: "#10b981" }} />
            ) : (
              <i className="fa-solid fa-caret-down" style={{ color: "#10b981" }} />
            )
          ) : (
            <i className="fa-solid fa-sort" style={{ opacity: 0.3 }} />
          )}
        </div>
      </th>
    );
  };

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sort, setSort] = useState("next_due");
  const [sortMeta, setSortMeta] = useState(null);
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savingDue, setSavingDue] = useState({});
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load stored sort from local storage on client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (stored && SORT_OPTIONS.some((o) => o.value === stored)) {
        setSort(stored);
      }
    }
  }, []);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const params = buildClientQueryParams(appliedFilters, searchDebounced, sort);
      const res = await apiFetch(`/fitness/clients?${params}`);
      const json = await res.json();
      if (json.success) {
        setClients(Array.isArray(json.data) ? json.data : []);
        if (json.meta) setSortMeta(json.meta);
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SORT_STORAGE_KEY, sort);
    }
  }, [sort]);

  const activeSortLabel =
    sortMeta?.sortLabel || SORT_OPTIONS.find((o) => o.value === sort)?.label || "Sort";
  const sortHint = SORT_HINTS[sortMeta?.sort || sort] || SORT_HINTS.next_due;

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
    const next = {
      ...draftFilters,
      status: chip,
      riskLevel:
        chip === "High Risk" ? "high" : chip === "Low Risk" ? "low" : "",
    };
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

      <div className={styles.sortHintBar} role="status" aria-live="polite">
        <i className="fa-solid fa-arrow-down-wide-short" aria-hidden />
        <div className={styles.sortHintText}>
          <strong>{activeSortLabel}</strong>
          <span> — {sortHint}</span>
          {!loading && (
            <span className={styles.sortHintCount}>
              {" "}
              · {clients.length} client{clients.length === 1 ? "" : "s"} shown
            </span>
          )}
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
            <label className={styles.filterField}>
              <span>Risk level</span>
              <select
                className={styles.filterSelect}
                value={draftFilters.riskLevel}
                onChange={(e) => {
                  const riskLevel = e.target.value;
                  setDraftFilters((prev) => ({
                    ...prev,
                    riskLevel,
                    status:
                      riskLevel === "high"
                        ? "High Risk"
                        : riskLevel === "low"
                          ? "Low Risk"
                          : prev.status === "High Risk" || prev.status === "Low Risk"
                            ? "all"
                            : prev.status,
                  }));
                }}
              >
                <option value="">Any</option>
                <option value="high">High risk only</option>
                <option value="low">Low risk only</option>
              </select>
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
                {renderSortHeader("ID", "id_asc", "id_desc")}
                {renderSortHeader("Client Name", "name", "name_desc")}
                {renderSortHeader("Risk", "risk_asc", "risk_desc")}
                {renderSortHeader("Status", "status_asc", "status_desc")}
                {renderSortHeader("Progress", "progress_asc", "progress_desc")}
                {renderSortHeader("Next Due", "next_due", "next_due_desc")}
                {renderSortHeader("Follow-up", "follow_up_asc", "follow_up_desc")}
                {renderSortHeader("Days", "days_asc", "days_desc")}
                {renderSortHeader("Expiry", "plan_expiry", "plan_expiry_desc")}
                {renderSortHeader("Tier", "tier", "tier_desc")}
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
