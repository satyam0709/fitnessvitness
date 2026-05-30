"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, getApiBase, getApiOrigin } from "@/lib/api";
import MeetingFormModal from "@/components/Meetings/MeetingFormModal";
import MeetingDateRangeModal from "@/components/Meetings/MeetingDateRangeModal";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useListHighlight, itemHighlightClass } from "@/lib/useListHighlight";
import styles from "./meetings.module.css";

/** Recurrence filter (matches Add Meeting + DB column `recurrence`) */
const RECURRENCE_OPTS = [
  { value: "", label: "All" },
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "yearly", label: "Yearly" },
];

/** 365-style status groups → API `status_group` */
const STATUS_GROUP_OPTS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "missing", label: "Missing" },
];

const FORMAT_OPTS = [
  { value: "", label: "All formats" },
  { value: "virtual", label: "Virtual" },
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

const ROW_STATUS_OPTS = [
  { value: "scheduled", label: "Pending" },
  { value: "postponed", label: "Postponed" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "Missing" },
  { value: "cancelled", label: "Cancelled" },
];

function fmt(dt) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(dt);
  }
}

function userLabel(u) {
  if (!u) return "—";
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `#${u.id}`;
}

function typeBadgeClass(t) {
  const k = String(t || "").toLowerCase();
  if (k === "virtual") return styles.typeVirtual;
  if (k === "in_person") return styles.typePerson;
  if (k === "phone") return styles.typePhone;
  return styles.typeOther;
}

function formatRecurrence(r) {
  const k = String(r || "once").toLowerCase();
  const o = RECURRENCE_OPTS.find((x) => x.value === k);
  return o ? o.label : k.replace("_", " ");
}

function statusDisplay(s) {
  const m = {
    scheduled: "Pending",
    postponed: "Postponed",
    completed: "Completed",
    no_show: "Missing",
    cancelled: "Cancelled",
  };
  return m[String(s || "").toLowerCase()] || s || "—";
}

