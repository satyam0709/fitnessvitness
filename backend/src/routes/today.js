const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
const { nextOccurrence } = require("../utils/todoRecurrence");
const {
  emitCalendarChanged,
  emitTodosChanged,
  emitMeetingsChanged,
  emitFitnessChanged,
  emitLeadsChanged,
  emitRemindersChanged,
  emitTasksChanged,
  emitOpportunitiesChanged,
} = require("../realtime/meetingsRealtime");
const { fetchGoogleEvents } = require("../services/googleCalendarService");
const { fetchAppleEvents, isConnected: isAppleCalendarConnected, getAppleCalendarSettings } = require("../services/appleCalendarService");
const { promisePool } = require("../utils/promisePool");

const GOOGLE_FETCH_TIMEOUT_MS = 3000;
const OVERDUE_LIMIT = 200;
const UPCOMING_LIMIT = 50;
const UPCOMING_DAYS = 14;

const router = express.Router();
router.use(verifyToken);

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateParam(raw) {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw).slice(0, 10))) {
    return String(raw).slice(0, 10);
  }
  return formatYmd(new Date());
}

function parseYmdLocal(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateOnly(ymd) {
  return parseYmdLocal(ymd);
}

function dayStartDt(date) {
  return new Date(`${date}T00:00:00`);
}

function dayEndDt(date) {
  return new Date(`${date}T23:59:59`);
}

function addDaysLocal(ymd, days) {
  const d = parseYmdLocal(ymd);
  d.setDate(d.getDate() + days);
  return d;
}

function canViewOtherUserToday(req) {
  const role = String(req.user?.role || "").toLowerCase();
  return role === "admin" || role === "manager";
}

function resolveUserId(req) {
  const q = req.query?.assigned_to;
  if (q != null && q !== "") {
    const n = Number(q);
    if (Number.isFinite(n) && n > 0) {
      if (canViewOtherUserToday(req)) return n;
    }
  }
  const uid = Number(req.user?.id);
  return Number.isFinite(uid) && uid > 0 ? uid : null;
}

function addDaysYmd(date, days) {
  const d = parseYmdLocal(date);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

function toIsoDateTime(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10) {
    return `${s.slice(0, 10)}T00:00:00.000Z`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function ymdOf(v) {
  if (v == null) return "";
  if (v instanceof Date) return formatYmd(v);
  return String(v).slice(0, 10);
}

function decimalOrNull(v) {
  if (v == null) return null;
  if (typeof v === "object" && typeof v.toString === "function") return v.toString();
  return v;
}

function normalizePriority(p) {
  if (p == null) return null;
  const s = String(p).trim().toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return null;
}

function truncateText(value, maxLen = 140) {
  if (value == null || value === "") return null;
  const t = String(value).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
}

function joinSubtitleParts(parts) {
  return parts
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join(" · ");
}

const TODAY_ACTION_LABELS = {
  todo: "Complete to-do",
  meeting: "Attend meeting",
  reminder: "Complete reminder",
  lead_followup: "Call lead and log follow-up",
  client_followup: "Client check-in follow-up",
  task: "Complete task",
  calendar_event: "Calendar event",
  google_event: "Google Calendar event",
  apple_event: "Apple Calendar event",
  opportunity_followup: "Prospect follow-up",
  collection_followup: "Collection follow-up",
  fitness_payment_due: "Collect or record payment",
  fitness_client_task: "Complete client task",
};

function isDateOnlyDue(sourceType, dueRaw) {
  const dateOnlyTypes = new Set([
    "lead_followup",
    "client_followup",
    "todo",
    "fitness_client_task",
    "collection_followup",
    "fitness_payment_due",
  ]);
  if (dateOnlyTypes.has(sourceType)) return true;
  const s = String(dueRaw || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10;
}

function formatDisplayDate(ymdOrDate, dateOnlyFlag) {
  const s = String(ymdOrDate).slice(0, 10);
  const d = dateOnlyFlag ? new Date(`${s}T12:00:00`) : new Date(ymdOrDate);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDisplayTime(dueRaw, dateOnlyFlag) {
  if (dateOnlyFlag) return null;
  const d = new Date(dueRaw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function buildDueDisplay(item, referenceDateYmd) {
  const dueRaw = item.due_date;
  if (!dueRaw) {
    return {
      label: "No date set",
      relative: null,
      date_text: null,
      time_text: null,
      due_ymd: null,
    };
  }

  const dateOnlyFlag = isDateOnlyDue(item.source_type, dueRaw);
  const dueYmd = String(dueRaw).slice(0, 10);
  const dateText = formatDisplayDate(dueRaw, dateOnlyFlag);
  const timeText = formatDisplayTime(dueRaw, dateOnlyFlag);

  let relative = null;
  if (dueYmd < referenceDateYmd) {
    relative = item.is_overdue ? "Overdue" : "Past due";
  } else if (dueYmd === referenceDateYmd) {
    relative = "Today";
  } else if (dueYmd === addDaysYmd(referenceDateYmd, 1)) {
    relative = "Tomorrow";
  } else {
    const a = new Date(`${referenceDateYmd}T00:00:00`);
    const b = new Date(`${dueYmd}T00:00:00`);
    const days = Math.round((b - a) / 86400000);
    if (days > 1) relative = `In ${days} days`;
  }

  const prefixByType = {
    lead_followup: "Follow-up",
    client_followup: "Check-in due",
    opportunity_followup: "Follow-up",
    collection_followup: "Follow-up",
    fitness_payment_due: "Payment due",
    meeting: "Scheduled",
    calendar_event: "Event",
    google_event: "Event",
    apple_event: "Event",
    reminder: "Remind",
    todo: "Due",
    task: "Due",
    fitness_client_task: "Due",
  };
  const prefix = prefixByType[item.source_type] || "Due";

  let label;
  if (relative === "Today" && timeText) {
    label = `Today · ${timeText}`;
  } else if (relative === "Today") {
    label = `Today · ${dateText}`;
  } else if (relative === "Tomorrow" && timeText) {
    label = `Tomorrow · ${timeText}`;
  } else if (relative === "Tomorrow") {
    label = `Tomorrow · ${dateText}`;
  } else if (relative && (relative === "Overdue" || relative === "Past due")) {
    label = `${relative} · ${prefix} ${dateText}${timeText ? ` · ${timeText}` : ""}`;
  } else if (relative) {
    label = `${relative} · ${prefix} ${dateText}${timeText ? ` · ${timeText}` : ""}`;
  } else {
    label = `${prefix}: ${dateText}${timeText ? ` · ${timeText}` : ""}`;
  }

  return {
    label,
    relative,
    date_text: dateText,
    time_text: timeText,
    due_ymd: dueYmd,
  };
}

function buildItemSubtitle(item) {
  const m = item.meta || {};
  const st = item.source_type;

  switch (st) {
    case "todo":
      return truncateText(
        joinSubtitleParts([
          m.todo_category ? String(m.todo_category).replace(/_/g, " ") : null,
          m.body && m.body !== item.title ? m.body : null,
          m.frequency && m.frequency !== "once" ? `Repeats ${m.frequency}` : null,
        ])
      );
    case "meeting":
      return truncateText(
        joinSubtitleParts([
          m.description,
          m.meeting_type,
          m.consultation_type,
          m.location,
          m.meet_link ? "Online link" : null,
          item.client_name,
        ])
      );
    case "reminder":
      return truncateText(
        joinSubtitleParts([
          m.note,
          m.lead_name ? `Lead: ${m.lead_name}` : null,
          m.reminder_category,
          item.client_name,
        ])
      );
    case "lead_followup":
      return truncateText(
        joinSubtitleParts([
          m.phone ? `Phone ${m.phone}` : null,
          m.email,
          m.source ? `Source: ${m.source}` : null,
          m.health_goal ? `Goal: ${m.health_goal}` : null,
          m.enquiry_stage ? `Stage: ${m.enquiry_stage}` : null,
          item.status ? `Status: ${item.status}` : null,
        ])
      );
    case "client_followup":
      return truncateText(
        joinSubtitleParts([
          item.client_name,
          m.plan_type,
          m.progress ? `Progress: ${m.progress}` : null,
          m.health_goal,
          m.phone,
        ])
      );
    case "task":
      return truncateText(
        joinSubtitleParts([
          m.description,
          m.task_category,
          m.task_type,
          item.client_name,
        ])
      );
    case "calendar_event":
      return truncateText(
        joinSubtitleParts([
          m.description,
          m.category ? `Type: ${m.category}` : null,
          m.all_day ? "All day" : null,
        ])
      );
    case "google_event":
      return truncateText(
        joinSubtitleParts([
          m.description,
          m.all_day ? "All day" : null,
        ])
      );
    case "apple_event":
      return truncateText(
        joinSubtitleParts([
          m.description,
          m.location,
          m.all_day ? "All day" : null,
        ])
      );
    case "opportunity_followup":
      return truncateText(
        joinSubtitleParts([
          m.visit_purpose,
          m.followup_type,
          m.product_category,
          m.stage ? `Stage: ${m.stage}` : null,
          m.phone,
        ])
      );
    case "collection_followup":
      return truncateText(
        joinSubtitleParts([
          item.client_name,
          m.collection_type,
          m.pending_inr != null
            ? `₹${Number(m.pending_inr).toLocaleString("en-IN")} pending`
            : null,
        ])
      );
    case "fitness_payment_due":
      return truncateText(
        joinSubtitleParts([
          item.client_name,
          m.product_plan,
          m.transaction_type,
          m.pending_inr != null
            ? `₹${Number(m.pending_inr).toLocaleString("en-IN")} pending`
            : null,
          m.pay_mode ? `Mode: ${m.pay_mode}` : null,
        ])
      );
    case "fitness_client_task":
      return truncateText(
        joinSubtitleParts([
          m.task_description && m.task_description !== item.title ? m.task_description : null,
          m.period,
          m.notes,
          item.client_name,
        ])
      );
    default:
      return truncateText(item.client_name);
  }
}

function enrichTodayItem(item, referenceDateYmd) {
  item.due_display = buildDueDisplay(item, referenceDateYmd);
  item.subtitle = buildItemSubtitle(item);
  item.action_label = TODAY_ACTION_LABELS[item.source_type] || "Complete action";
  return item;
}

function normalizeItem(row) {
  const sourceType = row.source_type;
  const priority = row.priority || null;
  const item = {
    id: row.id,
    source_type: sourceType,
    source_id: row.source_id != null ? row.source_id : row.id,
    title: row.title || "",
    due_date: toIsoDateTime(row.due_date),
    priority,
    is_overdue: Number(row.is_overdue) ? 1 : 0,
    client_id: row.client_id ?? null,
    client_name: row.client_name ?? null,
    status: row.status != null ? String(row.status) : null,
    meta: {},
  };

  switch (sourceType) {
    case "todo":
      item.meta = {
        todo_category: row.todo_category ?? null,
        body: row.body ?? row.title,
        frequency: row.frequency ?? null,
      };
      break;
    case "meeting":
      item.meta = {
        start_time: toIsoDateTime(row.start_time),
        end_time: toIsoDateTime(row.end_time),
        meeting_type: row.meeting_type ?? null,
        consultation_type: row.consultation_type ?? null,
        location: row.location ?? null,
        meet_link: row.meet_link ?? null,
        description: row.description ?? null,
      };
      break;
    case "reminder":
      item.meta = {
        note: row.note ?? null,
        reminder_category: row.reminder_category ?? row.reminder_type ?? null,
        lead_id: row.lead_id ?? null,
        lead_name: row.lead_name ?? null,
        remind_at: toIsoDateTime(row.remind_at || row.due_date),
      };
      break;
    case "lead_followup":
      item.meta = {
        phone: row.phone ?? null,
        email: row.email ?? null,
        source: row.source ?? null,
        health_goal: row.health_goal ?? null,
        enquiry_stage: row.enquiry_stage ?? null,
      };
      break;
    case "client_followup":
      item.meta = {
        phone: row.phone ?? null,
        email: row.email ?? null,
        health_goal: row.health_goal ?? null,
        plan_type: row.plan_type ?? null,
        progress: row.progress ?? null,
      };
      break;
    case "task":
      item.meta = {
        description: row.description ?? null,
        task_category: row.task_category ?? null,
        task_type: row.task_type ?? null,
        lead_id: row.lead_id ?? null,
      };
      break;
    case "calendar_event":
      item.meta = {
        start_at: toIsoDateTime(row.start_at),
        end_at: toIsoDateTime(row.end_at),
        all_day: !!row.all_day,
        category: row.category ?? "event",
        description: row.description ?? null,
        readOnly: true,
      };
      break;
    case "google_event":
      item.meta = {
        start_at: toIsoDateTime(row.start_at || row.due_date),
        end_at: toIsoDateTime(row.end_at),
        all_day: !!row.all_day,
        google_event_id: row.google_event_id ?? row.source_id,
        description: row.description ?? null,
        readOnly: true,
      };
      break;
    case "apple_event":
      item.meta = {
        start_at: toIsoDateTime(row.start_at || row.due_date),
        end_at: toIsoDateTime(row.end_at),
        all_day: !!row.all_day,
        apple_uid: row.apple_uid ?? row.source_id,
        location: row.location ?? null,
        description: row.description ?? null,
        readOnly: true,
      };
      break;
    case "opportunity_followup":
      item.meta = {
        followup_type: row.followup_type ?? null,
        phone: row.phone ?? null,
        visit_purpose: row.visit_purpose ?? null,
        stage: row.status ?? null,
        product_category: row.product_category ?? null,
      };
      break;
    case "collection_followup":
      item.meta = {
        pending_inr: row.pending_inr ?? null,
        collection_type: row.collection_type ?? null,
        collection_id: row.source_id ?? row.id,
      };
      break;
    case "fitness_payment_due":
      item.meta = {
        pending_inr: row.pending_inr ?? null,
        product_plan: row.product_plan ?? null,
        transaction_type: row.transaction_type ?? row.type ?? null,
        transaction_date: toIsoDateTime(row.transaction_date),
        pay_mode: row.pay_mode ?? null,
        received_inr: row.received_inr ?? null,
      };
      break;
    case "fitness_client_task":
      item.meta = {
        task_description: row.task_description ?? row.title,
        period: row.period ?? null,
        notes: row.notes ?? null,
      };
      break;
    default:
      break;
  }

  return item;
}

function sortItems(items) {
  return items.sort((a, b) => {
    if (b.is_overdue !== a.is_overdue) return b.is_overdue - a.is_overdue;
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    const da = a.due_date ? new Date(a.due_date).getTime() : 0;
    const db = b.due_date ? new Date(b.due_date).getTime() : 0;
    return da - db;
  });
}

function buildSummary(items) {
  const by_type = {
    todo: 0,
    meeting: 0,
    reminder: 0,
    lead_followup: 0,
    client_followup: 0,
    task: 0,
    calendar_event: 0,
    google_event: 0,
    apple_event: 0,
    opportunity_followup: 0,
    collection_followup: 0,
    fitness_payment_due: 0,
    fitness_client_task: 0,
  };
  let overdue = 0;
  for (const it of items) {
    if (Object.prototype.hasOwnProperty.call(by_type, it.source_type)) {
      by_type[it.source_type] += 1;
    }
    if (it.is_overdue) overdue += 1;
  }
  const total = items.length;
  return {
    total,
    overdue,
    due_today: total - overdue,
    by_type,
  };
}

async function mapClientNamesByClientId(clientIds) {
  const ids = [...new Set(clientIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await prisma.fitness_clients.findMany({
    where: { client_id: { in: ids } },
    select: { client_id: true, full_name: true },
  });
  return new Map(rows.map((r) => [r.client_id, r.full_name]));
}

async function mapClientsByInternalId(internalIds) {
  const ids = [...new Set(internalIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return new Map();
  const rows = await prisma.fitness_clients.findMany({
    where: { id: { in: ids } },
    select: { id: true, client_id: true, full_name: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

function tenantClause(tenantId) {
  if (tenantId == null) return {};
  return { tenant_id: tenantId };
}

async function fetchTodos(date, userId, tenantId) {
  const d = dateOnly(date);
  const rows = await prisma.crm_todos.findMany({
    where: {
      is_deleted: false,
      status: "pending",
      ...tenantClause(tenantId),
      AND: [
        {
          OR: [
            { todo_date: d },
            { AND: [{ todo_date: { lt: d } }, { carry_forward: true }] },
          ],
        },
        {
          OR: [
            { created_by: userId },
            { crm_todo_assignees: { some: { user_id: userId } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      body: true,
      todo_date: true,
      priority: true,
      status: true,
      frequency: true,
      todo_category: true,
      client_id: true,
    },
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((t) => ({
    id: t.id,
    body: t.body,
    title: t.body,
    due_date: t.todo_date,
    priority: t.priority,
    status: t.status,
    frequency: t.frequency,
    source_id: t.id,
    source_type: "todo",
    is_overdue: ymdOf(t.todo_date) < date ? 1 : 0,
    todo_category: t.todo_category ?? null,
    client_id: t.client_id ?? null,
    client_name: t.client_id ? nameMap.get(t.client_id) ?? null : null,
  }));
}

async function fetchMeetings(date, userId) {
  const start = dayStartDt(date);
  const end = dayEndDt(date);
  const rows = await prisma.meetings.findMany({
    where: {
      is_deleted: false,
      start_time: { gte: start, lte: end },
      status: "scheduled",
      OR: [
        { assigned_to_user_id: userId },
        { organizer_id: userId },
        { meeting_attendees: { some: { user_id: userId } } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      start_time: true,
      end_time: true,
      meeting_type: true,
      status: true,
      location: true,
      meet_link: true,
      consultation_type: true,
      client_id: true,
    },
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    start_time: m.start_time,
    end_time: m.end_time,
    meeting_type: m.meeting_type,
    status: m.status,
    location: m.location,
    meet_link: m.meet_link,
    due_date: m.start_time,
    source_id: m.id,
    source_type: "meeting",
    is_overdue: 0,
    priority: null,
    consultation_type: m.consultation_type ?? null,
    client_id: m.client_id ?? null,
    client_name: m.client_id ? nameMap.get(m.client_id) ?? null : null,
  }));
}

async function fetchReminders(date, userId) {
  const start = dayStartDt(date);
  const end = dayEndDt(date);
  const rows = await prisma.reminders.findMany({
    where: {
      is_deleted: false,
      is_done: false,
      OR: [
        { remind_at: { gte: start, lte: end } },
        { remind_at: { lt: start } },
      ],
      AND: [
        {
          OR: [{ assigned_to_user_id: userId }, { user_id: userId }],
        },
      ],
    },
    include: {
      leads: { select: { name: true } },
    },
    orderBy: { remind_at: "asc" },
    take: OVERDUE_LIMIT,
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    due_date: r.remind_at,
    remind_at: r.remind_at,
    reminder_type: r.reminder_type,
    reminder_category: r.reminder_type,
    lead_id: r.lead_id,
    lead_name: r.leads?.name ?? null,
    status: "pending",
    source_id: r.id,
    source_type: "reminder",
    priority: null,
    client_id: null,
    client_name: null,
    is_overdue: ymdOf(r.remind_at) < date ? 1 : 0,
  }));
}

async function fetchLeadFollowups(date, userId, tenantId) {
  const d = dateOnly(date);
  const rows = await prisma.leads.findMany({
    where: {
      is_deleted: false,
      ...tenantClause(tenantId),
      follow_up_date: { not: null, lte: d },
      status: { notIn: ["confirm", "cancel"] },
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      follow_up_date: true,
      status: true,
      source: true,
    },
    orderBy: { follow_up_date: "asc" },
    take: OVERDUE_LIMIT,
  });

  return rows.map((l) => ({
    id: l.id,
    title: l.name,
    phone: l.phone,
    email: l.email,
    due_date: l.follow_up_date,
    status: l.status,
    source: l.source,
    health_goal: null,
    enquiry_stage: null,
    source_id: l.id,
    source_type: "lead_followup",
    priority: null,
    client_id: null,
    client_name: null,
    is_overdue: ymdOf(l.follow_up_date) < date ? 1 : 0,
  }));
}

async function fetchTasks(date, userId, tenantId) {
  const d = dateOnly(date);
  const rows = await prisma.tasks.findMany({
    where: {
      is_deleted: false,
      ...tenantClause(tenantId),
      due_date: { not: null, lte: d },
      status: { notIn: ["done", "completed"] },
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      title: true,
      description: true,
      due_date: true,
      priority: true,
      status: true,
      lead_id: true,
      task_category: true,
      task_type: true,
      client_id: true,
    },
    orderBy: { due_date: "asc" },
    take: OVERDUE_LIMIT,
  });

  const clientMap = await mapClientsByInternalId(rows.map((r) => r.client_id));
  return rows.map((t) => {
    const fc = t.client_id != null ? clientMap.get(t.client_id) : null;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      due_date: t.due_date,
      priority: t.priority,
      status: t.status,
      lead_id: t.lead_id,
      source_id: t.id,
      source_type: "task",
      is_overdue: ymdOf(t.due_date) < date ? 1 : 0,
      task_category: t.task_category ?? null,
      task_type: t.task_type ?? null,
      client_id: fc?.client_id ?? null,
      client_name: fc?.full_name ?? null,
    };
  });
}

async function fetchCalendarEvents(date, userId) {
  const start = dayStartDt(date);
  const end = dayEndDt(date);
  const rows = await prisma.crm_calendar_events.findMany({
    where: {
      user_id: userId,
      start_at: { lte: end },
    },
    select: {
      id: true,
      title: true,
      start_at: true,
      end_at: true,
      all_day: true,
      category: true,
      description: true,
    },
  });

  // Match SQL: COALESCE(end_at, start_at) >= start
  return rows
    .filter((e) => (e.end_at || e.start_at) >= start)
    .map((e) => ({
      id: e.id,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      category: e.category,
      description: e.description ?? null,
      due_date: e.start_at,
      source_id: e.id,
      source_type: "calendar_event",
      is_overdue: 0,
      priority: null,
      client_id: null,
      client_name: null,
      status: "scheduled",
    }));
}

async function fetchUpcomingCalendarEvents(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dayEndDt(date);
  const untilEnd = dayEndDt(until);
  const rows = await prisma.crm_calendar_events.findMany({
    where: {
      user_id: userId,
      start_at: { gt: after, lte: untilEnd },
    },
    select: {
      id: true,
      title: true,
      start_at: true,
      end_at: true,
      all_day: true,
      category: true,
      description: true,
    },
    orderBy: { start_at: "asc" },
    take: UPCOMING_LIMIT,
  });

  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: e.all_day,
    category: e.category,
    description: e.description ?? null,
    due_date: e.start_at,
    source_id: e.id,
    source_type: "calendar_event",
    is_overdue: 0,
    priority: null,
    client_id: null,
    client_name: null,
    status: "scheduled",
  }));
}

async function getGoogleTokenForUser() {
  return null;
}

async function fetchGoogleEventsForToday(date) {
  const token = await getGoogleTokenForUser();
  if (!token) return [];

  const from = `${date}T00:00:00.000Z`;
  const to = `${date}T23:59:59.999Z`;

  const fetchPromise = fetchGoogleEvents(token, from, to);
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve([]), GOOGLE_FETCH_TIMEOUT_MS);
  });

  try {
    const events = await Promise.race([fetchPromise, timeoutPromise]);
    if (!Array.isArray(events)) return [];
    return events.map((e) => {
      const rawId = String(e.id || "").replace(/^google-/, "");
      return {
        id: rawId,
        source_id: rawId,
        title: e.title || "Google event",
        due_date: e.start,
        start_at: e.start,
        end_at: e.end,
        all_day: e.allDay ? 1 : 0,
        google_event_id: rawId,
        description: e.description || null,
        source_type: "google_event",
        is_overdue: 0,
        priority: null,
        client_id: null,
        client_name: null,
        status: "scheduled",
      };
    });
  } catch (err) {
    console.warn("GET /today google:", err.message);
    return [];
  }
}

async function fetchAppleEventsForToday(date, userId) {
  try {
    const settings = await getAppleCalendarSettings(userId);
    if (!isAppleCalendarConnected(settings)) return [];
    const events = await fetchAppleEvents(userId, date, date);
    if (!Array.isArray(events)) return [];
    return events.map((e) => {
      const rawId = String(e.id || "").replace(/^apple(-caldav)?-/, "");
      return {
        id: rawId,
        source_id: rawId,
        title: e.title || "Apple Calendar event",
        due_date: e.start,
        start_at: e.start,
        end_at: e.end,
        all_day: e.allDay ? 1 : 0,
        apple_uid: e.meta?.appleUid || rawId,
        location: e.meta?.location || null,
        description: e.description || null,
        source_type: "apple_event",
        is_overdue: 0,
        priority: null,
        client_id: null,
        client_name: null,
        status: "scheduled",
      };
    });
  } catch (err) {
    console.warn("GET /today apple:", err.message);
    return [];
  }
}

async function fetchGoogleEventsUpcoming(date) {
  const token = await getGoogleTokenForUser();
  if (!token) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);

  const from = `${date}T23:59:59.999Z`;
  const to = `${until}T23:59:59.999Z`;
  const fetchPromise = fetchGoogleEvents(token, from, to);
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve([]), GOOGLE_FETCH_TIMEOUT_MS);
  });

  try {
    const events = await Promise.race([fetchPromise, timeoutPromise]);
    if (!Array.isArray(events)) return [];
    return events.map((e) => {
      const rawId = String(e.id || "").replace(/^google-/, "");
      return {
        id: rawId,
        source_id: rawId,
        title: e.title || "Google event",
        due_date: e.start,
        start_at: e.start,
        end_at: e.end,
        all_day: e.allDay ? 1 : 0,
        google_event_id: rawId,
        description: e.description || null,
        source_type: "google_event",
        is_overdue: 0,
        priority: null,
        client_id: null,
        client_name: null,
        status: "scheduled",
      };
    });
  } catch (err) {
    console.warn("GET /today upcoming google:", err.message);
    return [];
  }
}

async function fetchAppleEventsUpcoming(date, userId) {
  try {
    const settings = await getAppleCalendarSettings(userId);
    if (!isAppleCalendarConnected(settings)) return [];
    const until = addDaysYmd(date, UPCOMING_DAYS);
    const events = await fetchAppleEvents(userId, date, until);
    if (!Array.isArray(events)) return [];
    return events
      .filter((e) => {
        const s = new Date(e.start);
        return !Number.isNaN(s.getTime()) && s > new Date(`${date}T23:59:59`);
      })
      .map((e) => {
        const rawId = String(e.id || "").replace(/^apple(-caldav)?-/, "");
        return {
          id: rawId,
          source_id: rawId,
          title: e.title || "Apple Calendar event",
          due_date: e.start,
          start_at: e.start,
          end_at: e.end,
          all_day: e.allDay ? 1 : 0,
          apple_uid: e.meta?.appleUid || rawId,
          location: e.meta?.location || null,
          description: e.description || null,
          source_type: "apple_event",
          is_overdue: 0,
          priority: null,
          client_id: null,
          client_name: null,
          status: "scheduled",
        };
      });
  } catch (err) {
    console.warn("GET /today upcoming apple:", err.message);
    return [];
  }
}

async function fetchOpportunityFollowups(date, userId) {
  const start = dayStartDt(date);
  const end = dayEndDt(date);
  const rows = await prisma.opportunities.findMany({
    where: {
      is_deleted: false,
      followup_at: { not: null, lte: end },
      stage: { notIn: ["closed_won", "closed_lost"] },
      OR: [{ owner_user_id: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      title: true,
      followup_at: true,
      followup_type: true,
      stage: true,
      product_category: true,
      visit_purpose: true,
      phone: true,
    },
    orderBy: { followup_at: "asc" },
    take: OVERDUE_LIMIT,
  });

  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    due_date: o.followup_at,
    followup_type: o.followup_type,
    status: "pending",
    product_category: o.product_category,
    source_id: o.id,
    source_type: "opportunity_followup",
    priority: null,
    client_id: null,
    client_name: null,
    visit_purpose: o.visit_purpose ?? null,
    phone: o.phone ?? null,
    is_overdue: o.followup_at < start ? 1 : 0,
  }));
}

async function fetchCollectionFollowups(date, userId, role) {
  const collectionService = require("../services/collectionService");
  return collectionService.fetchCollectionFollowups(date, userId, role);
}

async function fetchClientFollowups(date) {
  const d = dateOnly(date);
  const rows = await prisma.fitness_clients.findMany({
    where: {
      status: "Active",
      next_due_date: { not: null, lte: d },
    },
    select: {
      client_id: true,
      full_name: true,
      next_due_date: true,
      phone: true,
      email: true,
      health_goal: true,
      plan_type: true,
      progress: true,
      status: true,
    },
  });

  return rows.map((fc) => ({
    id: fc.client_id,
    title: `Follow-up due: ${fc.full_name}`,
    due_date: fc.next_due_date,
    phone: fc.phone,
    email: fc.email,
    health_goal: fc.health_goal,
    plan_type: fc.plan_type,
    progress: fc.progress,
    client_id: fc.client_id,
    client_name: fc.full_name,
    source_type: "client_followup",
    is_overdue: ymdOf(fc.next_due_date) < date ? 1 : 0,
    source_id: fc.client_id,
    status: fc.status,
    priority: null,
  }));
}

async function fetchFitnessClientTasks(date) {
  const d = dateOnly(date);
  const rows = await prisma.fitness_client_tasks.findMany({
    where: {
      due_date: { not: null, lte: d },
      status: { notIn: ["Done", "Carried_Forward"] },
    },
    select: {
      id: true,
      task_description: true,
      due_date: true,
      priority: true,
      status: true,
      period: true,
      notes: true,
      client_id: true,
    },
    orderBy: { due_date: "asc" },
    take: OVERDUE_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((t) => {
    const desc = String(t.task_description || "").trim();
    return {
      id: t.id,
      title: desc || "Client task",
      task_description: t.task_description,
      due_date: t.due_date,
      priority: normalizePriority(t.priority),
      status: t.status,
      period: t.period,
      notes: t.notes,
      client_id: t.client_id,
      client_name: nameMap.get(t.client_id) ?? null,
      source_id: t.id,
      source_type: "fitness_client_task",
      is_overdue: ymdOf(t.due_date) < date ? 1 : 0,
    };
  });
}

async function fetchPaymentDues(date) {
  const d = dateOnly(date);
  const rows = await prisma.fitness_transactions.findMany({
    where: {
      payment_due_date: { not: null, lte: d },
      pending_inr: { gt: 0 },
    },
    select: {
      id: true,
      payment_due_date: true,
      pending_inr: true,
      received_inr: true,
      product_plan: true,
      type: true,
      transaction_date: true,
      pay_mode: true,
      client_id: true,
    },
    orderBy: { payment_due_date: "asc" },
    take: OVERDUE_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((ft) => {
    const clientName = ft.client_id ? nameMap.get(ft.client_id) ?? null : null;
    return {
      id: ft.id,
      title: `Payment due: ${clientName || ft.product_plan}`,
      due_date: ft.payment_due_date,
      pending_inr: decimalOrNull(ft.pending_inr),
      received_inr: decimalOrNull(ft.received_inr),
      product_plan: ft.product_plan,
      transaction_type: ft.type,
      transaction_date: ft.transaction_date,
      pay_mode: ft.pay_mode,
      client_id: ft.client_id,
      client_name: clientName,
      source_type: "fitness_payment_due",
      is_overdue: ymdOf(ft.payment_due_date) < date ? 1 : 0,
      source_id: ft.id,
      status: null,
      priority: "high",
    };
  });
}

async function fetchUpcomingTasks(date, userId, tenantId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.tasks.findMany({
    where: {
      is_deleted: false,
      ...tenantClause(tenantId),
      due_date: { gt: after, lte: untilD },
      status: { notIn: ["done", "completed"] },
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      title: true,
      description: true,
      due_date: true,
      priority: true,
      status: true,
      lead_id: true,
      task_category: true,
      task_type: true,
      client_id: true,
    },
    orderBy: { due_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  const clientMap = await mapClientsByInternalId(rows.map((r) => r.client_id));
  return rows.map((t) => {
    const fc = t.client_id != null ? clientMap.get(t.client_id) : null;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      due_date: t.due_date,
      priority: t.priority,
      status: t.status,
      lead_id: t.lead_id,
      source_id: t.id,
      source_type: "task",
      is_overdue: 0,
      task_category: t.task_category ?? null,
      task_type: t.task_type ?? null,
      client_id: fc?.client_id ?? null,
      client_name: fc?.full_name ?? null,
    };
  });
}

async function fetchUpcomingMeetings(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dayEndDt(date);
  const untilEnd = dayEndDt(until);
  const rows = await prisma.meetings.findMany({
    where: {
      is_deleted: false,
      start_time: { gt: after, lte: untilEnd },
      status: "scheduled",
      OR: [
        { assigned_to_user_id: userId },
        { organizer_id: userId },
        { meeting_attendees: { some: { user_id: userId } } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      start_time: true,
      end_time: true,
      status: true,
      meeting_type: true,
      client_id: true,
    },
    orderBy: { start_time: "asc" },
    take: UPCOMING_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    start_time: m.start_time,
    end_time: m.end_time,
    due_date: m.start_time,
    status: m.status,
    meeting_type: m.meeting_type,
    source_id: m.id,
    source_type: "meeting",
    is_overdue: 0,
    priority: null,
    client_id: m.client_id ?? null,
    client_name: m.client_id ? nameMap.get(m.client_id) ?? null : null,
  }));
}

async function fetchUpcomingReminders(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dayEndDt(date);
  const untilEnd = dayEndDt(until);
  const rows = await prisma.reminders.findMany({
    where: {
      is_deleted: false,
      is_done: false,
      remind_at: { gt: after, lte: untilEnd },
      OR: [{ assigned_to_user_id: userId }, { user_id: userId }],
    },
    include: {
      leads: { select: { name: true } },
    },
    orderBy: { remind_at: "asc" },
    take: UPCOMING_LIMIT,
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    due_date: r.remind_at,
    remind_at: r.remind_at,
    reminder_type: r.reminder_type,
    reminder_category: r.reminder_type,
    lead_id: r.lead_id,
    lead_name: r.leads?.name ?? null,
    status: "pending",
    source_id: r.id,
    source_type: "reminder",
    priority: null,
    is_overdue: 0,
    client_id: null,
    client_name: null,
  }));
}

async function fetchUpcomingTodos(date, userId, tenantId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.crm_todos.findMany({
    where: {
      is_deleted: false,
      status: "pending",
      ...tenantClause(tenantId),
      todo_date: { gt: after, lte: untilD },
      OR: [
        { created_by: userId },
        { crm_todo_assignees: { some: { user_id: userId } } },
      ],
    },
    select: {
      id: true,
      body: true,
      todo_date: true,
      priority: true,
      status: true,
      frequency: true,
      todo_category: true,
      client_id: true,
    },
    orderBy: { todo_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((t) => ({
    id: t.id,
    body: t.body,
    title: t.body,
    due_date: t.todo_date,
    priority: t.priority,
    status: t.status,
    frequency: t.frequency,
    source_id: t.id,
    source_type: "todo",
    is_overdue: 0,
    todo_category: t.todo_category ?? null,
    client_id: t.client_id ?? null,
    client_name: t.client_id ? nameMap.get(t.client_id) ?? null : null,
  }));
}

async function fetchUpcomingLeadFollowups(date, userId, tenantId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.leads.findMany({
    where: {
      is_deleted: false,
      ...tenantClause(tenantId),
      follow_up_date: { gt: after, lte: untilD },
      status: { notIn: ["confirm", "cancel"] },
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      follow_up_date: true,
      status: true,
      source: true,
    },
    orderBy: { follow_up_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  return rows.map((l) => ({
    id: l.id,
    title: l.name,
    phone: l.phone,
    email: l.email,
    due_date: l.follow_up_date,
    status: l.status,
    source: l.source,
    health_goal: null,
    enquiry_stage: null,
    source_id: l.id,
    source_type: "lead_followup",
    priority: null,
    client_id: null,
    client_name: null,
    is_overdue: 0,
  }));
}

async function fetchUpcomingOpportunityFollowups(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dayEndDt(date);
  const untilEnd = dayEndDt(until);
  const rows = await prisma.opportunities.findMany({
    where: {
      is_deleted: false,
      followup_at: { gt: after, lte: untilEnd },
      stage: { notIn: ["closed_won", "closed_lost"] },
      OR: [{ owner_user_id: userId }, { created_by: userId }],
    },
    select: {
      id: true,
      title: true,
      followup_at: true,
      followup_type: true,
      stage: true,
      product_category: true,
      visit_purpose: true,
      phone: true,
    },
    orderBy: { followup_at: "asc" },
    take: UPCOMING_LIMIT,
  });

  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    due_date: o.followup_at,
    followup_type: o.followup_type,
    status: "pending",
    product_category: o.product_category,
    source_id: o.id,
    source_type: "opportunity_followup",
    priority: null,
    client_id: null,
    client_name: null,
    visit_purpose: o.visit_purpose ?? null,
    phone: o.phone ?? null,
    is_overdue: 0,
  }));
}

async function fetchUpcomingCollectionFollowups(date, userId, role) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const canAll = ["admin", "manager", "owner"].includes(String(role || "").toLowerCase());

  const rows = await prisma.fitness_collections.findMany({
    where: {
      status: { in: ["open", "partial"] },
      pending_inr: { gt: 0 },
      next_followup_date: { gt: after, lte: untilD },
      ...(canAll
        ? {}
        : { OR: [{ assigned_to: userId }, { created_by: userId }] }),
    },
    include: {
      fitness_external_buyers: { select: { full_name: true } },
    },
    orderBy: { next_followup_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    due_date: c.next_followup_date,
    pending_inr: decimalOrNull(c.pending_inr),
    collection_type: c.collection_type,
    client_id: c.client_id,
    status: "pending",
    source_id: c.id,
    source_type: "collection_followup",
    priority: "high",
    is_overdue: 0,
    client_name:
      (c.client_id ? nameMap.get(c.client_id) : null) ||
      c.fitness_external_buyers?.full_name ||
      null,
  }));
}

async function fetchUpcomingClientFollowups(date) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.fitness_clients.findMany({
    where: {
      status: "Active",
      next_due_date: { gt: after, lte: untilD },
    },
    select: {
      client_id: true,
      full_name: true,
      next_due_date: true,
      phone: true,
      email: true,
      health_goal: true,
      plan_type: true,
      progress: true,
      status: true,
    },
    orderBy: { next_due_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  return rows.map((fc) => ({
    id: fc.client_id,
    title: `Follow-up due: ${fc.full_name}`,
    due_date: fc.next_due_date,
    phone: fc.phone,
    email: fc.email,
    health_goal: fc.health_goal,
    plan_type: fc.plan_type,
    progress: fc.progress,
    client_id: fc.client_id,
    client_name: fc.full_name,
    source_type: "client_followup",
    is_overdue: 0,
    source_id: fc.client_id,
    status: fc.status,
    priority: null,
  }));
}

async function fetchUpcomingFitnessClientTasks(date) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.fitness_client_tasks.findMany({
    where: {
      due_date: { gt: after, lte: untilD },
      status: { notIn: ["Done", "Carried_Forward"] },
    },
    select: {
      id: true,
      task_description: true,
      due_date: true,
      priority: true,
      status: true,
      period: true,
      notes: true,
      client_id: true,
    },
    orderBy: { due_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((t) => {
    const desc = String(t.task_description || "").trim();
    return {
      id: t.id,
      title: desc || "Client task",
      task_description: t.task_description,
      due_date: t.due_date,
      priority: normalizePriority(t.priority),
      status: t.status,
      period: t.period,
      notes: t.notes,
      client_id: t.client_id,
      client_name: nameMap.get(t.client_id) ?? null,
      source_id: t.id,
      source_type: "fitness_client_task",
      is_overdue: 0,
    };
  });
}

async function fetchUpcomingPaymentDues(date) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const after = dateOnly(date);
  const untilD = dateOnly(until);
  const rows = await prisma.fitness_transactions.findMany({
    where: {
      payment_due_date: { gt: after, lte: untilD },
      pending_inr: { gt: 0 },
    },
    select: {
      id: true,
      payment_due_date: true,
      pending_inr: true,
      received_inr: true,
      product_plan: true,
      type: true,
      transaction_date: true,
      pay_mode: true,
      client_id: true,
    },
    orderBy: { payment_due_date: "asc" },
    take: UPCOMING_LIMIT,
  });

  const nameMap = await mapClientNamesByClientId(rows.map((r) => r.client_id));
  return rows.map((ft) => {
    const clientName = ft.client_id ? nameMap.get(ft.client_id) ?? null : null;
    return {
      id: ft.id,
      title: `Payment due: ${clientName || ft.product_plan}`,
      due_date: ft.payment_due_date,
      pending_inr: decimalOrNull(ft.pending_inr),
      received_inr: decimalOrNull(ft.received_inr),
      product_plan: ft.product_plan,
      transaction_type: ft.type,
      transaction_date: ft.transaction_date,
      pay_mode: ft.pay_mode,
      client_id: ft.client_id,
      client_name: clientName,
      source_type: "fitness_payment_due",
      is_overdue: 0,
      source_id: ft.id,
      status: null,
      priority: "high",
    };
  });
}

async function safeFetch(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`GET /today ${label}:`, err.message);
    return [];
  }
}

router.get("/", async (req, res) => {
  try {
    const date = parseDateParam(req.query?.date);
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const tenantId = req.user?.tenantId ?? null;

    const includeGoogle = req.query?.include_google !== "0";

    const [
      todos,
      meetings,
      reminders,
      leadFollowups,
      clientFollowups,
      tasks,
      calendarEvents,
      googleEvents,
      appleEvents,
      opportunityFollowups,
      collectionFollowups,
      paymentDues,
      fitnessClientTasks,
    ] = await promisePool(
      [
        () => safeFetch("todos", () => fetchTodos(date, userId, tenantId)),
        () => safeFetch("meetings", () => fetchMeetings(date, userId)),
        () => safeFetch("reminders", () => fetchReminders(date, userId)),
        () => safeFetch("lead_followup", () => fetchLeadFollowups(date, userId, tenantId)),
        () => safeFetch("client_followup", () => fetchClientFollowups(date)),
        () => safeFetch("tasks", () => fetchTasks(date, userId, tenantId)),
        () => safeFetch("calendar_events", () => fetchCalendarEvents(date, userId)),
        () =>
          includeGoogle
            ? safeFetch("google_events", () => fetchGoogleEventsForToday(date))
            : [],
        () => safeFetch("apple_events", () => fetchAppleEventsForToday(date, userId)),
        () => safeFetch("opportunity_followup", () => fetchOpportunityFollowups(date, userId)),
        () =>
          safeFetch("collection_followup", () =>
            fetchCollectionFollowups(date, userId, req.user?.role)
          ),
        () => safeFetch("fitness_payment_due", () => fetchPaymentDues(date)),
        () => safeFetch("fitness_client_task", () => fetchFitnessClientTasks(date)),
      ],
      3
    );

    const raw = [
      ...todos,
      ...meetings,
      ...reminders,
      ...leadFollowups,
      ...clientFollowups,
      ...tasks,
      ...calendarEvents,
      ...googleEvents,
      ...appleEvents,
      ...opportunityFollowups,
      ...collectionFollowups,
      ...paymentDues,
      ...fitnessClientTasks,
    ];
    const items = sortItems(
      raw.map((row) => enrichTodayItem(normalizeItem(row), date))
    );
    const summary = buildSummary(items);
    const upcomingRaw = (
      await promisePool(
        [
          () => safeFetch("upcoming_todos", () => fetchUpcomingTodos(date, userId, tenantId)),
          () => safeFetch("upcoming_tasks", () => fetchUpcomingTasks(date, userId, tenantId)),
          () => safeFetch("upcoming_meetings", () => fetchUpcomingMeetings(date, userId)),
          () => safeFetch("upcoming_reminders", () => fetchUpcomingReminders(date, userId)),
          () =>
            safeFetch("upcoming_calendar_events", () => fetchUpcomingCalendarEvents(date, userId)),
          () =>
            includeGoogle
              ? safeFetch("upcoming_google_events", () => fetchGoogleEventsUpcoming(date))
              : [],
          () =>
            safeFetch("upcoming_apple_events", () => fetchAppleEventsUpcoming(date, userId)),
          () => safeFetch("upcoming_client_followups", () => fetchUpcomingClientFollowups(date)),
          () =>
            safeFetch("upcoming_lead_followups", () =>
              fetchUpcomingLeadFollowups(date, userId, tenantId)
            ),
          () =>
            safeFetch("upcoming_opportunity_followups", () =>
              fetchUpcomingOpportunityFollowups(date, userId)
            ),
          () =>
            safeFetch("upcoming_collection_followups", () =>
              fetchUpcomingCollectionFollowups(date, userId, req.user?.role)
            ),
          () =>
            safeFetch("upcoming_fitness_client_tasks", () => fetchUpcomingFitnessClientTasks(date)),
          () => safeFetch("upcoming_payment_dues", () => fetchUpcomingPaymentDues(date)),
        ],
        3
      )
    ).flat();
    const upcoming = sortItems(
      upcomingRaw.map((row) => enrichTodayItem(normalizeItem(row), date))
    ).slice(0, 10);

    res.json({ success: true, date, summary, items, upcoming });
  } catch (err) {
    console.error("GET /today:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function markTodoDone(id, userId, tenantId) {
  const todoId = Number(id);
  const row = await prisma.crm_todos.findFirst({
    where: {
      id: todoId,
      is_deleted: false,
      ...tenantClause(tenantId),
      OR: [
        { created_by: userId },
        { crm_todo_assignees: { some: { user_id: userId } } },
      ],
    },
    select: { id: true, status: true, frequency: true, todo_date: true },
  });
  if (!row) return { ok: false, status: 404 };
  if (row.status === "completed") return { ok: true, already: true };

  const freq = String(row.frequency || "once").toLowerCase();
  const now = new Date();
  if (freq === "once") {
    await prisma.crm_todos.update({
      where: { id: todoId },
      data: { status: "completed", completed_at: now, updated_at: now },
    });
  } else {
    const nextD = nextOccurrence(ymdOf(row.todo_date), freq);
    await prisma.crm_todos.update({
      where: { id: todoId },
      data: {
        todo_date: dateOnly(nextD),
        status: "pending",
        completed_at: null,
        updated_at: now,
      },
    });
  }
  return { ok: true };
}

async function markMeetingDone(id, userId) {
  const meetingId = Number(id);
  const row = await prisma.meetings.findFirst({
    where: {
      id: meetingId,
      is_deleted: false,
      OR: [{ organizer_id: userId }, { assigned_to_user_id: userId }],
    },
    select: { id: true, status: true },
  });
  if (!row) return { ok: false, status: 404 };
  if (row.status === "completed") return { ok: true, already: true };
  await prisma.meetings.update({
    where: { id: meetingId },
    data: { status: "completed" },
  });
  return { ok: true };
}

async function markReminderDone(id, userId) {
  const reminderId = Number(id);
  const row = await prisma.reminders.findFirst({
    where: {
      id: reminderId,
      is_deleted: false,
      OR: [{ user_id: userId }, { assigned_to_user_id: userId }],
    },
    select: { id: true, is_done: true },
  });
  if (!row) return { ok: false, status: 404 };
  if (row.is_done) return { ok: true, already: true };
  await prisma.reminders.update({
    where: { id: reminderId },
    data: { is_done: true },
  });
  return { ok: true };
}

async function markLeadFollowupDone(id, userId, tenantId) {
  const leadId = Number(id);
  const row = await prisma.leads.findFirst({
    where: {
      id: leadId,
      is_deleted: false,
      ...tenantClause(tenantId),
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: { id: true },
  });
  if (!row) return { ok: false, status: 404 };

  const nextFollowUp = new Date();
  nextFollowUp.setHours(0, 0, 0, 0);
  nextFollowUp.setDate(nextFollowUp.getDate() + 7);

  await prisma.$transaction([
    prisma.lead_followups.create({
      data: {
        lead_id: leadId,
        note: "Marked done from Today view",
        created_by: userId,
      },
    }),
    prisma.leads.update({
      where: { id: leadId },
      data: { follow_up_date: nextFollowUp, updated_at: new Date() },
    }),
  ]);
  return { ok: true };
}

async function markClientFollowupDone(id) {
  const clientId = String(id);
  const row = await prisma.fitness_clients.findFirst({
    where: { client_id: clientId, status: "Active" },
    select: { client_id: true, follow_up_freq_days: true },
  });
  if (!row) return { ok: false, status: 404 };

  const days = Number(row.follow_up_freq_days) || 14;
  const nextDue = new Date();
  nextDue.setHours(0, 0, 0, 0);
  nextDue.setDate(nextDue.getDate() + days);

  await prisma.fitness_clients.update({
    where: { client_id: clientId },
    data: { next_due_date: nextDue, updated_at: new Date() },
  });
  return { ok: true };
}

async function markCollectionFollowupDone(id, userId, body) {
  const collectionService = require("../services/collectionService");
  const ok = await collectionService.markCollectionFollowupDone(Number(id), userId, body || {});
  return ok ? { ok: true } : { ok: false, status: 404 };
}

async function markPaymentDueDone(id) {
  const txId = Number(id);
  const result = await prisma.fitness_transactions.updateMany({
    where: { id: txId, payment_due_date: { not: null } },
    data: { payment_due_date: null },
  });
  return result.count > 0 ? { ok: true } : { ok: false, status: 404 };
}

async function markOpportunityFollowupDone(id, userId) {
  const oppId = Number(id);
  const row = await prisma.opportunities.findFirst({
    where: {
      id: oppId,
      is_deleted: false,
      stage: { notIn: ["closed_won", "closed_lost"] },
      OR: [{ owner_user_id: userId }, { created_by: userId }],
    },
    select: { id: true },
  });
  if (!row) return { ok: false, status: 404 };

  const nextFollowUp = new Date();
  nextFollowUp.setHours(0, 0, 0, 0);
  nextFollowUp.setDate(nextFollowUp.getDate() + 7);

  await prisma.opportunities.update({
    where: { id: oppId },
    data: { followup_at: nextFollowUp, updated_at: new Date() },
  });
  return { ok: true };
}

async function syncFitnessClientNextDueAfterTaskDone(taskId) {
  const task = await prisma.tasks.findUnique({
    where: { id: taskId },
    select: { client_id: true },
  });
  const fcInternalId = task?.client_id;
  if (!fcInternalId) return false;

  const client = await prisma.fitness_clients.findFirst({
    where: { id: fcInternalId, status: "Active" },
    select: { client_id: true, follow_up_freq_days: true },
  });
  if (!client) return false;

  const days = Number(client.follow_up_freq_days) || 14;
  const nextDue = new Date();
  nextDue.setHours(0, 0, 0, 0);
  nextDue.setDate(nextDue.getDate() + days);

  await prisma.fitness_clients.update({
    where: { client_id: client.client_id },
    data: { next_due_date: nextDue, updated_at: new Date() },
  });
  return true;
}

async function markTaskDone(id, userId, tenantId) {
  const taskId = Number(id);
  const row = await prisma.tasks.findFirst({
    where: {
      id: taskId,
      is_deleted: false,
      ...tenantClause(tenantId),
      OR: [{ assigned_to: userId }, { created_by: userId }],
    },
    select: { id: true, status: true },
  });
  if (!row) return { ok: false, status: 404 };
  const st = String(row.status || "").toLowerCase();
  if (st === "done" || st === "completed") return { ok: true, already: true };

  await prisma.tasks.update({
    where: { id: taskId },
    data: { status: "done", updated_at: new Date() },
  });
  const fitnessSynced = await syncFitnessClientNextDueAfterTaskDone(taskId);
  return { ok: true, fitnessSynced };
}

async function markFitnessClientTaskDone(id) {
  const taskId = Number(id);
  const today = formatYmd(new Date());
  const row = await prisma.fitness_client_tasks.findFirst({
    where: {
      id: taskId,
      status: { notIn: ["Done", "Carried_Forward"] },
    },
    select: { id: true, client_id: true },
  });
  if (!row) return { ok: false, status: 404 };

  await prisma.fitness_client_tasks.update({
    where: { id: taskId },
    data: { status: "Done", completed_on: dateOnly(today) },
  });

  const clientId = row.client_id;
  if (clientId) {
    const client = await prisma.fitness_clients.findFirst({
      where: { client_id: clientId },
      select: { follow_up_freq_days: true },
    });
    if (client) {
      const days = Number(client.follow_up_freq_days) || 14;
      const nextDue = addDaysLocal(today, days);
      await prisma.fitness_clients.update({
        where: { client_id: clientId },
        data: { next_due_date: nextDue, updated_at: new Date() },
      });
    }
  }
  return { ok: true, fitnessSynced: Boolean(clientId) };
}

const VALID_SOURCE_TYPES = new Set([
  "todo",
  "meeting",
  "reminder",
  "lead_followup",
  "client_followup",
  "task",
  "opportunity_followup",
  "collection_followup",
  "fitness_payment_due",
  "fitness_client_task",
]);

router.patch("/:sourceType/:id/done", async (req, res) => {
  try {
    const sourceType = String(req.params.sourceType || "").toLowerCase();
    const id = req.params.id;
    const userId = Number(req.user?.id);
    const tenantId = req.user?.tenantId ?? null;

    if (!VALID_SOURCE_TYPES.has(sourceType)) {
      return res.status(400).json({ success: false, message: "Invalid source type" });
    }
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    let result;
    switch (sourceType) {
      case "todo":
        result = await markTodoDone(id, userId, tenantId);
        break;
      case "meeting":
        result = await markMeetingDone(id, userId);
        break;
      case "reminder":
        result = await markReminderDone(id, userId);
        break;
      case "lead_followup":
        result = await markLeadFollowupDone(id, userId, tenantId);
        break;
      case "client_followup":
        result = await markClientFollowupDone(id, userId);
        break;
      case "task":
        result = await markTaskDone(id, userId, tenantId);
        break;
      case "opportunity_followup":
        result = await markOpportunityFollowupDone(id, userId);
        break;
      case "collection_followup":
        result = await markCollectionFollowupDone(id, userId, req.body);
        break;
      case "fitness_payment_due":
        result = await markPaymentDueDone(id);
        break;
      case "fitness_client_task":
        result = await markFitnessClientTaskDone(id);
        break;
      default:
        result = { ok: false, status: 400 };
    }

    if (!result.ok) {
      return res.status(result.status || 404).json({
        success: false,
        message: "Item not found or not accessible",
      });
    }

    emitCalendarChanged({ reason: "today_done", tenantId: tenantId || undefined });
    if (sourceType === "todo") {
      emitTodosChanged({ action: "today_done", id, tenantId: tenantId || undefined });
    } else if (sourceType === "meeting") {
      emitMeetingsChanged({ action: "today_done", id });
    } else if (sourceType === "client_followup") {
      emitFitnessChanged();
    } else if (sourceType === "lead_followup") {
      emitCalendarChanged({ reason: "leads", tenantId: tenantId || undefined });
      emitLeadsChanged({ reason: "today_done", id });
    } else if (sourceType === "reminder") {
      emitCalendarChanged({ reason: "reminders", tenantId: tenantId || undefined });
      emitRemindersChanged({ reason: "today_done", id });
    } else if (sourceType === "task") {
      emitCalendarChanged({ reason: "task_done", tenantId: tenantId || undefined });
      emitTasksChanged({ reason: "today_done", id, tenantId: tenantId || undefined });
      if (result.fitnessSynced) {
        emitFitnessChanged();
      }
    } else if (sourceType === "opportunity_followup") {
      emitOpportunitiesChanged({ reason: "today_done", id });
    } else if (sourceType === "collection_followup") {
      const { emitCollectionsChanged } = require("../realtime/meetingsRealtime");
      emitCollectionsChanged({ reason: "today_done", id });
    } else if (sourceType === "fitness_payment_due") {
      emitFitnessChanged();
    } else if (sourceType === "fitness_client_task") {
      emitFitnessChanged();
      if (result.fitnessSynced) {
        emitTasksChanged({ reason: "client_task_done", id });
        emitCalendarChanged({ reason: "client_task_done" });
      }
    }

    res.json({ success: true, source_type: sourceType, id });
  } catch (err) {
    console.error("PATCH /today/:sourceType/:id/done:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
