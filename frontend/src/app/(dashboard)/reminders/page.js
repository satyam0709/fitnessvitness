"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "./remindersPage.module.css";

const TYPE_LABELS = {
  general: "General",
  follow_up: "Follow up",
  payment: "Payment",
  meeting: "Meeting",
  customer_reminder: "Customer reminder",
};

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

function personName(r, kind) {
  if (kind === "creator") {
    const n = [r.creator_first_name, r.creator_last_name].filter(Boolean).join(" ");
    return n || r.creator_email || "—";
  }
  const n = [r.assignee_first_name, r.assignee_last_name].filter(Boolean).join(" ");
  return n || r.assignee_email || "—";
}

function toLocalInput(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toSqlDateTime(local) {
  if (!local) return null;
  const s = String(local).replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
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

export default function RemindersPage() {
  const { confirm } = useConfirmDialog();
  const { isLoaded } = useAuth();
  const { open: openQuickCreate } = useQuickCreate();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 350);
  const [createdBy, setCreatedBy] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [calMonth, setCalMonth] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "500");
      params.set("page", "1");
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (createdBy) params.set("created_by", createdBy);
      if (assignTo === "__none__") params.set("assigned_to", "none");
      else if (assignTo) params.set("assigned_to", assignTo);
      if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);

      const res = await apiFetch(`/reminders?${params.toString()}`);
      if (!res.ok) {
        const maybeJson = await res.json().catch(() => null);
        const msg =
          (maybeJson && (maybeJson.message || maybeJson.error)) ||
          (typeof maybeJson === "string" ? maybeJson : null) ||
          res.statusText;
        throw new Error(msg || "Request failed");
      }
      const d = await res.json();
      setItems(Array.isArray(d.reminders) ? d.reminders : []);
      setSelected(new Set());
    } catch (e) {
      setErr(e.message || "Failed to load reminders");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, debouncedSearch, createdBy, assignTo, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener("crm-reminders-changed", onChanged);
    return () => window.removeEventListener("crm-reminders-changed", onChanged);
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

  const allSelected =
    items.length > 0 && items.every((r) => selected.has(String(r.id)));

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((r) => String(r.id))));
  }

  function toggleOne(id) {
    const k = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setCreatedBy("");
    setAssignTo("");
    setTypeFilter("all");
  }

  async function toggleDone(r) {
    const nextDone = !Number(r.is_done);
    try {
      const res = await apiFetch(`/reminders/${r.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_done: nextDone }),
      });
      if (!res.ok) {
        setErr("Could not update reminder");
        return;
      }
      setItems((prev) =>
        prev.map((x) =>
          x.id === r.id ? { ...x, is_done: nextDone ? 1 : 0 } : x
        )
      );
    } catch {
      setErr("Could not update reminder");
    }
  }

  async function removeOne(r) {
    const msg = buildDeleteMessage({ singular: "reminder", name: r.title });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/reminders/${r.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setErr("Could not delete reminder");
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(String(r.id));
        return next;
      });
    } catch {
      setErr("Could not delete reminder");
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const msg = buildDeleteMessage({
      singular: "reminder",
      plural: "reminders",
      count: ids.length,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch("/reminders/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids: ids.map(Number) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Bulk delete failed");
        return;
      }
      await load();
    } catch (e) {
      setErr(e.message || "Bulk delete failed");
    }
  }

  const stats = useMemo(() => {
    const byType = {};
    let open = 0;
    let done = 0;
    const now = Date.now();
    let upcoming = 0;
    for (const r of items) {
      const t = r.reminder_type || "general";
      byType[t] = (byType[t] || 0) + 1;
      if (Number(r.is_done)) done += 1;
      else {
        open += 1;
        const ts = r.remind_at ? new Date(r.remind_at).getTime() : 0;
        if (ts >= now) upcoming += 1;
      }
    }
    return { byType, open, done, upcoming, total: items.length };
  }, [items]);

  const calendarDays = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - startPad);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    const key = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const map = {};
    for (const r of items) {
      if (!r.remind_at || Number(r.is_done)) continue;
      const dt = new Date(r.remind_at);
      if (Number.isNaN(dt.getTime())) continue;
      const k = key(dt);
      map[k] = (map[k] || 0) + 1;
    }
    return { days, map, y, m };
  }, [calMonth, items]);

  const today = new Date();
  const isToday = (d) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.titleAccent}>Reminders</span>
          </h1>
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.searchWrap}>
            <i className={`fas fa-search ${styles.searchIcon}`} aria-hidden />
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search reminders"
            />
          </div>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnAccent}`}
            title="Add reminder"
            aria-label="Add reminder"
            onClick={() => openQuickCreate("reminder")}
          >
            <i className="fas fa-plus" />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="Clear search and filters"
            aria-label="Clear"
            onClick={clearFilters}
          >
            <i className="fas fa-times" style={{ color: "var(--rm-danger)" }} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnAccent}`}
            title="Calendar view"
            aria-label="Calendar view"
            onClick={() => setCalendarOpen(true)}
          >
            <i className="fas fa-calendar-alt" />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnAccent}`}
            title="Analytics"
            aria-label="Analytics"
            onClick={() => setAnalyticsOpen(true)}
          >
            <i className="fas fa-chart-line" />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="Delete selected"
            aria-label="Delete selected"
            disabled={selected.size === 0}
            onClick={bulkDelete}
          >
            <i className="fas fa-trash-alt" />
          </button>
        </div>
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Created by</span>
          <div className={styles.filterControl}>
            <select
              className={styles.select}
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              aria-label="Filter by creator"
            >
              <option value="">All reminders</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            {createdBy ? (
              <button
                type="button"
                className={styles.clearMini}
                aria-label="Clear created by"
                onClick={() => setCreatedBy("")}
              >
                <i className="fas fa-times" />
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Assign to</span>
          <div className={styles.filterControl}>
            <select
              className={styles.select}
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              aria-label="Filter by assignee"
            >
              <option value="">All reminders</option>
              <option value="__none__">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            {assignTo ? (
              <button
                type="button"
                className={styles.clearMini}
                aria-label="Clear assign to"
                onClick={() => setAssignTo("")}
              >
                <i className="fas fa-times" />
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Type</span>
          <div className={styles.filterControl}>
            <select
              className={styles.select}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="all">All</option>
              {Object.entries(TYPE_LABELS).map(([k, lab]) => (
                <option key={k} value={k}>
                  {lab}
                </option>
              ))}
            </select>
            {typeFilter !== "all" ? (
              <button
                type="button"
                className={styles.clearMini}
                aria-label="Clear type"
                onClick={() => setTypeFilter("all")}
              >
                <i className="fas fa-times" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {err ? (
        <div className={styles.errorBox}>
          {err}{" "}
          <button type="button" className={styles.btnGhost} onClick={load}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>There are no records to display.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Title / description</th>
                <th>Date &amp; time</th>
                <th>Status</th>
                <th>Created by</th>
                <th>Assign to</th>
                <th>Type</th>
                <th>Lead</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(String(r.id))}
                      onChange={() => toggleOne(r.id)}
                      aria-label={`Select ${r.title}`}
                    />
                  </td>
                  <td>
                    <div className={styles.cellTitle}>{r.title}</div>
                    {r.note ? (
                      <div className={styles.cellMeta} title={r.note}>
                        {r.note.length > 120 ? `${r.note.slice(0, 120)}…` : r.note}
                      </div>
                    ) : null}
                  </td>
                  <td>{fmt(r.remind_at)}</td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        Number(r.is_done) ? styles.pillDone : styles.pillOpen
                      }`}
                    >
                      {Number(r.is_done) ? "Done" : "Open"}
                    </span>
                  </td>
                  <td>{personName(r, "creator")}</td>
                  <td>
                    {r.assigned_to_user_id
                      ? personName(r, "assignee")
                      : "—"}
                  </td>
                  <td>
                    {TYPE_LABELS[r.reminder_type] ||
                      TYPE_LABELS.general}
                  </td>
                  <td>{r.lead_name || "—"}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!Number(r.is_done)}
                          onChange={() => toggleDone(r)}
                        />
                        Done
                      </label>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => setEditRow(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                        onClick={() => removeOne(r)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className={styles.footer}>
        COPYRIGHT © {new Date().getFullYear()} 365 RND CRM, All rights Reserved.
      </footer>

      {calendarOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setCalendarOpen(false)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="cal-title" className={styles.modalTitle}>
                Reminder calendar
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setCalendarOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.calNav}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() =>
                    setCalMonth(
                      new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1)
                    )
                  }
                >
                  ←
                </button>
                <strong>
                  {calMonth.toLocaleString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() =>
                    setCalMonth(
                      new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)
                    )
                  }
                >
                  →
                </button>
              </div>
              <div className={styles.calGrid}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className={styles.calDow}>
                    {d}
                  </div>
                ))}
                {calendarDays.days.map((d, i) => {
                  const muted = d.getMonth() !== calendarDays.m;
                  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  const n = calendarDays.map[k] || 0;
                  return (
                    <div
                      key={i}
                      className={`${styles.calCell} ${
                        muted ? styles.calCellMuted : ""
                      } ${isToday(d) ? styles.calCellToday : ""}`}
                    >
                      <span>{d.getDate()}</span>
                      {n > 0 ? <span className={styles.calDot} title={`${n} open`} /> : null}
                    </div>
                  );
                })}
              </div>
              <p className={styles.muted} style={{ marginTop: 16, fontSize: 13 }}>
                Dots show open reminders scheduled that day (month view).
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {analyticsOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setAnalyticsOpen(false)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="an-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="an-title" className={styles.modalTitle}>
                Reminder analytics
              </h2>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setAnalyticsOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.statGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statVal}>{stats.total}</div>
                  <div className={styles.statLab}>In current list</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statVal}>{stats.open}</div>
                  <div className={styles.statLab}>Open</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statVal}>{stats.done}</div>
                  <div className={styles.statLab}>Done</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statVal}>{stats.upcoming}</div>
                  <div className={styles.statLab}>Upcoming (open)</div>
                </div>
              </div>
              <p className={styles.filterLabel} style={{ marginBottom: 10 }}>
                By type
              </p>
              {Object.keys(stats.byType).length === 0 ? (
                <p className={styles.muted}>No data.</p>
              ) : (
                Object.entries(stats.byType).map(([k, n]) => {
                  const pct =
                    stats.total > 0 ? Math.round((n / stats.total) * 100) : 0;
                  return (
                    <div key={k} className={styles.barRow}>
                      <span style={{ width: 120 }}>
                        {TYPE_LABELS[k] || k}
                      </span>
                      <div className={styles.barTrack}>
                        <div
                          className={styles.barFill}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span>{n}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editRow ? (
        <EditReminderModal
          row={editRow}
          users={users}
          onClose={() => setEditRow(null)} onSaved={() => {
            setEditRow(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function EditReminderModal({ row, users, onClose, onSaved }) {
  const [title, setTitle] = useState(row.title || "");
  const [note, setNote] = useState(row.note || "");
  const [remindAt, setRemindAt] = useState(toLocalInput(row.remind_at));
  const [assignTo, setAssignTo] = useState(
    row.assigned_to_user_id ? String(row.assigned_to_user_id) : ""
  );
  const [reminderType, setReminderType] = useState(
    row.reminder_type || "general"
  );
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setLocalErr("");
    if (!title.trim()) {
      setLocalErr("Title is required.");
      return;
    }
    const sqlDt = toSqlDateTime(remindAt);
    if (!sqlDt) {
      setLocalErr("Date & time is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/reminders/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: title.trim(),
          note: note.trim() || null,
          remind_at: sqlDt,
          lead_id: row.lead_id,
          is_done: !!Number(row.is_done),
          assigned_to_user_id: assignTo ? Number(assignTo) : null,
          reminder_type: reminderType,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        setLocalErr(json.message || "Could not save");
        return;
      }
      onSaved();
    } catch {
      setLocalErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ed-title"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className={styles.modalHeader}>
            <h2 id="ed-title" className={styles.modalTitle}>
              Edit reminder
            </h2>
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className={styles.modalBody}>
            {localErr ? <div className={styles.errorBox}>{localErr}</div> : null}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="er-title">
                Title
              </label>
              <input
                id="er-title"
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="er-note">
                Description
              </label>
              <textarea
                id="er-note"
                className={styles.textarea}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="er-dt">
                Date &amp; time
              </label>
              <input
                id="er-dt"
                className={styles.input}
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="er-as">
                Assign to
              </label>
              <select
                id="er-as"
                className={styles.select}
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="er-ty">
                Type
              </label>
              <select
                id="er-ty"
                className={styles.select}
                value={reminderType}
                onChange={(e) => setReminderType(e.target.value)}
                style={{ width: "100%" }}
              >
                {Object.entries(TYPE_LABELS).map(([k, lab]) => (
                  <option key={k} value={k}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
