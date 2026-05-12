"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import styles from "./LeadDateRangeModal.module.css";

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYMD(s) {
  if (!s || typeof s !== "string") return null;
  const [y, mo, d] = s.split("-").map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function formatPretty(ymd) {
  const d = parseYMD(ymd);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
];

function rangeForPreset(key) {
  const now = startOfDay(new Date());
  if (key === "today") return { from: toYMD(now), to: toYMD(now) };
  if (key === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const s = toYMD(y);
    return { from: s, to: s };
  }
  if (key === "this_week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(start.getDate() + mondayOffset);
    return { from: toYMD(start), to: toYMD(now) };
  }
  if (key === "last_week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(now);
    thisMonday.setDate(thisMonday.getDate() + mondayOffset);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(lastSunday.getDate() - 1);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastMonday.getDate() - 6);
    return { from: toYMD(lastMonday), to: toYMD(lastSunday) };
  }
  if (key === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toYMD(start), to: toYMD(now) };
  }
  if (key === "last_month") {
    const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastPrev = new Date(firstThis);
    lastPrev.setDate(0);
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
    return { from: toYMD(firstPrev), to: toYMD(lastPrev) };
  }
  return { from: toYMD(now), to: toYMD(now) };
}

/** 6 rows × 7 cols for one month */
function buildMonthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  let dayNum = 1 - startWeekday;
  for (let i = 0; i < 42; i++) {
    const cur = new Date(year, monthIndex, dayNum);
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    cells.push({
      inMonth,
      dateStr: toYMD(cur),
      display: dayNum >= 1 && dayNum <= daysInMonth ? dayNum : cur.getDate(),
      muted: !inMonth,
    });
    dayNum++;
  }
  return cells;
}

