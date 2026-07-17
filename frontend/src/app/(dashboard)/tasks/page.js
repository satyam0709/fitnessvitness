"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useToast } from "@/components/Toast/ToastContext";
import { taskStatusForDb } from "@/lib/taskStatus";
import { useListHighlight, itemHighlightClass } from "@/lib/useListHighlight";
import TaskModal, { CATEGORY_LABEL } from "@/components/Tasks/TaskModal";
import ManageTaskCustomOptionsModal from "@/components/Tasks/ManageTaskCustomOptionsModal";
import styles from "./tasksPage.module.css";

const KANBAN = [
  { key: "pending", title: "📋 Pending", headClass: styles.colPending },
  { key: "progress", title: "⚡ In Progress", headClass: styles.colProgress },
  { key: "done", title: "✅ Done", headClass: styles.colDone },
  { key: "carried", title: "➡ Carried Forward", headClass: styles.colCarried },
];

const CATEGORY_EMOJI = {
  diet_review: "🥗",
  meal_plan: "📋",
  weight_checkin: "⚖️",
  supplement_check: "💊",
  plan_renewal: "🔄",
  payment_followup: "💰",
  client_call: "📞",
  admin: "🏢",
  general: "✅",
};

const BASE_CATEGORY_FILTER_OPTS = [
  { value: "", label: "All Categories" },
  { value: "diet_review", label: "Diet Review" },
  { value: "meal_plan", label: "Meal Plan" },
  { value: "weight_checkin", label: "Weight Check-in" },
  { value: "supplement_check", label: "Supplement Check" },
  { value: "plan_renewal", label: "Plan Renewal" },
  { value: "payment_followup", label: "Payment" },
  { value: "client_call", label: "Client Call" },
  { value: "admin", label: "Admin" },
  { value: "general", label: "General" },
];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function kanbanColumn(status) {
  const s = String(status || "").toLowerCase();
  if (s === "carried_forward") return "carried";
  if (["completed", "done"].includes(s)) return "done";
  if (["processing", "in_progress", "in_feedback"].includes(s)) return "progress";
  return "pending";
}

function isDoneStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "completed" || s === "done";
}

