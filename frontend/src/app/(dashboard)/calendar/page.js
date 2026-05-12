"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeCalendarLive } from "@/lib/chatRealtime";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "./calendar.module.css";

const HOUR_H = 64;

const TYPE_ORDER = ["event", "lead", "reminder", "meeting", "holiday", "service", "task"];

const TYPE_STYLE = {
  event:    { label: "Event",    color: "#f97316" },
  lead:     { label: "Lead",     color: "#22c55e" },
  reminder: { label: "Reminder", color: "#8b5cf6" },
  meeting:  { label: "Meeting",  color: "#ef4444" },
  holiday:  { label: "Holiday",  color: "#06b6d4" },
  service:  { label: "Service",  color: "#94a3b8" },
  task:     { label: "Task",     color: "#0ea5e9" },
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateKeyLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toYMD(d);
}

function monthLabel(d) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function dayLabel(d) {
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatHour(h) {
  if (h === 0) return "12AM";
  if (h < 12) return `${h}AM`;
  if (h === 12) return "12PM";
  return `${h - 12}PM`;
}

function startOfGrid(anchor) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return start;
}

function gridRange(anchor) {
  const start = startOfGrid(anchor);
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  return { from: toYMD(start), to: toYMD(end) };
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function getEventPos(it) {
  const start = new Date(it.start);
  const rawEnd = it.end ? new Date(it.end) : null;
  const startMin = start.getHours() * 60 + start.getMinutes();
  let endMin;
  if (rawEnd && !Number.isNaN(rawEnd.getTime())) {
    endMin = rawEnd.getHours() * 60 + rawEnd.getMinutes();
    if (endMin <= startMin) endMin = startMin + 30;
  } else {
    endMin = startMin + 30;
  }
  const top = (startMin / 60) * HOUR_H;
  const height = Math.max(((endMin - startMin) / 60) * HOUR_H, 22);
  return { top, height };
}

export default function CalendarPage() {
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const [googleConnected, setGoogleConnected] = useState(false);

  const [anchor, setAnchor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [view, setView] = useState("month");
  const [selected, setSelected] = useState(() => new Date());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [live, setLive] = useState(false);

  const [filters, setFilters] = useState(() => {
    const o = {};
    TYPE_ORDER.forEach((k) => { o[k] = true; });
    return o;
  });

  const [drawer, setDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCat, setFormCat] = useState("event");

  const timelineScrollRef = useRef(null);

  const { from, to } = useMemo(() => gridRange(anchor), [anchor]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(
        `/calendar/feed?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load calendar");
      }
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setErr(e.message || "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, from, to]);

  const loadGoogleStatus = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/calendar/google/status");
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setGoogleConnected(!!json.connected);
      } else {
        setGoogleConnected(false);
      }
    } catch {
      setGoogleConnected(false);
    }
  }, [isLoaded]);

  useEffect(() => {
    void load();
    void loadGoogleStatus();
  }, [load, loadGoogleStatus]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    const unsub = subscribeCalendarLive(() => {
      setLive(true);
      void load();
    });
    return () => unsub();
  }, [isLoaded, load]);

  useEffect(() => {
    if (view !== "day" || !timelineScrollRef.current) return;
    const now = new Date();
    let scrollTarget;
    if (toYMD(now) === toYMD(selected)) {
      const minutes = now.getHours() * 60 + now.getMinutes();
      scrollTarget = Math.max(0, (minutes / 60) * HOUR_H - 120);
    } else {
      scrollTarget = 8 * HOUR_H - 50;
    }
    timelineScrollRef.current.scrollTop = scrollTarget;
  }, [view, selected]);

  const filtered = useMemo(
    () => items.filter((it) => filters[it.type] !== false),
    [items, filters]
  );

  const byDay = useMemo(() => {
    const m = {};
    for (const it of filtered) {
      const k = dateKeyLocal(it.start);
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(it);
    }
    return m;
  }, [filtered]);

  const cells = useMemo(() => {
    const start = startOfGrid(anchor);
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [anchor]);

  const todayKey = toYMD(new Date());
  const selectedKey = toYMD(selected);

  const dayItems = useMemo(
    () => filtered.filter((it) => dateKeyLocal(it.start) === selectedKey),
    [filtered, selectedKey]
  );

  const listItems = useMemo(
    () => [...filtered].sort((a, b) => new Date(a.start) - new Date(b.start)),
    [filtered]
  );

  const nowMinutes = useMemo(() => {
    if (toYMD(new Date()) !== selectedKey) return null;
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }, [selectedKey]);

  function navigatePrev() {
    if (view === "day") {
      const d = new Date(selected);
      d.setDate(d.getDate() - 1);
      setSelected(d);
      if (d.getMonth() !== anchor.getMonth() || d.getFullYear() !== anchor.getFullYear()) {
        setAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1));
    }
  }

  function navigateNext() {
    if (view === "day") {
      const d = new Date(selected);
      d.setDate(d.getDate() + 1);
      setSelected(d);
      if (d.getMonth() !== anchor.getMonth() || d.getFullYear() !== anchor.getFullYear()) {
        setAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1));
    }
  }

  function goToday() {
    const today = new Date();
    setSelected(today);
    setAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function openAddDrawer(d) {
    const base = d ? new Date(d) : new Date();
    base.setHours(9, 0, 0, 0);
    setFormTitle("");
    setFormStart(toDatetimeLocalValue(base));
    setFormEnd("");
    setFormDesc("");
    setFormCat("event");
    setDrawer(true);
  }

  async function submitEvent(e) {
    e.preventDefault();
    if (!formTitle.trim()) {
      showToast("Title is required", "error");
      return;
    }
    setSaving(true);
    try {
      const startIso = new Date(formStart).toISOString();
      const endIso = formEnd ? new Date(formEnd).toISOString() : null;
      const res = await apiFetch("/calendar/events", {
        method: "POST",
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDesc.trim() || null,
          start_at: startIso,
          end_at: endIso,
          all_day: false,
          category: formCat,
        }),     
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Could not save");
      showToast("Event added");
      setDrawer(false);
      void load();
    } catch (er) {
      showToast(er.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function onSyncGoogle() {
    try {
      const res = await apiFetch("/calendar/google/sync", {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Google sync failed");
      }
      setGoogleConnected(true);
      showToast(json.message || "Google sync is active");
      void load();
    } catch (err) {
      showToast(err.message || "Google sync failed", "error");
    }
  }

  async function deleteCustomEvent(meta) {
    const id = meta?.eventId;
    if (!id) return;
    if (!window.confirm("Delete this calendar event?")) return;
    try {
      const res = await apiFetch(`/calendar/events/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Delete failed");
      showToast("Event removed");
      void load();
    } catch (er) {
      showToast(er.message || "Delete failed", "error");
    }
  }

  function itemLink(it) {
    if (it.type === "meeting" && it.meta?.meetingId) return `/meetings`;
    if (it.type === "task" && it.meta?.taskId) return `/tasks`;
    if (it.type === "lead" && it.meta?.leadId) return `/leads/${it.meta.leadId}`;
    if (it.type === "reminder" && it.meta?.reminderId) return `/reminders`;
    return null;
  }

  const allDayItems = useMemo(() => dayItems.filter((it) => it.allDay), [dayItems]);
  const timedItems = useMemo(() => dayItems.filter((it) => !it.allDay), [dayItems]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <div className={styles.navMonth}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Previous"
              onClick={navigatePrev}
            >
              <i className="fas fa-chevron-left" />
            </button>
            <h1>
              {view === "day" ? dayLabel(selected) : monthLabel(anchor)}
            </h1>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Next"
              onClick={navigateNext}
            >
              <i className="fas fa-chevron-right" />
            </button>
          </div>

          <button
            type="button"
            className={styles.todayBtn}
            onClick={goToday}
          >
            Today
          </button>

          <span className={live ? styles.livePill : `${styles.livePill} ${styles.off}`}>
            {live ? "Live" : "Idle"}
          </span>
        </div>

        <div className={styles.viewTabs}>
          {["month", "day", "list"].map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? styles.active : ""}
              onClick={() => setView(v)}
            >
              {v === "month" ? "Month" : v === "day" ? "Day" : "List"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.actions} style={{ marginBottom: 16 }}>
        <button type="button" className={styles.btnPrimary} onClick={() => void onSyncGoogle()}>
          <i className="fas fa-calendar-alt" style={{ marginRight: 8 }} />
          {googleConnected ? "Resync Google Calendar" : "Sync Google Calendar"}
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => openAddDrawer(selected)}
        >
          <i className="fas fa-plus" style={{ marginRight: 8 }} />
          Add Event
        </button>
      </div>

      {err ? <p className={styles.err}>{err}</p> : null}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <h3>Filter</h3>
          <div className={styles.filterList}>
            {TYPE_ORDER.map((key) => {
              const st = TYPE_STYLE[key];
              if (!st) return null;
              return (
                <label key={key} className={styles.filterRow}>
                  <input
                    type="checkbox"
                    checked={filters[key] !== false}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, [key]: e.target.checked }))
                    }
                  />
                  <span className={styles.dot} style={{ background: st.color }} />
                  {st.label}
                </label>
              );
            })}
          </div>
        </aside>

        <section className={styles.mainPanel}>
          {loading ? (
            <div className={styles.empty}>
              <i className="fas fa-spinner fa-spin" style={{ marginRight: 8 }} />
              Loading calendar…
            </div>
          ) : view === "month" ? (
            <>
              <div className={styles.weekHeader}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className={styles.weekday}>{d}</div>
                ))}
              </div>
              <div className={styles.grid}>
                {cells.map((d) => {
                  const k = toYMD(d);
                  const inMonth = d.getMonth() === anchor.getMonth();
                  const isToday = k === todayKey;
                  const isSel = k === selectedKey;
                  const cellDayItems = byDay[k] || [];
                  const dots = cellDayItems.slice(0, 4);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={[
                        styles.cell,
                        !inMonth ? styles.muted : "",
                        isToday ? styles.today : "",
                        isSel ? styles.selected : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => {
                        setSelected(d);
                        setView("day");
                      }}
                    >
                      <div className={styles.dayNum}>{d.getDate()}</div>
                      <div className={styles.dots}>
                        {dots.map((it) => (
                          <span
                            key={it.id}
                            className={styles.dot}
                            style={{ background: TYPE_STYLE[it.type]?.color || "#999" }}
                            title={it.title}
                          />
                        ))}
                        {cellDayItems.length > 4 ? (
                          <span className={styles.moreDots}>+{cellDayItems.length - 4}</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : view === "day" ? (
            <div className={styles.dayView}>
              <div className={styles.timelineWrap}>
                <div className={styles.allDayRow}>
                  <span className={styles.allDayLabel}>All-Day</span>
                  <div className={styles.allDayContent}>
                    {allDayItems.length === 0 ? null : allDayItems.map((it) => {
                      const href = itemLink(it);
                      const tag = (
                        <span
                          key={it.id}
                          className={styles.allDayTag}
                          style={{ background: TYPE_STYLE[it.type]?.color || "#64748b" }}
                          title={it.title}
                        >
                          {it.title}
                        </span>
                      );
                      return href ? (
                        <Link key={it.id} href={href} style={{ textDecoration: "none" }}>
                          {tag}
                        </Link>
                      ) : tag;
                    })}
                  </div>
                </div>

                <div className={styles.timelineScroll} ref={timelineScrollRef}>
                  <div className={styles.timelineInner}>
                    <div className={styles.timeLabelsCol}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className={styles.timeLabel}>
                          {h === 0 ? "" : formatHour(h)}
                        </div>
                      ))}
                    </div>

                    <div className={styles.timeEventsArea}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <div
                          key={h}
                          className={styles.hourLine}
                          style={{ top: h * HOUR_H }}
                        />
                      ))}

                      {nowMinutes !== null && (
                        <div
                          className={styles.nowIndicator}
                          style={{ top: (nowMinutes / 60) * HOUR_H }}
                        >
                          <span className={styles.nowDot} />
                          <span className={styles.nowLineBar} />
                        </div>
                      )}

                      {timedItems.map((it) => {
                        const { top, height } = getEventPos(it);
                        const href = itemLink(it);
                        const color = TYPE_STYLE[it.type]?.color || "#64748b";
                        const inner = (
                          <div className={styles.timeEventInner}>
                            <span className={styles.timeEventTitle}>{it.title}</span>
                            {it.description ? (
                              <span className={styles.timeEventDesc}>{it.description}</span>
                            ) : null}
                            <span className={styles.timeEventTime}>
                              {new Date(it.start).toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        );
                        return (
                          <div
                            key={it.id}
                            className={styles.timeEvent}
                            style={{ top, height, background: color }}
                          >
                            {href ? (
                              <Link href={href} style={{ display: "block", height: "100%", textDecoration: "none", color: "inherit" }}>
                                {inner}
                              </Link>
                            ) : (
                              inner
                            )}
                            {it.source === "custom" && it.meta?.eventId ? (
                              <button
                                type="button"
                                className={styles.timeEventDelete}
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteCustomEvent(it.meta);
                                }}
                              >
                                <i className="fas fa-times" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })}

                      {timedItems.length === 0 && allDayItems.length === 0 && (
                        <div className={styles.timelineEmpty}>
                          No events scheduled for this day
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.listView}>
              <h3 className={styles.subheading}>All items in view</h3>
              {listItems.length === 0 ? (
                <p className={styles.empty}>No events to display</p>
              ) : (
                listItems.map((it) => {
                  const href = itemLink(it);
                  const inner = (
                    <>
                      <div style={{ flex: 1 }}>
                        <strong>{it.title}</strong>
                        <div className={styles.itemMeta}>
                          {dateKeyLocal(it.start)} ·{" "}
                          {new Date(it.start).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {it.description ? ` · ${it.description}` : ""}
                        </div>
                      </div>
                      <span
                        className={styles.typeTag}
                        style={{ background: TYPE_STYLE[it.type]?.color || "#64748b" }}
                      >
                        {TYPE_STYLE[it.type]?.label || it.type}
                      </span>
                    </>
                  );
                  return (
                    <div className={styles.itemCard} key={it.id}>
                      {href ? (
                        <Link
                          href={href}
                          style={{
                            flex: 1,
                            textDecoration: "none",
                            color: "inherit",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                          }}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          {inner}
                        </div>
                      )}
                      {it.source === "custom" && it.meta?.eventId ? (
                        <button
                          type="button"
                          className={styles.iconBtn}
                          title="Delete"
                          onClick={() => deleteCustomEvent(it.meta)}
                        >
                          <i className="fas fa-trash" />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>

      {drawer ? (
        <div
          className={styles.drawerOverlay}
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setDrawer(false)}
        >
          <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHead}>
              <h2>Add Event</h2>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="Close"
                onClick={() => setDrawer(false)}
              >
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={submitEvent}>
              <div className={styles.field}>
                <label htmlFor="ce-title">Title</label>
                <input
                  id="ce-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Event title"
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ce-start">Start</label>
                <input
                  id="ce-start"
                  type="datetime-local"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ce-end">End (optional)</label>
                <input
                  id="ce-end"
                  type="datetime-local"
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ce-cat">Type</label>
                <select
                  id="ce-cat"
                  value={formCat}
                  onChange={(e) => setFormCat(e.target.value)}
                >
                  <option value="event">Event</option>
                  <option value="holiday">Holiday</option>
                  <option value="service">Service</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="ce-desc">Description</label>
                <textarea
                  id="ce-desc"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Details…"
                />
              </div>
              <div className={styles.drawerActions}>
                <button type="button" className={styles.btnGhost} onClick={() => setDrawer(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={saving}>
                  {saving ? "Saving…" : "Add"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}