function MeetingsPageContent() {
  const { confirm } = useConfirmDialog();
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [meId, setMeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [filterCreatedBy, setFilterCreatedBy] = useState("");
  const [filterAssignTo, setFilterAssignTo] = useState("");
  const [filterRecurrence, setFilterRecurrence] = useState("");
  const [filterStatusGroup, setFilterStatusGroup] = useState("");
  const [filterFormat, setFilterFormat] = useState("");
  const [filterLeadId, setFilterLeadId] = useState("");
  const [dateRange, setDateRange] = useState(null);
  const [leads, setLeads] = useState([]);

  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("highlight") ? "list" : "list";
  });
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [alertMessage, setAlertMessage] = useState(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [realtimeToast, setRealtimeToast] = useState(null);
  const toastClearRef = useRef(null);

  const [selected, setSelected] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);

  const loadRef = useRef(() => {});

  useLayoutEffect(() => {
    if (highlightId) setViewMode("list");
  }, [highlightId]);

  const { highlightedId } = useListHighlight(
    highlightId,
    !loading && viewMode === "list",
    styles.highlighted
  );

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "200");
    p.set("page", "1");
    if (searchDebounced) p.set("search", searchDebounced);
    if (filterCreatedBy) p.set("created_by", filterCreatedBy);
    if (filterAssignTo) p.set("assign_to", filterAssignTo);
    if (filterRecurrence) p.set("recurrence", filterRecurrence);
    if (filterStatusGroup) p.set("status_group", filterStatusGroup);
    if (filterFormat) p.set("meeting_type", filterFormat);
    if (filterLeadId) p.set("lead_id", filterLeadId);
    if (dateRange?.range_start) p.set("range_start", dateRange.range_start);
    if (dateRange?.range_end) p.set("range_end", dateRange.range_end);
    return p.toString();
  }, [
    searchDebounced,
    filterCreatedBy,
    filterAssignTo,
    filterRecurrence,
    filterStatusGroup,
    filterFormat,
    filterLeadId,
    dateRange,
  ]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const [meRes, meetRes, uRes, lRes] = await Promise.all([
        apiFetch("/users/me"),
        apiFetch(`/meetings?${queryString}`),
        apiFetch("/users"),
        apiFetch("/leads?limit=300"),
      ]);
      if (meRes.ok) {
        const me = await meRes.json();
        setMeId(me.data?.id ?? null);
      }
      if (uRes.ok) {
        const j = await uRes.json();
        if (j.success && Array.isArray(j.data)) setUsers(j.data.filter((u) => u.is_active !== 0));
      }
      if (lRes.ok) {
        const j = await lRes.json().catch(() => ({}));
        if (j.success && Array.isArray(j.data)) setLeads(j.data);
        else setLeads([]);
      }
      if (!meetRes.ok) {
        const t = await meetRes.text();
        throw new Error(t || meetRes.statusText);
      }
      const d = await meetRes.json();
      setItems(Array.isArray(d.meetings) ? d.meetings : []);
      setTotal(Number(d.total) || 0);
    } catch (e) {
      setErr(e.message || "Failed to load meetings");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, queryString]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!isLoaded) {
      setLiveConnected(false);
      return;
    }
    if (isSignedIn === false) {
      setLiveConnected(false);
      return;
    }
    let cancelled = false;
    const sockRef = { current: null };
    let retryTimer;

    function cleanupSocket() {
      if (sockRef.current) {
        try {
          sockRef.current.removeAllListeners();
          sockRef.current.disconnect();
        } catch {
          /* ignore */
        }
        sockRef.current = null;
      }
    }

    function showRealtimeToast(msg) {
      if (cancelled) return;
      if (toastClearRef.current) clearTimeout(toastClearRef.current);
      setRealtimeToast(msg);
      toastClearRef.current = setTimeout(() => {
        setRealtimeToast(null);
        toastClearRef.current = null;
      }, 4000);
    }

    async function connectOnce() {
      if (cancelled || !isSignedIn) return false;

      try {
        const { io } = await import("socket.io-client");
        cleanupSocket();
        const s = io(getApiOrigin(), {
          path: "/socket.io",
          auth: {},
          transports: ["websocket", "polling"],
          withCredentials: true,
          reconnection: true,
          reconnectionAttempts: 12,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
        });
        sockRef.current = s;

        s.io.on("reconnect_attempt", async () => {
          /* cookie session */
        });

        s.on("connect", () => {
          if (!cancelled) setLiveConnected(true);
        });
        s.on("disconnect", () => {
          if (!cancelled) setLiveConnected(false);
        });
        s.on("connect_error", () => {
          if (!cancelled) setLiveConnected(false);
        });
        s.on("meetings:changed", () => {
          if (cancelled) return;
          loadRef.current?.();
        });
        return true;
      } catch {
        if (!cancelled) setLiveConnected(false);
        return false;
      }
    }

    async function connectLoop(attempt = 0) {
      if (cancelled) return;
      const ok = await connectOnce();
      if (cancelled) return;
      if (!ok && attempt < 30) {
        retryTimer = setTimeout(() => connectLoop(attempt + 1), 400);
      }
    }

    connectLoop();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (toastClearRef.current) clearTimeout(toastClearRef.current);
      setLiveConnected(false);
      cleanupSocket();
    };
  }, [isLoaded, isSignedIn]);

  function clearFilters() {
    setSearchInput("");
    setSearchDebounced("");
    setFilterCreatedBy("");
    setFilterAssignTo("");
    setFilterRecurrence("");
    setFilterStatusGroup("");
    setFilterFormat("");
    setFilterLeadId("");
    setDateRange(null);
  }

  const allSelected = items.length > 0 && items.every((m) => selected.has(m.id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((m) => m.id)));
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function exportCsv() {
    try {
      const url = `${getApiBase()}/meetings/export?${queryString}`;
      const res = await fetch(url, { credentials: "include",  headers: { "Content-Type": "application/json" } });
      if (!res.ok) {
        const t = await res.text();
        window.alert(t || "Export failed");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "meetings-export.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      window.alert(e.message || "Export failed");
    }
  }

  async function openStats() {
    setStats(null);
    setStatsOpen(true);
    try {
      const res = await apiFetch(`/meetings/stats?${queryString}`);
      const j = await res.json();
      if (j.success && j.stats) setStats(j.stats);
    } catch {
      setStats({});
    }
  }

  function openBulkAssign() {
    if (selected.size === 0) {
      setAlertMessage("Please Select Meeting");
      return;
    }
    setAssignUserId("");
    setAssignOpen(true);
  }

  async function submitBulkAssign() {
    if (!assignUserId) {
      setAlertMessage("Please select a team member to assign.");
      return;
    }
    const ids = [...selected];
    try {
      const res = await apiFetch("/meetings/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, assigned_to_user_id: Number(assignUserId) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        window.alert(j.message || "Assign failed");
        return;
      }
      setAssignOpen(false);
      setSelected(new Set());
      load();
    } catch (e) {
      window.alert(e.message || "Assign failed");
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const msg = buildDeleteMessage({
      singular: "meeting",
      name: `${ids.length} meeting(s)`,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch("/meetings/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        window.alert(j.message || "Delete failed");
        return;
      }
      setSelected(new Set());
      load();
    } catch (e) {
      window.alert(e.message || "Delete failed");
    }
  }

  async function removeOne(m) {
    if (meId == null || m.organizer_id !== meId) {
      window.alert("Only the meeting organizer can delete this meeting.");
      return;
    }
    const msg = buildDeleteMessage({ singular: "meeting", name: m.title });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/meetings/${m.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success === false) {
        window.alert(j.message || "Could not delete");
        return;
      }
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(m.id);
        return n;
      });
      load();
    } catch (e) {
      window.alert(e.message || "Could not delete");
    }
  }

  async function updateRowStatus(m, newStatus) {
    if (meId == null || m.organizer_id !== meId) {
      window.alert("Only the organizer can change meeting status.");
      return;
    }
    const attendeeIds = m.attendee_ids_csv
      ? String(m.attendee_ids_csv)
          .split(",")
          .filter(Boolean)
          .map(Number)
      : [];
    try {
      const res = await apiFetch(`/meetings/${m.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: m.title,
          description: m.description,
          start_time: m.start_time,
          end_time: m.end_time || null,
          location: m.location,
          meet_link: m.meet_link,
          lead_id: m.lead_id,
          meeting_type: m.meeting_type || "virtual",
          recurrence:
            m.recurrence != null && String(m.recurrence).trim() !== ""
              ? String(m.recurrence).toLowerCase()
              : "once",
          status: newStatus,
          assigned_to_user_id: m.assigned_to_user_id != null ? m.assigned_to_user_id : m.organizer_id,
          attendees: attendeeIds,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        window.alert(j.message || "Could not update status");
        return;
      }
      load();
    } catch (e) {
      window.alert(e.message || "Could not update status");
    }
  }

  const userById = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const dateRangeLabel = useMemo(() => {
    if (!dateRange?.range_start || !dateRange?.range_end) return "";
    try {
      const a = new Date(String(dateRange.range_start).replace(" ", "T"));
      const b = new Date(String(dateRange.range_end).replace(" ", "T"));
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
      const o = { dateStyle: "medium" };
      return `${a.toLocaleDateString(undefined, o)} – ${b.toLocaleDateString(undefined, o)}`;
    } catch {
      return "";
    }
  }, [dateRange]);

  const meetingsByDay = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!it.start_time) continue;
      const d = new Date(it.start_time);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className={styles.wrap}>
      <div className={styles.headRow}>
        <div>
          <h1 className={styles.title}>
            Meetings
          </h1>
        </div>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            type="button"
            className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <i className="fas fa-list" />
          </button>
          <button
            type="button"
            className={`${styles.viewBtn} ${viewMode === "calendar" ? styles.viewBtnActive : ""}`}
            onClick={() => setViewMode("calendar")}
            title="Calendar view"
          >
            <i className="fas fa-calendar-alt" />
          </button>
        </div>
      </div>

      <div className={styles.toolbarRows}>
        <div className={styles.toolbarRow}>
          <div className={styles.filterTags}>
            <div className={styles.filterTagBlock}>
              <span className={styles.filterLabel}>Created by</span>
              <div className={styles.tagRow}>
                {filterCreatedBy ? (
                  <span className={styles.filterTag}>
                    {userLabel(userById.get(Number(filterCreatedBy)))}
                    <button
                      type="button"
                      className={styles.filterTagX}
                      aria-label="Clear created by"
                      onClick={() => setFilterCreatedBy("")}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span className={styles.filterTagMuted}>All meetings</span>
                )}
                <select
                  className={styles.filterSelectInline}
                  value={filterCreatedBy}
                  onChange={(e) => setFilterCreatedBy(e.target.value)}
                  aria-label="Created by"
                >
                  <option value="">All meetings</option>
                  {users.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.filterTagBlock}>
              <span className={styles.filterLabel}>Assign to</span>
              <div className={styles.tagRow}>
                {filterAssignTo ? (
                  <span className={styles.filterTag}>
                    {userLabel(userById.get(Number(filterAssignTo)))}
                    <button
                      type="button"
                      className={styles.filterTagX}
                      aria-label="Clear assign to"
                      onClick={() => setFilterAssignTo("")}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <span className={styles.filterTagMuted}>All meetings</span>
                )}
                <select
                  className={styles.filterSelectInline}
                  value={filterAssignTo}
                  onChange={(e) => setFilterAssignTo(e.target.value)}
                  aria-label="Assign to"
                >
                  <option value="">All meetings</option>
                  {users.map((u) => (
                    <option key={`a-${u.id}`} value={String(u.id)}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className={styles.searchWrap}>
            <input
              className={styles.searchInput}
              placeholder="Search…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search meetings"
            />
          </div>
          <div className={styles.iconGroup}>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
              title="Add meeting"
              onClick={() => setAddOpen(true)}
            >
              <i className="fas fa-plus" aria-hidden />
            </button>
            <button type="button" className={styles.iconBtn} title="Clear filters" onClick={clearFilters}>
              <i className="fas fa-times" style={{ color: "#dc2626" }} aria-hidden />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} ${dateRange ? styles.iconBtnActive : ""}`}
              title="Date range"
              onClick={() => setDateModalOpen(true)}
            >
              <i className="fas fa-briefcase" aria-hidden />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title="Assign to"
              aria-label="Assign to"
              onClick={openBulkAssign}
            >
              <i className="fas fa-chart-line" aria-hidden />
            </button>
            <button type="button" className={styles.iconBtn} title="Meeting report" onClick={openStats}>
              <i className="fas fa-chart-bar" aria-hidden />
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              title="Delete selected"
              disabled={selected.size === 0}
              onClick={bulkDelete}
            >
              <i className="fas fa-trash" aria-hidden />
            </button>
          </div>
        </div>
        <div className={styles.toolbarSub}>
          {dateRangeLabel ? (
            <span className={styles.rangeChip}>
              Date: {dateRangeLabel}
              <button
                type="button"
                className={styles.rangeChipX}
                aria-label="Clear date range"
                onClick={() => setDateRange(null)}
              >
                ×
              </button>
            </span>
          ) : null}
          <button type="button" className={styles.linkExport} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Type</span>
          <select
            className={styles.filterSelect}
            value={filterRecurrence}
            onChange={(e) => setFilterRecurrence(e.target.value)}
          >
            {RECURRENCE_OPTS.map((o) => (
              <option key={o.value || "all-rec"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.filterSelect}
            value={filterStatusGroup}
            onChange={(e) => setFilterStatusGroup(e.target.value)}
          >
            {STATUS_GROUP_OPTS.map((o) => (
              <option key={o.value || "all-sg"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Format</span>
          <select className={styles.filterSelect} value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}>
            {FORMAT_OPTS.map((o) => (
              <option key={o.value || "all-fmt"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>Lead</span>
          <select
            className={styles.filterSelect}
            value={filterLeadId}
            onChange={(e) => setFilterLeadId(e.target.value)}
            aria-label="Filter by lead"
          >
            <option value="">All leads</option>
            {leads.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {(l.name || "Lead") + (l.phone ? ` · ${l.phone}` : "")}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={styles.clearChip} onClick={clearFilters}>
          Clear filters
        </button>
      </div>

      {err && (
        <div className={styles.errorBox}>
          <div>{err}</div>
          <button type="button" className={styles.btnCancel} onClick={load}>
            Try again
          </button>
        </div>
      )}

      {realtimeToast ? (
        <div className={styles.realtimeToast} role="status" aria-live="polite">
          {realtimeToast}
        </div>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>There are no records to display.</div>
      ) : viewMode === "calendar" ? (
        <div className={styles.calendarPanel}>
          {meetingsByDay.map(([day, list]) => (
            <section key={day} className={styles.calendarDay}>
              <h3 className={styles.calendarDayTitle}>{day}</h3>
              <ul className={styles.calendarList}>
                {list.map((m) => (
                  <li key={m.id} className={styles.calendarItem}>
                    <span className={styles.mono}>{fmt(m.start_time)}</span>
                    <strong>{m.title}</strong>
                    <span className={styles.muted}> · {statusDisplay(m.status)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Title</th>
                <th>Type</th>
                <th>Format</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
                <th>Created by</th>
                <th>Assign to</th>
                <th>Lead</th>
                <th>Att.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const canManage = meId != null && m.organizer_id === meId;
                const org = userById.get(m.organizer_id);
                const asg = m.assigned_to_user_id != null ? userById.get(m.assigned_to_user_id) : org;
                return (
                  <tr
                    key={m.id}
                    id={`item-${m.id}`}
                    className={itemHighlightClass(m.id, highlightedId, styles.highlighted)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleOne(m.id)}
                        aria-label={`Select ${m.title}`}
                      />
                    </td>
                    <td>
                      <strong>{m.title}</strong>
                      {m.location ? (
                        <div className={styles.muted} style={{ marginTop: 2 }}>
                          {m.location}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={styles.badgeRec}>{formatRecurrence(m.recurrence)}</span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${typeBadgeClass(m.meeting_type)}`}>
                        {(m.meeting_type || "virtual").replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {canManage ? (
                        <select
                          className={styles.statusSelect}
                          value={m.status || "scheduled"}
                          onChange={(e) => updateRowStatus(m, e.target.value)}
                        >
                          {ROW_STATUS_OPTS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={styles.muted}>{statusDisplay(m.status)}</span>
                      )}
                    </td>
                    <td className={styles.mono}>{fmt(m.start_time)}</td>
                    <td className={styles.mono}>{fmt(m.end_time)}</td>
                    <td>{userLabel(org)}</td>
                    <td>{userLabel(asg)}</td>
                    <td>{m.lead_name || "—"}</td>
                    <td className={styles.mono}>{m.attendee_count ?? "—"}</td>
                    <td>
                      <div className={styles.actionsCell}>
                        {canManage ? (
                          <>
                            <button type="button" className={styles.linkBtn} onClick={() => setEditMeeting(m)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`${styles.linkBtn} ${styles.dangerLink}`}
                              onClick={() => removeOne(m)}
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 ? (
        <p className={styles.muted} style={{ marginTop: 12 }}>
          Showing {items.length} of {total} meeting(s) matching filters.
          {viewMode === "calendar" ? " · Calendar view" : ""}
        </p>
      ) : null}

      <p className={styles.footerCopy}>Copyright © {new Date().getFullYear()} FitnessVitness CRM. All rights reserved.</p>

      <MeetingFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialMeeting={null}
        onSaved={load}
      />
      <MeetingFormModal
        open={Boolean(editMeeting)}
        onClose={() => setEditMeeting(null)}
        initialMeeting={editMeeting}
        onSaved={() => {
          setEditMeeting(null);
          load();
        }}
      />

      <MeetingDateRangeModal
        open={dateModalOpen}
        onClose={() => setDateModalOpen(false)}
        value={dateRange}
        onApply={(r) => setDateRange(r)}
      />

      {assignOpen ? (
        <div
          className={styles.assignOverlay}
          role="dialog"
          aria-modal
          aria-labelledby="bulk-assign-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAssignOpen(false);
          }}
        >
          <div className={styles.assignModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="bulk-assign-title" className={styles.assignTitle}>
              Assign meetings
            </h2>
            <p className={styles.muted} style={{ marginBottom: 10 }}>
              {selected.size} meeting(s) selected. Only meetings you organized are updated on the server.
            </p>
            <select
              className={styles.assignSelect}
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              aria-label="Assign to user"
            >
              <option value="">Select team member…</option>
              {users.map((u) => (
                <option key={`asg-${u.id}`} value={String(u.id)}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            <div className={styles.assignActions}>
              <button type="button" className={styles.btnCancel} onClick={() => setAssignOpen(false)}>
                Cancel
              </button>
              <button type="button" className={styles.btnSubmit} onClick={submitBulkAssign}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {alertMessage ? (
        <div
          className={styles.alertOverlay}
          role="alertdialog"
          aria-modal
          aria-live="assertive"
          onClick={() => setAlertMessage(null)}
        >
          <div className={styles.alertModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.alertIcon}>!</div>
            <p className={styles.alertText}>{alertMessage}</p>
            <button type="button" className={styles.alertOk} onClick={() => setAlertMessage(null)}>
              OK
            </button>
          </div>
        </div>
      ) : null}

      {statsOpen ? (
        <div
          className={styles.statsOverlay}
          role="dialog"
          aria-modal
          aria-labelledby="meet-stats-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStatsOpen(false);
          }}
        >
          <div className={styles.statsModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="meet-stats-title" className={styles.statsTitle}>
              Meeting report (current filters)
            </h2>
            {!stats ? (
              <p className={styles.muted}>Loading…</p>
            ) : (
              <div className={styles.statsGrid}>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.total) || 0}</div>
                  <div className={styles.statLab}>Total</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>
                    {(Number(stats.scheduled) || 0) + (Number(stats.postponed) || 0)}
                  </div>
                  <div className={styles.statLab}>Pending</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.completed) || 0}</div>
                  <div className={styles.statLab}>Completed</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.no_show) || 0}</div>
                  <div className={styles.statLab}>Missing</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.cancelled) || 0}</div>
                  <div className={styles.statLab}>Cancelled</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.type_virtual) || 0}</div>
                  <div className={styles.statLab}>Virtual</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.type_in_person) || 0}</div>
                  <div className={styles.statLab}>In person</div>
                </div>
                <div className={styles.statBox}>
                  <div className={styles.statVal}>{Number(stats.type_phone) || 0}</div>
                  <div className={styles.statLab}>Phone</div>
                </div>
              </div>
            )}
            <button type="button" className={styles.statsClose} onClick={() => setStatsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={null}>
      <MeetingsPageContent />
    </Suspense>
  );
}