function parseDateOnly(d) {
  if (!d) return null;
  const raw = String(d).slice(0, 10);
  const dt = new Date(`${raw}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function dueMeta(dueDate) {
  const due = parseDateOnly(dueDate);
  if (!due) return { text: "—", className: styles.dueNormal };
  const today = startOfToday();
  const diff = Math.round((due - today) / 86400000);
  const label = due.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (diff < 0) {
    const days = Math.abs(diff);
    return { text: `🔴 ${days} day${days === 1 ? "" : "s"} overdue`, className: styles.dueOverdue };
  }
  if (diff === 0) return { text: "⚡ Due today", className: styles.dueToday };
  return { text: label, className: styles.dueNormal };
}

function assigneeName(t) {
  const n = [t.assignee_first_name, t.assignee_last_name].filter(Boolean).join(" ");
  return n || t.assigned_email || "Unassigned";
}

function assigneeInitials(t) {
  const n = assigneeName(t);
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (n[0] || "?").toUpperCase();
}

function userLabel(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `User #${u.id}`;
}

function categoryLine(t) {
  const cat = t.task_category || "general";
  const emoji = CATEGORY_EMOJI[cat] || "✅";
  const label = CATEGORY_LABEL[cat] || cat.replace(/_/g, " ");
  return `${emoji} ${label}`;
}

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function TasksPageContent() {
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();
  const { isLoaded } = useAuth();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [users, setUsers] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [customCategories, setCustomCategories] = useState([]);
  const [viewMode, setViewMode] = useState("kanban");
  const [calOpen, setCalOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [manageOptionsOpen, setManageOptionsOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [listSort, setListSort] = useState({ key: "due_date", dir: "asc" });

  const [searchInput, setSearchInput] = useState("");
  const debouncedQ = useDebounced(searchInput, 350);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [clientFilterQ, setClientFilterQ] = useState("");
  const [clientFilterId, setClientFilterId] = useState("");
  const [clientFilterHits, setClientFilterHits] = useState([]);

  useLayoutEffect(() => {
    if (highlightId) setViewMode("list");
  }, [highlightId]);

  const { highlightedId } = useListHighlight(highlightId, !loading && viewMode === "list", styles.highlighted, {
    idPrefix: "task-row",
  });

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    p.set("my", "true");
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    if (priorityFilter !== "all") p.set("priority", priorityFilter);
    if (typeFilter === "client") p.set("task_type", "client");
    if (typeFilter === "internal") p.set("task_type", "internal");
    if (categoryFilter) p.set("task_category", categoryFilter);
    if (assignTo) p.set("assigned_to", assignTo);
    if (clientFilterId) p.set("client_id", clientFilterId);
    p.set("sort", listSort.key);
    p.set("order", listSort.dir);
    return p;
  }, [
    debouncedQ,
    priorityFilter,
    typeFilter,
    categoryFilter,
    assignTo,
    clientFilterId,
    listSort.key,
    listSort.dir,
  ]);

  const load = useCallback(
    async (silent = false) => {
      if (!isLoaded) return;
      if (!silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const res = await apiFetch(`/tasks?${buildQuery().toString()}`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.message || "Failed to load tasks");
        setItems(Array.isArray(d.data) ? d.data : []);
      } catch (e) {
        if (!silent) {
          setErr(e.message || "Failed to load tasks");
          setItems([]);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [isLoaded, buildQuery]
  );

  useEffect(() => {
    load();
  }, [load]);

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

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const res = await apiFetch("/tasks/custom-options");
        const json = await res.json();
        if (json.success && json.registry?.task_category) {
          setCustomCategories(json.registry.task_category);
        }
      } catch {
        // non-fatal
      }
    })();
  }, [isLoaded]);

  useEffect(() => {
    const q = clientFilterQ.trim();
    if (q.length < 1) {
      setClientFilterHits([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/fitness/clients?search=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) setClientFilterHits(json.data.slice(0, 8));
        else setClientFilterHits([]);
      } catch {
        setClientFilterHits([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientFilterQ]);

  useEffect(() => {
    function onChange() {
      load(true);
    }
    window.addEventListener("crm-tasks-changed", onChange);
    return () => window.removeEventListener("crm-tasks-changed", onChange);
  }, [load]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["tasks:changed", "calendar:changed"], () => load(true));
  }, [isLoaded, load]);

  const stats = useMemo(() => {
    const today = startOfToday();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    let overdue = 0;
    let dueToday = 0;
    let doneWeek = 0;
    let active = 0;
    for (const t of items) {
      const due = parseDateOnly(t.due_date);
      if (!isDoneStatus(t.status)) {
        active += 1;
        if (due) {
          const diff = Math.round((due - today) / 86400000);
          if (diff < 0) overdue += 1;
          if (diff === 0) dueToday += 1;
        }
      }
      if (isDoneStatus(t.status) && t.updated_at) {
        const u = new Date(t.updated_at);
        if (u >= weekAgo) doneWeek += 1;
      }
    }
    return { overdue, dueToday, doneWeek, active };
  }, [items]);

  const byKanban = useMemo(() => {
    const map = { pending: [], progress: [], done: [], carried: [] };
    for (const t of items) {
      map[kanbanColumn(t.status)].push(t);
    }
    return map;
  }, [items]);

  const categoryFilterOpts = useMemo(() => {
    const known = new Set(BASE_CATEGORY_FILTER_OPTS.map((c) => c.value));
    const merged = [...BASE_CATEGORY_FILTER_OPTS];
    for (const c of customCategories) {
      if (!known.has(c.value)) {
        merged.push({ value: c.value, label: c.label });
        known.add(c.value);
      }
    }
    return merged;
  }, [customCategories]);

  const sortedList = useMemo(() => {
    const list = [...items];
    const { key, dir } = listSort;
    const mul = dir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      if (key === "priority") {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.priority] - order[b.priority]) * mul;
      }
      if (key === "created_at") {
        return (new Date(a.created_at) - new Date(b.created_at)) * mul;
      }
      const da = parseDateOnly(a.due_date)?.getTime() || 0;
      const db = parseDateOnly(b.due_date)?.getTime() || 0;
      return (da - db) * mul;
    });
    return list;
  }, [items, listSort]);

  function clearFilters() {
    setSearchInput("");
    setPriorityFilter("all");
    setTypeFilter("all");
    setCategoryFilter("");
    setAssignTo("");
    setClientFilterQ("");
    setClientFilterId("");
    setClientFilterHits([]);
  }

  async function updateTask(id, body, optimisticStatus) {
    const prev = items;
    if (optimisticStatus) {
      setItems((list) =>
        list.map((t) => (t.id === id ? { ...t, status: optimisticStatus } : t))
      );
    }
    try {
      const res = await apiFetch(`/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setItems(prev);
        showToast(json.message || "Update failed", "error");
        return;
      }
      showToast("Task updated");
      load(true);
      window.dispatchEvent(new CustomEvent("crm-tasks-changed"));
    } catch {
      setItems(prev);
      showToast("Network error", "error");
    }
  }

  async function markDone(t) {
    await updateTask(t.id, { status: taskStatusForDb("completed") }, "completed");
  }

  async function carryForward(t) {
    await updateTask(
      t.id,
      { status: taskStatusForDb("carried_forward"), due_date: tomorrowIso() },
      "carried_forward"
    );
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
      showToast("Task deleted");
      load(true);
      window.dispatchEvent(new CustomEvent("crm-tasks-changed"));
    } catch {
      showToast("Network error", "error");
    }
  }

  async function bulkStatus(status) {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await apiFetch("/tasks/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: taskStatusForDb(status) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Bulk update failed", "error");
        return;
      }
      showToast(`Updated ${json.updated || ids.length} task(s)`);
      setSelected(new Set());
      load(true);
      window.dispatchEvent(new CustomEvent("crm-tasks-changed"));
    } catch {
      showToast("Network error", "error");
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      !(await confirm({
        title: "Delete tasks?",
        description: `Delete ${ids.length} selected task(s)?`,
      }))
    ) {
      return;
    }
    for (const id of ids) {
      await apiFetch(`/tasks/${id}`, { method: "DELETE" });
    }
    setSelected(new Set());
    showToast("Tasks deleted");
    load(true);
    window.dispatchEvent(new CustomEvent("crm-tasks-changed"));
  }

  function toggleSort(key) {
    setListSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderCard(t) {
    const due = dueMeta(t.due_date);
    const pri =
      t.priority === "high"
        ? styles.priHigh
        : t.priority === "low"
          ? styles.priLow
          : styles.priMed;

    return (
      <article key={t.id} className={styles.card}>
        <div className={styles.cardTop}>
          <strong className={styles.cardTitle}>{t.title}</strong>
          <span className={`${styles.priBadge} ${pri}`}>{t.priority || "medium"}</span>
        </div>
        <div className={styles.cardCat}>{categoryLine(t)}</div>
        <div className={styles.cardClient}>
          {t.task_type === "internal" || !t.client_id
            ? "🏢 Internal"
            : `👤 ${t.client_name || "Client"}`}
        </div>
        <div className={due.className}>{due.text}</div>
        <div className={styles.cardAssign}>
          <span className={styles.avatar}>{assigneeInitials(t)}</span>
          <span>{assigneeName(t)}</span>
        </div>
        <div className={styles.cardActions}>
          {!isDoneStatus(t.status) ? (
            <button type="button" className={styles.btnDone} onClick={() => markDone(t)}>
              Mark Done ✅
            </button>
          ) : null}
          <div className={styles.menuWrap}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setMenuOpenId(menuOpenId === t.id ? null : t.id)}
              aria-label="More actions"
            >
              ⋮
            </button>
            {menuOpenId === t.id ? (
              <div className={styles.menu}>
                <button
                  type="button"
                  onClick={() => {
                    setEditTask(t);
                    setModalOpen(true);
                    setMenuOpenId(null);
                  }}
                >
                  Edit
                </button>
                <button type="button" onClick={() => { carryForward(t); setMenuOpenId(null); }}>
                  Carry Forward
                </button>
                <button type="button" className={styles.menuDanger} onClick={() => { remove(t); setMenuOpenId(null); }}>
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Tasks</h1>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => {
              setEditTask(null);
              setModalOpen(true);
            }}
          >
            + New Task
          </button>
          <button
            type="button"
            className={styles.btnIcon}
            onClick={() => setManageOptionsOpen(true)}
            title="Manage Custom Options"
          >
            ⚙️
          </button>
          <button
            type="button"
            className={styles.btnIcon}
            onClick={() => setCalOpen((v) => !v)}
            title="Calendar view"
          >
            📅
          </button>
          <div className={styles.viewToggle} role="group">
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === "kanban" ? styles.viewBtnOn : ""}`}
              onClick={() => setViewMode("kanban")}
            >
              ⚏ Kanban
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnOn : ""}`}
              onClick={() => setViewMode("list")}
            >
              ☰ List
            </button>
          </div>
        </div>
      </div>

      {calOpen ? (
        <p className={styles.calHint}>Calendar view opens from the main Calendar page. Use List view for date sorting.</p>
      ) : null}

      <div className={styles.statsRow}>
        <span className={styles.statChip}>🔴 Overdue: {stats.overdue}</span>
        <span className={styles.statChip}>🟡 Due Today: {stats.dueToday}</span>
        <span className={styles.statChip}>🟢 Done This Week: {stats.doneWeek}</span>
        <span className={styles.statChip}>📋 Total Active: {stats.active}</span>
      </div>

      <div className={styles.filters}>
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
        <div className={styles.typeToggle}>
          {[
            { id: "all", label: "All" },
            { id: "client", label: "Client Tasks" },
            { id: "internal", label: "Internal" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`${styles.typeBtn} ${typeFilter === opt.id ? styles.typeBtnOn : ""}`}
              onClick={() => setTypeFilter(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <select
          className={styles.select}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          {categoryFilterOpts.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">All Assign To</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {userLabel(u)}
            </option>
          ))}
        </select>
        <div className={styles.clientFilter}>
          <input
            className={styles.input}
            placeholder="Filter by client…"
            value={clientFilterQ}
            onChange={(e) => {
              setClientFilterQ(e.target.value);
              setClientFilterId("");
            }}
          />
          {clientFilterHits.length > 0 && !clientFilterId ? (
            <ul className={styles.clientHits}>
              {clientFilterHits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setClientFilterId(String(c.id));
                      setClientFilterQ(c.full_name);
                      setClientFilterHits([]);
                    }}
                  >
                    {c.full_name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <input
          className={styles.input}
          placeholder="Search tasks…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="button" className={styles.btnClear} onClick={clearFilters}>
          Clear filters
        </button>
      </div>

      {selected.size > 0 && viewMode === "list" ? (
        <div className={styles.bulkBar}>
          <span>{selected.size} selected</span>
          <button type="button" onClick={() => bulkStatus("completed")}>
            Mark Done
          </button>
          <button type="button" onClick={() => bulkStatus("new")}>
            Mark Pending
          </button>
          <button type="button" className={styles.menuDanger} onClick={bulkDelete}>
            Delete
          </button>
        </div>
      ) : null}

      {err ? (
        <div className={styles.errorBox}>
          {err}{" "}
          <button type="button" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : viewMode === "kanban" ? (
        <div className={styles.kanban}>
          {KANBAN.map((col) => (
            <section key={col.key} className={styles.kanbanCol}>
              <header className={`${styles.kanbanHead} ${col.headClass}`}>{col.title}</header>
              <div className={styles.kanbanBody}>
                {byKanban[col.key].length === 0 ? (
                  <p className={styles.emptyCol}>No tasks</p>
                ) : (
                  byKanban[col.key].map(renderCard)
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Title</th>
                <th>Category</th>
                <th>Client</th>
                <th>
                  <button type="button" className={styles.thBtn} onClick={() => toggleSort("priority")}>
                    Priority
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thBtn} onClick={() => toggleSort("due_date")}>
                    Due Date
                  </button>
                </th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedList.map((t) => {
                const due = dueMeta(t.due_date);
                return (
                  <tr
                    key={t.id}
                    id={`task-row-${t.id}`}
                    className={itemHighlightClass(t.id, highlightedId, styles.highlighted)}
                    onClick={() => {
                      setEditTask(t);
                      setModalOpen(true);
                    }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                      />
                    </td>
                    <td>
                      <strong>{t.title}</strong>
                    </td>
                    <td>{categoryLine(t)}</td>
                    <td>
                      {t.task_type === "internal" || !t.client_id
                        ? "Internal"
                        : t.client_name || "—"}
                    </td>
                    <td>{t.priority}</td>
                    <td className={due.className}>{due.text}</td>
                    <td>{assigneeName(t)}</td>
                    <td>{String(t.status || "").replace(/_/g, " ")}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.btnDone}
                        onClick={() => markDone(t)}
                        disabled={isDoneStatus(t.status)}
                      >
                        Done
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedList.length === 0 ? <p className={styles.muted}>No tasks found.</p> : null}
        </div>
      )}

      <TaskModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditTask(null);
        }}
        task={editTask}
        onSaved={() => load(true)}
      />

      {manageOptionsOpen ? (
        <ManageTaskCustomOptionsModal
          onClose={() => setManageOptionsOpen(false)}
          onDone={() => load(true)}
        />
      ) : null}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageContent />
    </Suspense>
  );
}
