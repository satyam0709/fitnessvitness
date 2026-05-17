"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, getApiOrigin, publicFileUrl } from "@/lib/api";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useToast } from "@/components/Toast/ToastContext";
import { useListHighlight, itemHighlightClass } from "@/lib/useListHighlight";
import styles from "./todos.module.css";

const TABS = [
  { id: "all", label: "All Todo", scope: "all" },
  { id: "today", label: "Today's Todo", scope: "today" },
  { id: "pending", label: "Pending Todo", scope: "pending" },
  { id: "recursive", label: "Recursive Todo", scope: "recursive" },
];

const FREQ_FILTER = [
  { value: "", label: "All Type" },
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "yearly", label: "Yearly" },
];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN");
  } catch {
    return String(d);
  }
}

function assigneeLine(t) {
  const list = t.assignees || [];
  if (!list.length) return "—";
  return list
    .map((u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email)
    .join(", ");
}

function TodosPageContent() {
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();
  const { open: openQuick } = useQuickCreate();
  const { isLoaded } = useAuth();
  const { me } = useUserRole();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("today");
  const [searchInput, setSearchInput] = useState("");
  const debouncedQ = useDebounced(searchInput, 350);
  const [createdBy, setCreatedBy] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [freqFilter, setFreqFilter] = useState("");
  const [users, setUsers] = useState([]);
  const [live, setLive] = useState(false);
  const loadRef = useRef(() => {});
  const highlightTabSwitched = useRef(false);

  const tabMeta = useMemo(() => TABS.find((t) => t.id === tab) || TABS[0], [tab]);

  const loadTodos = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const p = new URLSearchParams();
      p.set("scope", tabMeta.scope);
      if (statusFilter && tabMeta.scope !== "pending") {
        if (statusFilter === "pending" || statusFilter === "completed") {
          p.set("status", statusFilter);
        }
      } else if (tabMeta.scope === "pending") {
        p.set("status", "pending");
      }
      if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
      if (createdBy) p.set("created_by", createdBy);
      if (assignTo) p.set("assigned_to", assignTo);
      if (freqFilter) p.set("frequency", freqFilter);

      const res = await apiFetch(`/todos?${p.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) setItems(json.data || []);
      else {
        setItems([]);
        setLoadError(json.message || "Could not load todos");
      }
    } catch {
      setItems([]);
      setLoadError("Could not load todos");
    } finally {
      setLoading(false);
    }
  }, [tabMeta.scope, debouncedQ, createdBy, assignTo, statusFilter, freqFilter]);

  loadRef.current = loadTodos;

  useEffect(() => {
    if (!isLoaded) return;
    loadTodos();
  }, [isLoaded, loadTodos]);

  useEffect(() => {
    function onEvt() {
      loadRef.current?.();
    }
    window.addEventListener("crm-todos-changed", onEvt);
    return () => window.removeEventListener("crm-todos-changed", onEvt);
  }, []);

  useEffect(() => {
    if (!isLoaded) return undefined;
    let cancelled = false;
    let sock;

    async function connect() {
      if (cancelled) return;
      try {
        const { io } = await import("socket.io-client");
        sock = io(getApiOrigin(), {
          path: "/socket.io",
          auth: {},
          transports: ["websocket", "polling"],
          withCredentials: true,
          reconnection: true,
        });
        sock.on("connect", () => {
          if (!cancelled) setLive(true);
        });
        sock.on("disconnect", () => {
          if (!cancelled) setLive(false);
        });
        sock.on("todos:changed", () => {
          if (!cancelled) loadRef.current?.();
        });
      } catch {
        if (!cancelled) setLive(false);
      }
    }
    connect();

    return () => {
      cancelled = true;
      try {
        sock?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const res = await apiFetch("/users");
        const j = await res.json();
        if (j.success && Array.isArray(j.data)) setUsers(j.data.filter((u) => u.is_active !== 0));
      } catch {
        setUsers([]);
      }
    })();
  }, [isLoaded]);

  const byPriority = useMemo(() => {
    const hi = [];
    const med = [];
    const lo = [];
    for (const t of items) {
      const p = String(t.priority || "").toLowerCase();
      if (p === "high") hi.push(t);
      else if (p === "low") lo.push(t);
      else med.push(t);
    }
    return { high: hi, medium: med, low: lo };
  }, [items]);

  const highlightPriority = useMemo(() => {
    if (!highlightId) return null;
    const id = String(highlightId);
    const t = items.find((x) => String(x.id) === id);
    if (!t) return null;
    const p = String(t.priority || "").toLowerCase();
    if (p === "high") return "high";
    if (p === "low") return "low";
    return "medium";
  }, [highlightId, items]);

  const { highlightedId, scrollToHighlight } = useListHighlight(
    highlightId,
    !loading,
    styles.highlighted,
    {
      beforeScroll: () => {
        if (!highlightPriority) return;
        document.getElementById(`col-${highlightPriority}`)?.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      },
    }
  );

  useEffect(() => {
    if (!highlightId || loading || highlightTabSwitched.current) return;
    const found = items.some((x) => String(x.id) === String(highlightId));
    if (!found && tab !== "all") {
      highlightTabSwitched.current = true;
      setTab("all");
    }
  }, [highlightId, loading, items, tab]);

  function jumpToHighlighted() {
    scrollToHighlight();
  }

  async function toggleDone(todo) {
    const done = todo.status === "completed";
    const next = done ? "pending" : "completed";
    try {
      const res = await apiFetch(`/todos/${todo.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        showToast("Could not update todo", "error");
        return;
      }
      await loadTodos();
    } catch (e) {
      showToast("Could not update todo", "error");
    }
  }

  async function removeTodo(todo) {
    const msg = buildDeleteMessage({ singular: "todo", name: todo.body?.slice(0, 40) });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/todos/${todo.id}`, { method: "DELETE" });
      if (!res.ok) {
        showToast("Could not delete todo", "error");
        return;
      }
      showToast("Todo deleted");
      await loadTodos();
    } catch {
      showToast("Could not delete todo", "error");
    }
  }

  function renderColumn(key, label, className, list, activeHighlightId) {
    return (
      <div className={styles.col} key={key} id={`col-${key}`}>
        <div className={`${styles.colHead} ${className}`}>
          <i className={`fas ${key === "high" ? "fa-arrow-up" : key === "low" ? "fa-arrow-down" : "fa-square"}`} />
          {label} ({list.length})
        </div>
        <div className={styles.colBody}>
          {loading ? (
            <div className={styles.emptyCol}>Loading…</div>
          ) : list.length === 0 ? (
            <div className={styles.emptyCol}>
              <i className="fas fa-clipboard-list" />
              There Are No ToDos to Display
            </div>
          ) : (
            list.map((t) => (
              <div
                key={t.id}
                id={`item-${t.id}`}
                className={`${styles.card} ${itemHighlightClass(t.id, activeHighlightId, styles.highlighted)}`}
              >
                <button
                  type="button"
                  className={`${styles.check} ${t.status === "completed" ? styles.checkDone : ""}`}
                  onClick={() => toggleDone(t)}
                  aria-label="Toggle done"
                >
                  {t.status === "completed" ? <i className="fas fa-check" /> : null}
                </button>
                <div className={styles.cardMain}>
                  <div className={styles.cardText}>{t.body}</div>
                  <div className={styles.meta}>
                    Due {fmtDate(t.todo_date)}
                    {t.carry_forward ? " · Carry forward" : ""}
                    {" · "}
                    {assigneeLine(t)}
                  </div>
                  <span className={styles.badge}>{String(t.frequency || "once").replace(/_/g, " ")}</span>
                  {(t.attachments || []).length > 0 && (
                    <div className={styles.meta}>
                      <a href={publicFileUrl(t.attachments[0])} target="_blank" rel="noreferrer">
                        Attachment
                      </a>
                    </div>
                  )}
                </div>
                {me?.id && t.created_by === me.id ? (
                  <button type="button" className={styles.del} onClick={() => removeTodo(t)} aria-label="Delete">
                    <i className="fas fa-trash" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Todo</h1>
        <div className={styles.toolbar}>
          {live ? <span className={styles.live}>● Live</span> : null}
          <input
            className={styles.search}
            placeholder="Search Here"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setSearchInput("")}>
            <i className="fas fa-times" />
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openQuick("todo")}>
            <i className="fas fa-plus" />
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        <select className={styles.select} value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
          <option value="">All Created By</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>
        <select className={styles.select} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">All Assign To</option>
          {users.map((u) => (
            <option key={`a-${u.id}`} value={String(u.id)}>
              {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Status (all)</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </select>
        <select className={styles.select} value={freqFilter} onChange={(e) => setFreqFilter(e.target.value)}>
          {FREQ_FILTER.map((f) => (
            <option key={f.value || "all"} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {highlightId ? (
        <button type="button" className={styles.jumpHighlight} onClick={jumpToHighlighted}>
          📌 Jump to highlighted task
        </button>
      ) : null}

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.board}>
        {loadError ? (
          <div className={styles.emptyCol}>
            {loadError}{" "}
            <button type="button" className={styles.btn} onClick={loadTodos}>
              Try again
            </button>
          </div>
        ) : null}
        {renderColumn("high", "High Priority", styles.colHigh, byPriority.high, highlightedId)}
        {renderColumn("medium", "Medium Priority", styles.colMed, byPriority.medium, highlightedId)}
        {renderColumn("low", "Low Priority", styles.colLow, byPriority.low, highlightedId)}
      </div>
    </div>
  );
}

export default function TodosPage() {
  return (
    <Suspense fallback={null}>
      <TodosPageContent />
    </Suspense>
  );
}
