"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useToast } from "@/components/Toast/ToastContext";
import { taskStatusForDb } from "@/lib/taskStatus";
import styles from "./tasksPage.module.css";

const STATUS_META = {
  new: { label: "New", color: "#0d9488" },
  in_feedback: { label: "In Feedback", color: "#7c3aed" },
  processing: { label: "Processing", color: "#1e40af" },
  completed: { label: "Completed", color: "#16a34a" },
  rejected: { label: "Rejected", color: "#dc2626" },
};

const STATUS_KEYS = Object.keys(STATUS_META);

const SORT_PRESETS = [
  { id: "due_asc", label: "By due date (earliest first)", sort: "due_date", order: "asc" },
  { id: "due_desc", label: "By due date (latest first)", sort: "due_date", order: "desc" },
  { id: "created_desc", label: "By created date (newest)", sort: "created_at", order: "desc" },
  { id: "created_asc", label: "By created date (oldest)", sort: "created_at", order: "asc" },
  { id: "pri_desc", label: "By priority (high first)", sort: "priority", order: "desc" },
  { id: "pri_asc", label: "By priority (low first)", sort: "priority", order: "asc" },
];

function fmt(dt) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(dt);
  }
}

function creatorName(t) {
  const n = [t.creator_first_name, t.creator_last_name].filter(Boolean).join(" ");
  return n || t.creator_email || "—";
}

function assigneeName(t) {
  const n = [t.assignee_first_name, t.assignee_last_name].filter(Boolean).join(" ");
  return n || t.assigned_email || "—";
}

function bucketStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "todo" || s === "new") return "new";
  if (s === "in_feedback") return "in_feedback";
  if (s === "in_progress" || s === "processing") return "processing";
  if (s === "done" || s === "completed") return "completed";
  if (s === "rejected") return "rejected";
  return "new";
}

