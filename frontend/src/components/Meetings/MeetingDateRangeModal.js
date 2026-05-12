"use client";

import { useEffect, useState } from "react";
import styles from "./MeetingDateRangeModal.module.css";

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Local wall time as `YYYY-MM-DD HH:mm:ss` for MySQL DATETIME filters */
export function localDateTimeForApi(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday as first day of week (local) */
function mondayOfWeek(ref) {
  const d = startOfDay(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function sundayOfWeekFromMonday(mon) {
  return endOfDay(addDays(mon, 6));
}

function firstOfMonth(ref) {
  const d = startOfDay(ref);
  d.setDate(1);
  return d;
}

function lastOfMonth(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return endOfDay(d);
}

function toInputDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromInputDate(s) {
  if (!s) return null;
  const [y, m, day] = s.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ range_start: string, range_end: string } | null} props.value
 * @param {(r: { range_start: string, range_end: string }) => void} props.onApply
 */
export default function MeetingDateRangeModal({ open, onClose, value, onApply }) {
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [daysUpTo, setDaysUpTo] = useState("");
  const [daysFrom, setDaysFrom] = useState("");

  useEffect(() => {
    if (!open) return;
    if (value?.range_start && value?.range_end) {
      const a = new Date(String(value.range_start).replace(" ", "T"));
      const b = new Date(String(value.range_end).replace(" ", "T"));
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        setFromStr(toInputDate(startOfDay(a)));
        setToStr(toInputDate(startOfDay(b)));
        return;
      }
    }
    const t = startOfDay(new Date());
    setFromStr(toInputDate(t));
    setToStr(toInputDate(t));
  }, [open, value]);

  function applyRange(startD, endD) {
    const rs = localDateTimeForApi(startOfDay(startD));
    const re = localDateTimeForApi(endOfDay(endD));
    onApply({ range_start: rs, range_end: re });
    onClose();
  }

  function onPreset(key) {
    const now = new Date();
    if (key === "today") {
      applyRange(now, now);
      return;
    }
    if (key === "yesterday") {
      const y = addDays(now, -1);
      applyRange(y, y);
      return;
    }
    if (key === "this_week") {
      const mon = mondayOfWeek(now);
      const sun = sundayOfWeekFromMonday(mon);
      applyRange(mon, sun);
      return;
    }
    if (key === "last_week") {
      const thisMon = mondayOfWeek(now);
      const lastMon = addDays(thisMon, -7);
      const lastSun = sundayOfWeekFromMonday(lastMon);
      applyRange(lastMon, lastSun);
      return;
    }
    if (key === "this_month") {
      const a = firstOfMonth(now);
      const b = lastOfMonth(now);
      applyRange(a, b);
      return;
    }
    if (key === "last_month") {
      const firstThis = firstOfMonth(now);
      const lastPrev = addDays(firstThis, -1);
      const a = firstOfMonth(lastPrev);
      const b = lastOfMonth(lastPrev);
      applyRange(a, b);
    }
  }

  function submitManual() {
    const a = fromInputDate(fromStr);
    const b = fromInputDate(toStr);
    if (!a || !b) return;
    const startD = startOfDay(a <= b ? a : b);
    const endD = endOfDay(a <= b ? b : a);
    applyRange(startD, endD);
  }

  function submitDaysUpTo() {
    const n = Number(daysUpTo);
    if (!Number.isFinite(n) || n < 1 || n > 366) return;
    const end = startOfDay(new Date());
    const start = startOfDay(addDays(end, -(n - 1)));
    applyRange(start, end);
  }

  function submitDaysStarting() {
    const n = Number(daysFrom);
    if (!Number.isFinite(n) || n < 1 || n > 366) return;
    const start = startOfDay(new Date());
    const end = endOfDay(addDays(start, n - 1));
    applyRange(start, end);
  }

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-labelledby="mdrm-title" onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 id="mdrm-title" className={styles.title}>
            Date range
          </h2>
        </div>
        <div className={styles.body}>
          <div className={styles.presets}>
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={styles.presetBtn} onClick={() => onPreset(p.key)}>
                {p.label}
              </button>
            ))}
            <div className={styles.customBlock}>
              <div className={styles.customRow}>
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={daysUpTo}
                  onChange={(e) => setDaysUpTo(e.target.value)}
                  aria-label="Days up to today"
                />
                <span>days up to today</span>
                <button type="button" className={styles.presetBtn} onClick={submitDaysUpTo}>
                  Apply
                </button>
              </div>
              <div className={styles.customRow}>
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={daysFrom}
                  onChange={(e) => setDaysFrom(e.target.value)}
                  aria-label="Days starting today"
                />
                <span>days starting today</span>
                <button type="button" className={styles.presetBtn} onClick={submitDaysStarting}>
                  Apply
                </button>
              </div>
            </div>
          </div>
          <div className={styles.main}>
            <p className={styles.hint}>
              Choose a preset or pick dates below. The list is filtered by meeting start time on the server.
            </p>
            <div className={styles.rangeRow}>
              <label htmlFor="mdrm-from">From</label>
              <input id="mdrm-from" type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
              <label htmlFor="mdrm-to">To</label>
              <input id="mdrm-to" type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnSubmit} onClick={submitManual}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