function MonthGrid({
  year,
  monthIndex,
  title,
  startStr,
  endStr,
  todayStr,
  markers,
  onDayClick,
}) {
  const cells = buildMonthCells(year, monthIndex);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function inRange(ds) {
    if (!startStr) return false;
    if (!endStr) return ds === startStr;
    return ds >= startStr && ds <= endStr;
  }

  return (
    <div className={styles.monthBlock}>
      <div className={styles.monthTitle}>{title}</div>
      <div className={styles.weekdays}>
        {wd.map((w) => (
          <div key={w} className={styles.weekday}>
            {w}
          </div>
        ))}
      </div>
      <div className={styles.days}>
        {cells.map((c, idx) => {
          const isStart = c.inMonth && startStr && c.dateStr === startStr;
          const isEnd = c.inMonth && endStr && c.dateStr === endStr;
          const range = c.inMonth && inRange(c.dateStr);
          const isToday = c.dateStr === todayStr;
          const count = markers[c.dateStr] || 0;
          return (
            <button
              key={`${c.dateStr}-${idx}`}
              type="button"
              disabled={!c.inMonth}
              className={[
                styles.dayCell,
                c.muted ? styles.dayCellMuted : "",
                range ? styles.dayInRange : "",
                isStart ? styles.dayRangeStart : "",
                isEnd ? styles.dayRangeEnd : "",
                isToday ? styles.dayCellToday : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => c.inMonth && onDayClick(c.dateStr)}
            >
              <span className={styles.dayNum}>{c.display}</span>
              {count > 0 ? <span className={styles.markerDot} title={`${count} follow-up(s)`} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LeadDateRangeModal({
  open,
  onClose,
  onApply,
  initialFrom = "",
  initialTo = "",
}) {
  const [mounted, setMounted] = useState(false);
  const [viewAnchor, setViewAnchor] = useState(() => startOfMonth(new Date()));
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [presetKey, setPresetKey] = useState(null);
  const [markers, setMarkers] = useState({});
  const [markersLoading, setMarkersLoading] = useState(false);
  const [daysUpTo, setDaysUpTo] = useState("");
  const [daysFrom, setDaysFrom] = useState("");

  const todayStr = toYMD(startOfDay(new Date()));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const from = initialFrom || todayStr;
    const to = initialTo || todayStr;
    setStartStr(from <= to ? from : to);
    setEndStr(from <= to ? to : from);
    setPresetKey(null);
    const mid = parseYMD(from);
    if (mid) setViewAnchor(startOfMonth(mid));
    setDaysUpTo("");
    setDaysFrom("");
  }, [open, initialFrom, initialTo, todayStr]);

  const left = viewAnchor;
  const right = addMonths(viewAnchor, 1);
  const viewYM = `${viewAnchor.getFullYear()}-${viewAnchor.getMonth()}`;

  useEffect(() => {
    if (!open) return;
    const from = toYMD(startOfMonth(viewAnchor));
    const r = addMonths(viewAnchor, 1);
    const toEnd = new Date(r.getFullYear(), r.getMonth() + 1, 0);
    const to = toYMD(toEnd);
    let cancelled = false;
    setMarkersLoading(true);
    (async () => {
      try {
        const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const res = await apiFetch(`/leads/calendar-markers?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json.success && json.byDate && typeof json.byDate === "object") {
          setMarkers(json.byDate);
        } else {
          setMarkers({});
        }
      } catch {
        if (!cancelled) setMarkers({});
      } finally {
        if (!cancelled) setMarkersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, viewAnchor]);

  function handleDayClick(ds) {
    setPresetKey(null);
    if (!startStr || (startStr && endStr)) {
      setStartStr(ds);
      setEndStr("");
      return;
    }
    let a = startStr;
    let b = ds;
    if (b < a) [a, b] = [b, a];
    setStartStr(a);
    setEndStr(b);
  }

  function applyPreset(key) {
    const { from, to } = rangeForPreset(key);
    setStartStr(from);
    setEndStr(to);
    setPresetKey(key);
    const d = parseYMD(from);
    if (d) setViewAnchor(startOfMonth(d));
  }

  function applyCustomUpTo() {
    const n = Math.max(1, parseInt(daysUpTo, 10) || 0);
    if (!n) return;
    const end = startOfDay(new Date());
    const start = new Date(end);
    start.setDate(start.getDate() - (n - 1));
    setStartStr(toYMD(start));
    setEndStr(toYMD(end));
    setPresetKey(null);
    setViewAnchor(startOfMonth(start));
  }

  function applyCustomFrom() {
    const n = Math.max(1, parseInt(daysFrom, 10) || 0);
    if (!n) return;
    const start = startOfDay(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + (n - 1));
    setStartStr(toYMD(start));
    setEndStr(toYMD(end));
    setPresetKey(null);
    setViewAnchor(startOfMonth(start));
  }

  function shiftMonths(delta) {
    setViewAnchor((v) => addMonths(v, delta));
  }

  function handleSubmit() {
    if (!startStr) return;
    const from = startStr;
    const to = endStr || startStr;
    onApply({ from: from <= to ? from : to, to: from <= to ? to : from });
    onClose();
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const years = [];
  const yCur = new Date().getFullYear();
  for (let y = yCur - 5; y <= yCur + 2; y++) years.push(y);

  if (!mounted || !open) return null;

  const modal = (
    <div className={styles.overlay} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="lead-drange-title">
        <div className={styles.header}>
          <span id="lead-drange-title">Date Range</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.body}>
          <aside className={styles.sidebar}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`${styles.presetBtn} ${presetKey === p.key ? styles.presetBtnActive : ""}`}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
            <div className={styles.customBlock}>
              <div className={styles.customRow}>
                <label htmlFor="dr-days-up">Custom</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    id="dr-days-up"
                    type="number"
                    min={1}
                    placeholder="—"
                    value={daysUpTo}
                    onChange={(e) => setDaysUpTo(e.target.value)}
                    style={{ width: 56 }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>days up to today</span>
                </div>
                <button type="button" className={styles.presetBtn} onClick={applyCustomUpTo}>
                  Apply
                </button>
              </div>
              <div className={styles.customRow}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    value={daysFrom}
                    onChange={(e) => setDaysFrom(e.target.value)}
                    style={{ width: 56 }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>days starting today</span>
                </div>
                <button type="button" className={styles.presetBtn} onClick={applyCustomFrom}>
                  Apply
                </button>
              </div>
            </div>
          </aside>
          <div className={styles.main}>
            <div className={styles.rangeInputs}>
              <div className={styles.rangeField}>
                <label htmlFor="dr-start-display">Start Date</label>
                <input
                  id="dr-start-display"
                  type="text"
                  readOnly
                  value={formatPretty(startStr)}
                />
              </div>
              <div className={styles.rangeField}>
                <label htmlFor="dr-end-display">End Date</label>
                <input
                  id="dr-end-display"
                  type="text"
                  readOnly
                  value={formatPretty(endStr || startStr)}
                />
              </div>
            </div>

            <div className={styles.navRow}>
              <button type="button" className={styles.navBtn} onClick={() => shiftMonths(-1)} aria-label="Previous months">
                <i className="fas fa-chevron-left" />
              </button>
              <div className={styles.monthSelects}>
                <select
                  value={left.getMonth()}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setViewAnchor(new Date(left.getFullYear(), m, 1));
                  }}
                >
                  {monthNames.map((name, i) => (
                    <option key={name} value={i}>{name}</option>
                  ))}
                </select>
                <select
                  value={left.getFullYear()}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setViewAnchor(new Date(y, left.getMonth(), 1));
                  }}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <button type="button" className={styles.navBtn} onClick={() => shiftMonths(1)} aria-label="Next months">
                <i className="fas fa-chevron-right" />
              </button>
            </div>

            {markersLoading ? (
              <div className={styles.loadingHint}>Loading follow-up markers…</div>
            ) : null}

            <div className={styles.calendars}>
              <MonthGrid
                year={left.getFullYear()}
                monthIndex={left.getMonth()}
                title={`${monthNames[left.getMonth()]} ${left.getFullYear()}`}
                startStr={startStr}
                endStr={endStr}
                todayStr={todayStr}
                markers={markers}
                onDayClick={handleDayClick}
              />
              <MonthGrid
                year={right.getFullYear()}
                monthIndex={right.getMonth()}
                title={`${monthNames[right.getMonth()]} ${right.getFullYear()}`}
                startStr={startStr}
                endStr={endStr}
                todayStr={todayStr}
                markers={markers}
                onDayClick={handleDayClick}
              />
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnSubmit} onClick={handleSubmit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