function userLabel(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `User #${u.id}`;
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function TasksPage() {
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();
  const { open: openQuick } = useQuickCreate();
  const { isLoaded } = useAuth();
  const searchParams = useSearchParams();

  const [users, setUsers] = useState([]);
  const [items, setItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [viewMode, setViewMode] = useState("grid");
  const [searchInput, setSearchInput] = useState("");
  const debouncedQ = useDebounced(searchInput, 350);
  const [sortPreset, setSortPreset] = useState("due_asc");

  const [priorityFilter, setPriorityFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const sortParts = useMemo(
    () => SORT_PRESETS.find((p) => p.id === sortPreset) || SORT_PRESETS[0],
    [sortPreset]
  );

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const res = await apiFetch("/users");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setUsers(json.data.filter((u) => u.is_active !== 0));
        }
      } catch {
        setUsers([]);
      }
    })();
  }, [isLoaded]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams();
      p.set("my", "true");
      p.set("include_status_counts", "1");
      if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
      if (priorityFilter !== "all") p.set("priority", priorityFilter);
      if (labelFilter.trim()) p.set("label", labelFilter.trim());
      if (createdBy) p.set("created_by", createdBy);
      if (assignTo === "__none__") p.set("assigned_to", "__none__");
      else if (assignTo) p.set("assigned_to", assignTo);
      if (statusFilter) p.set("status", statusFilter);
      if (dueFrom) p.set("due_after", dueFrom);
      if (dueTo) p.set("due_before", dueTo);
      p.set("sort", sortParts.sort);
      p.set("order", sortParts.order);

      const res = await apiFetch(`/tasks?${p.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(d.message || res.statusText || "Failed to load tasks");
      }
      setItems(Array.isArray(d.data) ? d.data : []);
      setStatusCounts(d.statusCounts || null);
    } catch (e) {
      setErr(e.message || "Failed to load tasks");
      setItems([]);
      setStatusCounts(null);
    } finally {
      setLoading(false);
    }
  }, [
    isLoaded,
    debouncedQ,
    priorityFilter,
    labelFilter,
    createdBy,
    assignTo,
    statusFilter,
    dueFrom,
    dueTo,
    sortParts.sort,
    sortParts.order,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onTasksChanged() {
      load();
    }
    window.addEventListener("crm-tasks-changed", onTasksChanged);
    return () => window.removeEventListener("crm-tasks-changed", onTasksChanged);
  }, [load]);

  const labelOptions = useMemo(() => {
    const s = new Set();
    items.forEach((t) => {
      if (t.label && String(t.label).trim()) s.add(String(t.label).trim());
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items]);

  function clearFilters() {
    setSearchInput("");
    setPriorityFilter("all");
    setLabelFilter("");
    setCreatedBy("");
    setAssignTo("");
    setStatusFilter("");
    setDueFrom("");
    setDueTo("");
    setSortPreset("due_asc");
  }

  function toggleStatusCard(key) {
    setStatusFilter((prev) => (prev === key ? "" : key));
  }

  async function patchTask(id, body) {
    const payload = { ...body };
    if (payload.status != null) {
      payload.status = taskStatusForDb(payload.status);
    }
    try {
      const res = await apiFetch(`/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update task", "error");
        return;
      }
      showToast("Task updated");
      load();
    } catch {
      showToast("Network error", "error");
    }
  }

  async function remove(t) {
    const msg = buildDeleteMessage({ singular: "task", name: t.title });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/tasks/${t.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not delete", "error");
        return;
      }
      showToast("Task deleted successfully");
      load();
    } catch {
      showToast("Network error", "error");
    }
  }

  const counts = statusCounts || {
    new: 0,
    in_feedback: 0,
    processing: 0,
    completed: 0,
    rejected: 0,
  };

  return (
    <div className={styles.page}>
      <div className={styles.headRow}>
        <div>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Tasks</h1>
            <div className={styles.viewToggle} role="group" aria-label="View mode">
              <button
                type="button"
                className={`${styles.viewBtn} ${viewMode === "grid" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <i className="fas fa-grip-horizontal" />
              </button>
              <button
                type="button"
                className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <i className="fas fa-list" />
              </button>
            </div>
          </div>
        </div>

        <div className={styles.toolbarActions}>
          <div className={styles.searchWrap}>
            <input
              className={styles.searchInput}
              placeholder="Search tasks…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search tasks"
            />
            <button type="button" className={styles.searchBtn} title="Search" aria-label="Search">
              <i className="fas fa-search" />
            </button>
          </div>
          <button type="button" className={styles.btnClear} onClick={clearFilters}>
            <i className="fas fa-times" /> Clear
          </button>
          <button
            type="button"
            className={`${styles.btnIcon} ${styles.btnIconYellow}`}
            onClick={() => openQuick("task")}
            title="Add task"
            aria-label="Add task"
          >
            <i className="fas fa-plus" />
          </button>
          <button
            type="button"
            className={styles.btnIcon}
            onClick={() => setCalOpen((v) => !v)}
            title="Due date range"
            aria-label="Due date range"
          >
            <i className="fas fa-calendar-days" />
          </button>
        </div>
      </div>

      {calOpen ? (
        <div className={styles.calPanel}>
          <div className={styles.calField}>
            <label htmlFor="due-from">Due from</label>
            <input
              id="due-from"
              type="date"
              className={styles.dateInput}
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
            />
          </div>
          <div className={styles.calField}>
            <label htmlFor="due-to">Due to</label>
            <input
              id="due-to"
              type="date"
              className={styles.dateInput}
              value={dueTo}
              onChange={(e) => setDueTo(e.target.value)}
            />
          </div>
          <button type="button" className={styles.btnClear} onClick={() => { setDueFrom(""); setDueTo(""); }}>
            Clear dates
          </button>
        </div>
      ) : null}

      <div className={styles.filtersBlock}>
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>Sort</span>
          <select
            className={styles.select}
            value={sortPreset}
            onChange={(e) => setSortPreset(e.target.value)}
            aria-label="Sort tasks"
          >
            {SORT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterGrid}>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Priority</span>
            <select
              className={styles.select}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="all">All Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Labels</span>
            <select
              className={styles.select}
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
            >
              <option value="">Select…</option>
              {labelOptions.map((lb) => (
                <option key={lb} value={lb}>
                  {lb}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Created by</span>
            <select
              className={styles.select}
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
            >
              <option value="">All Created By</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Assign to</span>
            <select
              className={styles.select}
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
            >
              <option value="">All Assign To</option>
              <option value="__none__">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {err ? (
        <div className={styles.errorBox}>
          {err}{" "}
          <button type="button" className={styles.btnClear} onClick={load}>
            Try again
          </button>
        </div>
      ) : null}

      <div className={styles.statusStrip}>
        {STATUS_KEYS.map((key) => {
          const meta = STATUS_META[key];
          const n = counts[key] ?? 0;
          const active = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.statusCard} ${active ? styles.statusCardActive : ""}`}
              style={{ background: meta.color }}
              onClick={() => toggleStatusCard(key)}
            >
              <span>{meta.label}</span>
              <span className={styles.statusCount}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.panel}>
        {loading ? (
          <p className={styles.muted} style={{ padding: 24 }}>
            Loading…
          </p>
        ) : items.length === 0 ? (
          <div className={styles.empty}>There are no records to display.</div>
        ) : viewMode === "grid" ? (
          <div className={styles.grid}>
            {items.map((t) => (
              <article key={t.id} className={styles.card}>
                <p className={styles.cardTitle}>{t.title}</p>
                <p className={styles.cardMeta}>
                  {t.description
                    ? `${String(t.description).slice(0, 200)}${String(t.description).length > 200 ? "…" : ""}`
                    : "No description"}
                </p>
                <div className={styles.cardRow}>
                  <span
                    className={`${styles.pill} ${
                      t.priority === "high"
                        ? styles.pillPriHigh
                        : t.priority === "low"
                          ? styles.pillPriLow
                          : styles.pillPriMed
                    }`}
                  >
                    {t.priority || "medium"}
                  </span>
                  {t.label ? (
                    <span className={styles.pill} style={{ background: "#e0e7ff", color: "#3730a3" }}>
                      {t.label}
                    </span>
                  ) : null}
                  <span className={styles.muted} style={{ fontSize: 12 }}>
                    Due {fmt(t.due_date)}
                  </span>
                </div>
                <div className={styles.cardRow}>
                  <span className={styles.muted} style={{ fontSize: 12 }}>
                    {creatorName(t)} → {assigneeName(t)}
                  </span>
                </div>
                <div className={styles.cardRow}>
                  <select
                    className={styles.miniSelect}
                    value={bucketStatus(t.status)}
                    onChange={(e) => patchTask(t.id, { status: e.target.value })}
                    aria-label="Change status"
                  >
                    {STATUS_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {STATUS_META[k].label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={styles.btnDanger} onClick={() => remove(t)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Label</th>
                  <th>Due</th>
                  <th>Created by</th>
                  <th>Assign to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.title}</strong>
                      {t.description ? (
                        <div className={styles.muted} style={{ marginTop: 4, maxWidth: 280 }}>
                          {String(t.description).slice(0, 120)}
                          {String(t.description).length > 120 ? "…" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <select
                        className={styles.miniSelect}
                        value={bucketStatus(t.status)}
                        onChange={(e) => patchTask(t.id, { status: e.target.value })}
                      >
                        {STATUS_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {STATUS_META[k].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{t.priority}</td>
                    <td>{t.label || "—"}</td>
                    <td>{fmt(t.due_date)}</td>
                    <td>{creatorName(t)}</td>
                    <td>{assigneeName(t)}</td>
                    <td>
                      <button type="button" className={styles.btnDanger} onClick={() => remove(t)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        COPYRIGHT © {new Date().getFullYear()} 365 RND CRM — All rights reserved.
      </div>
    </div>
  );
}
