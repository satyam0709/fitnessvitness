"use strict";

const RECURRENCE = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
]);

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const FREQUENCY_NOTES = {
  once: null,
  daily: "Note: Daily reminder create every day",
  weekly: "Note: Weekly reminder create every 1 week",
  monthly: "Note: Monthly reminder create every 1 month",
  quarterly: "Note: Quarterly reminder create every 3 month",
  half_yearly: "Note: Half yearly reminder create every 6 month",
  yearly: "Note: Yearly reminder create every 1 year",
};

const REMINDER_TEMPLATES = [
  {
    key: "follow_up",
    label: "Follow up",
    title: "Follow up call",
    message: "Please follow up with the customer regarding their enquiry.",
  },
  {
    key: "payment",
    label: "Payment",
    title: "Payment reminder",
    message: "Gentle reminder about the pending payment discussion.",
  },
  {
    key: "meeting",
    label: "Meeting prep",
    title: "Meeting reminder",
    message: "Prepare for the scheduled meeting with the customer.",
  },
];

function sanitizeRecurrence(raw) {
  const v = String(raw || "once").trim().toLowerCase();
  return RECURRENCE.has(v) ? v : "once";
}

function sanitizeWeekday(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const hit = WEEKDAYS.find((d) => d.toLowerCase() === s.toLowerCase());
  return hit || null;
}

function parseTimeHm(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toSqlLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function computeRemindAt({ recurrence, remind_at, time, weekday }) {
  const rec = sanitizeRecurrence(recurrence);
  const now = new Date();

  if (rec === "daily") {
    const t = parseTimeHm(time);
    if (!t) return null;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.min, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  if (rec === "weekly") {
    const t = parseTimeHm(time);
    const dayName = sanitizeWeekday(weekday);
    if (!t || !dayName) return null;
    const targetDow = WEEKDAYS.indexOf(dayName);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.min, 0, 0);
    let add = (targetDow - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= now.getTime()) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }

  if (!remind_at) return null;
  const d = new Date(String(remind_at).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function nextRemindAt(remindAt, recurrence, weekday) {
  const d = remindAt instanceof Date ? new Date(remindAt.getTime()) : new Date(remindAt);
  if (Number.isNaN(d.getTime())) return null;
  const f = sanitizeRecurrence(recurrence);
  switch (f) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "half_yearly":
      d.setMonth(d.getMonth() + 6);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return null;
  }
  return d;
}

function getReminderFormMeta() {
  return {
    frequencies: [
      { key: "once", label: "Once", schedule: "datetime" },
      { key: "daily", label: "Daily", schedule: "time" },
      { key: "weekly", label: "Weekly", schedule: "week_time" },
      { key: "monthly", label: "Monthly", schedule: "datetime" },
      { key: "quarterly", label: "Quarterly", schedule: "datetime" },
      { key: "half_yearly", label: "Half-Yearly", schedule: "datetime" },
      { key: "yearly", label: "Yearly", schedule: "datetime" },
    ],
    weekdays: WEEKDAYS,
    templates: REMINDER_TEMPLATES,
    frequency_notes: FREQUENCY_NOTES,
  };
}

module.exports = {
  RECURRENCE,
  WEEKDAYS,
  FREQUENCY_NOTES,
  REMINDER_TEMPLATES,
  sanitizeRecurrence,
  sanitizeWeekday,
  parseTimeHm,
  computeRemindAt,
  nextRemindAt,
  toSqlLocal,
  getReminderFormMeta,
};
