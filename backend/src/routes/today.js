const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
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

const GOOGLE_FETCH_TIMEOUT_MS = 3000;
const OVERDUE_LIMIT = 200;
const UPCOMING_LIMIT = 50;
const UPCOMING_DAYS = 14;

let fitnessTableExists = null;

const router = express.Router();
router.use(verifyToken);

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

const columnCache = new Map();

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  const exists = rows.length > 0;
  columnCache.set(key, exists);
  return exists;
}

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

function dayStart(date) {
  return `${date} 00:00:00`;
}

function dayEndExclusive(date) {
  return `${date} 23:59:59`;
}

function addDaysYmd(date, days) {
  const d = new Date(`${date}T00:00:00`);
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

function formatDisplayDate(ymdOrDate, dateOnly) {
  const s = String(ymdOrDate).slice(0, 10);
  const d = dateOnly ? new Date(`${s}T12:00:00`) : new Date(ymdOrDate);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDisplayTime(dueRaw, dateOnly) {
  if (dateOnly) return null;
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

  const dateOnly = isDateOnlyDue(item.source_type, dueRaw);
  const dueYmd = String(dueRaw).slice(0, 10);
  const dateText = formatDisplayDate(dueRaw, dateOnly);
  const timeText = formatDisplayTime(dueRaw, dateOnly);

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

async function fetchTodos(date, userId, tenantId) {
  const hasClientCol = await hasColumn("crm_todos", "client_id");
  const hasCategoryCol = await hasColumn("crm_todos", "todo_category");
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = t.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", t.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const categorySelect = hasCategoryCol ? ", t.todo_category" : ", NULL AS todo_category";

  const [rows] = await pool.execute(
    `SELECT t.id, t.body, t.body AS title, t.todo_date AS due_date, t.priority, t.status,
            t.frequency, t.id AS source_id, 'todo' AS source_type,
            CASE WHEN t.todo_date < ? THEN 1 ELSE 0 END AS is_overdue
            ${categorySelect}
            ${clientSelect}
     FROM crm_todos t
     ${clientJoin}
     WHERE t.is_deleted = 0
       AND t.status = 'pending'
       AND (? IS NULL OR t.tenant_id = ?)
       AND (
         t.todo_date = ?
         OR (t.todo_date < ? AND t.carry_forward = 1)
       )
       AND (
         t.created_by = ?
         OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?)
       )`,
    [date, tenantId, tenantId, date, date, userId, userId]
  );
  return rows;
}

async function fetchMeetings(date, userId) {
  const hasConsultType = await hasColumn("meetings", "consultation_type");
  const hasClientCol = await hasColumn("meetings", "client_id");
  const hasIsDeleted = await hasColumn("meetings", "is_deleted");
  const consultSelect = hasConsultType ? ", m.consultation_type" : ", NULL AS consultation_type";
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = m.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", m.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";

  const where = [
    "m.start_time >= ?",
    "m.start_time <= ?",
    "m.status = 'scheduled'",
    "(m.assigned_to_user_id = ? OR m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?))",
  ];
  if (hasIsDeleted) where.unshift("m.is_deleted = 0");

  const [rows] = await pool.execute(
    `SELECT m.id, m.title, m.description, m.start_time, m.end_time, m.meeting_type, m.status,
            m.location, m.meet_link, m.start_time AS due_date, m.id AS source_id,
            'meeting' AS source_type, 0 AS is_overdue, NULL AS priority
            ${consultSelect}
            ${clientSelect}
     FROM meetings m
     ${clientJoin}
     WHERE ${where.join(" AND ")}`,
    [dayStart(date), dayEndExclusive(date), userId, userId, userId]
  );
  return rows;
}

async function fetchReminders(date, userId) {
  const hasClientCol = await hasColumn("reminders", "client_id");
  const hasCategoryCol = await hasColumn("reminders", "reminder_category");
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = r.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", r.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const categorySelect = hasCategoryCol
    ? ", r.reminder_category"
    : ", r.reminder_type AS reminder_category";

  const [rows] = await pool.execute(
    `SELECT r.id, r.title, r.note, r.remind_at AS due_date, r.remind_at,
            r.reminder_type, r.lead_id, l.name AS lead_name, r.is_done AS status,
            r.id AS source_id, 'reminder' AS source_type, NULL AS priority
            ${categorySelect}
            ${clientSelect}
     FROM reminders r
     LEFT JOIN leads l ON l.id = r.lead_id
     ${clientJoin}
     WHERE r.is_deleted = 0
       AND r.is_done = 0
       AND (
         (r.remind_at >= ? AND r.remind_at <= ?)
         OR (r.remind_at < ?)
       )
       AND (r.assigned_to_user_id = ? OR r.user_id = ?)
     ORDER BY r.remind_at ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [dayStart(date), dayEndExclusive(date), dayStart(date), userId, userId]
  );
  return rows.map((r) => ({
    ...r,
    is_overdue: String(r.due_date).slice(0, 10) < date ? 1 : 0,
    status: "pending",
  }));
}

async function fetchLeadFollowups(date, userId, tenantId) {
  const hasHealthGoal = await hasColumn("leads", "health_goal");
  const hasEnquiry = await hasColumn("leads", "enquiry_stage");
  const hasTenant = await hasColumn("leads", "tenant_id");
  const hasIsDeleted = await hasColumn("leads", "is_deleted");
  const extraSelect = [
    hasHealthGoal ? "l.health_goal" : "NULL AS health_goal",
    hasEnquiry ? "l.enquiry_stage" : "NULL AS enquiry_stage",
  ].join(", ");

  const params = [];
  const where = [];
  if (hasIsDeleted) where.push("l.is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR l.tenant_id = ?)");
    params.push(tenantId, tenantId);
  }
  where.push(
    "l.follow_up_date IS NOT NULL",
    "l.follow_up_date <= ?",
    "l.status NOT IN ('confirm', 'cancel')",
    "(l.assigned_to = ? OR l.created_by = ?)"
  );
  params.push(date, userId, userId);

  const [rows] = await pool.execute(
    `SELECT l.id, l.name AS title, l.phone, l.email, l.follow_up_date AS due_date,
            l.status, l.source, ${extraSelect},
            l.id AS source_id, 'lead_followup' AS source_type, NULL AS priority,
            NULL AS client_id, NULL AS client_name,
            CASE WHEN l.follow_up_date < ? THEN 1 ELSE 0 END AS is_overdue
     FROM leads l
     WHERE ${where.join(" AND ")}
     ORDER BY l.follow_up_date ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [date, ...params]
  );
  return rows;
}

async function fitnessClientsTableExists() {
  if (fitnessTableExists !== null) return fitnessTableExists;
  const [tables] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_clients' LIMIT 1`
  );
  fitnessTableExists = tables.length > 0;
  return fitnessTableExists;
}

async function fetchTasks(date, userId, tenantId) {
  const hasClientCol = await hasColumn("tasks", "client_id");
  const hasTenant = await hasColumn("tasks", "tenant_id");
  const hasCategory = await hasColumn("tasks", "task_category");
  const hasType = await hasColumn("tasks", "task_type");
  const hasIsDeleted = await hasColumn("tasks", "is_deleted");
  const categorySelect = hasCategory ? ", t.task_category" : ", NULL AS task_category";
  const typeSelect = hasType ? ", t.task_type" : ", NULL AS task_type";
  const clientJoin = hasClientCol ? "LEFT JOIN fitness_clients fc ON fc.id = t.client_id" : "";
  const clientSelect = hasClientCol
    ? ", fc.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";

  const where = ["t.due_date IS NOT NULL", "t.status NOT IN ('done','completed')"];
  const params = [];
  if (hasIsDeleted) where.push("t.is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR t.tenant_id = ?)");
    params.push(tenantId, tenantId);
  }
  where.push("DATE(t.due_date) <= ?", "(t.assigned_to = ? OR t.created_by = ?)");
  params.push(date, userId, userId);

  const [rows] = await pool.execute(
    `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.lead_id,
            t.id AS source_id, 'task' AS source_type,
            CASE WHEN DATE(t.due_date) < ? THEN 1 ELSE 0 END AS is_overdue
            ${categorySelect}
            ${typeSelect}
            ${clientSelect}
     FROM tasks t
     ${clientJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY t.due_date ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [date, ...params]
  );
  return rows;
}

async function fetchCalendarEvents(date, userId) {
  const [tables] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_calendar_events' LIMIT 1`
  );
  if (!tables.length) return [];

  const hasDesc = await hasColumn("crm_calendar_events", "description");
  const descSelect = hasDesc ? ", e.description" : ", NULL AS description";
  const [rows] = await pool.execute(
    `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.category
            ${descSelect},
            e.start_at AS due_date, e.id AS source_id, 'calendar_event' AS source_type,
            0 AS is_overdue, NULL AS priority, NULL AS client_id, NULL AS client_name,
            'scheduled' AS status
     FROM crm_calendar_events e
     WHERE e.user_id = ?
       AND e.start_at <= ?
       AND COALESCE(e.end_at, e.start_at) >= ?`,
    [userId, dayEndExclusive(date), dayStart(date)]
  );
  return rows;
}

async function fetchUpcomingCalendarEvents(date, userId) {
  const [tables] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_calendar_events' LIMIT 1`
  );
  if (!tables.length) return [];

  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasDesc = await hasColumn("crm_calendar_events", "description");
  const descSelect = hasDesc ? ", e.description" : ", NULL AS description";
  const [rows] = await pool.execute(
    `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.category
            ${descSelect},
            e.start_at AS due_date, e.id AS source_id, 'calendar_event' AS source_type,
            0 AS is_overdue, NULL AS priority, NULL AS client_id, NULL AS client_name,
            'scheduled' AS status
     FROM crm_calendar_events e
     WHERE e.user_id = ?
       AND e.start_at > ?
       AND e.start_at <= ?
     ORDER BY e.start_at ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [userId, dayEndExclusive(date), dayEndExclusive(until)]
  );
  return rows;
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

async function opportunitiesTableExists() {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opportunities' LIMIT 1`
  );
  return rows.length > 0;
}

async function fetchOpportunityFollowups(date, userId) {
  if (!(await opportunitiesTableExists())) return [];

  const hasVisitPurpose = await hasColumn("opportunities", "visit_purpose");
  const hasPhone = await hasColumn("opportunities", "phone");
  const visitSelect = hasVisitPurpose ? ", o.visit_purpose" : ", NULL AS visit_purpose";
  const phoneSelect = hasPhone ? ", o.phone" : ", NULL AS phone";

  const [rows] = await pool.execute(
    `SELECT o.id, o.title, o.followup_at AS due_date, o.followup_type, o.stage AS status,
            o.product_category, o.id AS source_id, 'opportunity_followup' AS source_type,
            NULL AS priority, NULL AS client_id, NULL AS client_name
            ${visitSelect}
            ${phoneSelect},
            CASE WHEN o.followup_at < ? THEN 1 ELSE 0 END AS is_overdue
     FROM opportunities o
     WHERE o.is_deleted = 0
       AND o.followup_at IS NOT NULL
       AND o.followup_at <= ?
       AND o.stage NOT IN ('closed_won', 'closed_lost')
       AND (o.owner_user_id = ? OR o.created_by = ?)
     ORDER BY o.followup_at ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [dayStart(date), dayEndExclusive(date), userId, userId]
  );
  return rows.map((r) => ({
    ...r,
    status: "pending",
  }));
}

async function collectionsTableExists() {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_collections' LIMIT 1`
  );
  return rows.length > 0;
}

async function fetchCollectionFollowups(date, userId, role) {
  if (!(await collectionsTableExists())) return [];
  const collectionService = require("../services/collectionService");
  return collectionService.fetchCollectionFollowups(date, userId, role);
}

async function fetchClientFollowups(date) {
  if (!(await fitnessClientsTableExists())) return [];

  const [rows] = await pool.execute(
    `SELECT fc.client_id AS id,
            CONCAT('Follow-up due: ', fc.full_name) AS title,
            fc.next_due_date AS due_date, fc.phone, fc.email,
            fc.health_goal, fc.plan_type, fc.progress,
            fc.client_id, fc.full_name AS client_name,
            'client_followup' AS source_type,
            CASE WHEN fc.next_due_date < ? THEN 1 ELSE 0 END AS is_overdue,
            fc.client_id AS source_id, fc.status, NULL AS priority
     FROM fitness_clients fc
     WHERE fc.status = 'Active'
       AND fc.next_due_date IS NOT NULL
       AND fc.next_due_date <= ?`,
    [date, date]
  );
  return rows;
}

async function fitnessClientTasksTableExists() {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_client_tasks' LIMIT 1`
  );
  return rows.length > 0;
}

async function fetchFitnessClientTasks(date) {
  if (!(await fitnessClientTasksTableExists())) return [];

  const [rows] = await pool.execute(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(t.task_description), ''), 'Client task') AS title,
            t.task_description, t.due_date, t.priority, t.status, t.period, t.notes,
            t.client_id, fc.full_name AS client_name,
            t.id AS source_id, 'fitness_client_task' AS source_type,
            CASE WHEN t.due_date < ? THEN 1 ELSE 0 END AS is_overdue,
            CASE LOWER(TRIM(t.priority))
              WHEN 'high' THEN 'high'
              WHEN 'medium' THEN 'medium'
              WHEN 'low' THEN 'low'
              ELSE NULL
            END AS priority_norm
     FROM fitness_client_tasks t
     LEFT JOIN fitness_clients fc ON fc.client_id = t.client_id
     WHERE t.due_date IS NOT NULL
       AND t.due_date <= ?
       AND t.status NOT IN ('Done', 'Carried Forward')
     ORDER BY t.due_date ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [date, date]
  );
  return rows.map((r) => ({ ...r, priority: r.priority_norm || null }));
}

async function fetchPaymentDues(date) {
  if (!(await hasColumn("fitness_transactions", "payment_due_date"))) return [];

  const [rows] = await pool.execute(
    `SELECT ft.id,
            CONCAT('Payment due: ', COALESCE(fc.full_name, ft.product_plan)) AS title,
            ft.payment_due_date AS due_date,
            ft.pending_inr, ft.received_inr, ft.product_plan, ft.type AS transaction_type,
            ft.transaction_date, ft.pay_mode,
            ft.client_id, fc.full_name AS client_name,
            'fitness_payment_due' AS source_type,
            CASE WHEN DATE(ft.payment_due_date) < ? THEN 1 ELSE 0 END AS is_overdue,
            ft.id AS source_id, NULL AS status, 'high' AS priority
     FROM fitness_transactions ft
     LEFT JOIN fitness_clients fc ON fc.client_id = ft.client_id
     WHERE ft.payment_due_date IS NOT NULL
       AND COALESCE(ft.pending_inr, 0) > 0
       AND DATE(ft.payment_due_date) <= ?
     ORDER BY ft.payment_due_date ASC
     LIMIT ${OVERDUE_LIMIT}`,
    [date, date]
  );
  return rows;
}

async function fetchUpcomingTasks(date, userId, tenantId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasClientCol = await hasColumn("tasks", "client_id");
  const hasTenant = await hasColumn("tasks", "tenant_id");
  const hasCategory = await hasColumn("tasks", "task_category");
  const hasType = await hasColumn("tasks", "task_type");
  const hasIsDeleted = await hasColumn("tasks", "is_deleted");
  const categorySelect = hasCategory ? ", t.task_category" : ", NULL AS task_category";
  const typeSelect = hasType ? ", t.task_type" : ", NULL AS task_type";
  const clientJoin = hasClientCol ? "LEFT JOIN fitness_clients fc ON fc.id = t.client_id" : "";
  const clientSelect = hasClientCol
    ? ", fc.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const where = [
    "t.due_date IS NOT NULL",
    "DATE(t.due_date) > ?",
    "DATE(t.due_date) <= ?",
    "t.status NOT IN ('done','completed')",
    "(t.assigned_to = ? OR t.created_by = ?)",
  ];
  const params = [date, until, userId, userId];
  if (hasIsDeleted) where.unshift("t.is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR t.tenant_id = ?)");
    params.push(tenantId, tenantId);
  }

  const [rows] = await pool.execute(
    `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.lead_id,
            t.id AS source_id, 'task' AS source_type,
            0 AS is_overdue
            ${categorySelect}
            ${typeSelect}
            ${clientSelect}
     FROM tasks t
     ${clientJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY t.due_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    params
  );
  return rows;
}

async function fetchUpcomingMeetings(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasClientCol = await hasColumn("meetings", "client_id");
  const hasIsDeleted = await hasColumn("meetings", "is_deleted");
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = m.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", m.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const where = [
    "m.start_time > ?",
    "m.start_time <= ?",
    "m.status = 'scheduled'",
    "(m.assigned_to_user_id = ? OR m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?))",
  ];
  if (hasIsDeleted) where.unshift("m.is_deleted = 0");
  const [rows] = await pool.execute(
    `SELECT m.id, m.title, m.description, m.start_time, m.end_time,
            m.start_time AS due_date, m.status, m.meeting_type,
            m.id AS source_id, 'meeting' AS source_type,
            0 AS is_overdue, NULL AS priority
            ${clientSelect}
     FROM meetings m
     ${clientJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY m.start_time ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [dayEndExclusive(date), dayEndExclusive(until), userId, userId, userId]
  );
  return rows;
}

async function fetchUpcomingReminders(date, userId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasClientCol = await hasColumn("reminders", "client_id");
  const hasCategoryCol = await hasColumn("reminders", "reminder_category");
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = r.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", r.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const categorySelect = hasCategoryCol
    ? ", r.reminder_category"
    : ", r.reminder_type AS reminder_category";

  const [rows] = await pool.execute(
    `SELECT r.id, r.title, r.note, r.remind_at AS due_date, r.remind_at,
            r.reminder_type, r.lead_id, l.name AS lead_name, r.is_done AS status,
            r.id AS source_id, 'reminder' AS source_type, NULL AS priority,
            0 AS is_overdue
            ${categorySelect}
            ${clientSelect}
     FROM reminders r
     LEFT JOIN leads l ON l.id = r.lead_id
     ${clientJoin}
     WHERE r.is_deleted = 0
       AND r.is_done = 0
       AND r.remind_at > ?
       AND r.remind_at <= ?
       AND (r.assigned_to_user_id = ? OR r.user_id = ?)
     ORDER BY r.remind_at ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [dayEndExclusive(date), dayEndExclusive(until), userId, userId]
  );
  return rows.map((r) => ({ ...r, status: "pending" }));
}

async function fetchUpcomingTodos(date, userId, tenantId) {
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasClientCol = await hasColumn("crm_todos", "client_id");
  const hasCategoryCol = await hasColumn("crm_todos", "todo_category");
  const clientJoin = hasClientCol
    ? "LEFT JOIN fitness_clients fc ON fc.client_id = t.client_id"
    : "";
  const clientSelect = hasClientCol
    ? ", t.client_id, fc.full_name AS client_name"
    : ", NULL AS client_id, NULL AS client_name";
  const categorySelect = hasCategoryCol ? ", t.todo_category" : ", NULL AS todo_category";

  const [rows] = await pool.execute(
    `SELECT t.id, t.body, t.body AS title, t.todo_date AS due_date, t.priority, t.status,
            t.frequency, t.id AS source_id, 'todo' AS source_type, 0 AS is_overdue
            ${categorySelect}
            ${clientSelect}
     FROM crm_todos t
     ${clientJoin}
     WHERE t.is_deleted = 0
       AND t.status = 'pending'
       AND (? IS NULL OR t.tenant_id = ?)
       AND t.todo_date > ?
       AND t.todo_date <= ?
       AND (
         t.created_by = ?
         OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?)
       )
     ORDER BY t.todo_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [tenantId, tenantId, date, until, userId, userId]
  );
  return rows;
}

async function fetchUpcomingLeadFollowups(date, userId, tenantId) {
  const hasHealthGoal = await hasColumn("leads", "health_goal");
  const hasEnquiry = await hasColumn("leads", "enquiry_stage");
  const hasTenant = await hasColumn("leads", "tenant_id");
  const hasIsDeleted = await hasColumn("leads", "is_deleted");
  const extraSelect = [
    hasHealthGoal ? "l.health_goal" : "NULL AS health_goal",
    hasEnquiry ? "l.enquiry_stage" : "NULL AS enquiry_stage",
  ].join(", ");

  const until = addDaysYmd(date, UPCOMING_DAYS);
  const params = [];
  const where = [];
  if (hasIsDeleted) where.push("l.is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR l.tenant_id = ?)");
    params.push(tenantId, tenantId);
  }
  where.push(
    "l.follow_up_date IS NOT NULL",
    "l.follow_up_date > ?",
    "l.follow_up_date <= ?",
    "l.status NOT IN ('confirm', 'cancel')",
    "(l.assigned_to = ? OR l.created_by = ?)"
  );
  params.push(date, until, userId, userId);

  const [rows] = await pool.execute(
    `SELECT l.id, l.name AS title, l.phone, l.email, l.follow_up_date AS due_date,
            l.status, l.source, ${extraSelect},
            l.id AS source_id, 'lead_followup' AS source_type, NULL AS priority,
            NULL AS client_id, NULL AS client_name,
            0 AS is_overdue
     FROM leads l
     WHERE ${where.join(" AND ")}
     ORDER BY l.follow_up_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    params
  );
  return rows;
}

async function fetchUpcomingOpportunityFollowups(date, userId) {
  if (!(await opportunitiesTableExists())) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const hasVisitPurpose = await hasColumn("opportunities", "visit_purpose");
  const hasPhone = await hasColumn("opportunities", "phone");
  const visitSelect = hasVisitPurpose ? ", o.visit_purpose" : ", NULL AS visit_purpose";
  const phoneSelect = hasPhone ? ", o.phone" : ", NULL AS phone";

  const [rows] = await pool.execute(
    `SELECT o.id, o.title, o.followup_at AS due_date, o.followup_type, o.stage AS status,
            o.product_category, o.id AS source_id, 'opportunity_followup' AS source_type,
            NULL AS priority, NULL AS client_id, NULL AS client_name
            ${visitSelect}
            ${phoneSelect},
            0 AS is_overdue
     FROM opportunities o
     WHERE o.is_deleted = 0
       AND o.followup_at IS NOT NULL
       AND o.followup_at > ?
       AND o.followup_at <= ?
       AND o.stage NOT IN ('closed_won', 'closed_lost')
       AND (o.owner_user_id = ? OR o.created_by = ?)
     ORDER BY o.followup_at ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [dayEndExclusive(date), dayEndExclusive(until), userId, userId]
  );
  return rows.map((r) => ({ ...r, status: "pending" }));
}

async function fetchUpcomingCollectionFollowups(date, userId, role) {
  if (!(await collectionsTableExists())) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const canAll = ["admin", "manager", "owner"].includes(String(role || "").toLowerCase());
  const scope = canAll
    ? ""
    : "AND (c.assigned_to = ? OR c.created_by = ?)";
  const scopeParams = canAll ? [] : [userId, userId];

  const [rows] = await pool.execute(
    `SELECT c.id, c.title, c.next_followup_date AS due_date, c.pending_inr, c.collection_type,
            c.client_id, c.status, c.id AS source_id, 'collection_followup' AS source_type,
            'high' AS priority, 0 AS is_overdue,
            COALESCE(fc.full_name, eb.full_name) AS client_name
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE c.status IN ('open','partial')
       AND c.pending_inr > 0
       AND c.next_followup_date IS NOT NULL
       AND c.next_followup_date > ?
       AND c.next_followup_date <= ?
       ${scope}
     ORDER BY c.next_followup_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [date, until, ...scopeParams]
  );
  return rows.map((r) => ({ ...r, status: "pending" }));
}

async function fetchUpcomingClientFollowups(date) {
  if (!(await fitnessClientsTableExists())) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const [rows] = await pool.execute(
    `SELECT fc.client_id AS id,
            CONCAT('Follow-up due: ', fc.full_name) AS title,
            fc.next_due_date AS due_date, fc.phone, fc.email,
            fc.health_goal, fc.plan_type, fc.progress,
            fc.client_id, fc.full_name AS client_name,
            'client_followup' AS source_type, 0 AS is_overdue,
            fc.client_id AS source_id, fc.status, NULL AS priority
     FROM fitness_clients fc
     WHERE fc.status = 'Active'
       AND fc.next_due_date IS NOT NULL
       AND fc.next_due_date > ?
       AND fc.next_due_date <= ?
     ORDER BY fc.next_due_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [date, until]
  );
  return rows;
}

async function fetchUpcomingFitnessClientTasks(date) {
  if (!(await fitnessClientTasksTableExists())) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const [rows] = await pool.execute(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(t.task_description), ''), 'Client task') AS title,
            t.task_description, t.due_date, t.priority, t.status, t.period, t.notes,
            t.client_id, fc.full_name AS client_name,
            t.id AS source_id, 'fitness_client_task' AS source_type,
            0 AS is_overdue,
            CASE LOWER(TRIM(t.priority))
              WHEN 'high' THEN 'high'
              WHEN 'medium' THEN 'medium'
              WHEN 'low' THEN 'low'
              ELSE NULL
            END AS priority_norm
     FROM fitness_client_tasks t
     LEFT JOIN fitness_clients fc ON fc.client_id = t.client_id
     WHERE t.due_date IS NOT NULL
       AND t.due_date > ?
       AND t.due_date <= ?
       AND t.status NOT IN ('Done', 'Carried Forward')
     ORDER BY t.due_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [date, until]
  );
  return rows.map((r) => ({ ...r, priority: r.priority_norm || null }));
}

async function fetchUpcomingPaymentDues(date) {
  if (!(await hasColumn("fitness_transactions", "payment_due_date"))) return [];
  const until = addDaysYmd(date, UPCOMING_DAYS);
  const [rows] = await pool.execute(
    `SELECT ft.id,
            CONCAT('Payment due: ', COALESCE(fc.full_name, ft.product_plan)) AS title,
            ft.payment_due_date AS due_date,
            ft.pending_inr, ft.received_inr, ft.product_plan, ft.type AS transaction_type,
            ft.transaction_date, ft.pay_mode,
            ft.client_id, fc.full_name AS client_name,
            'fitness_payment_due' AS source_type,
            0 AS is_overdue,
            ft.id AS source_id, NULL AS status, 'high' AS priority
     FROM fitness_transactions ft
     LEFT JOIN fitness_clients fc ON fc.client_id = ft.client_id
     WHERE ft.payment_due_date IS NOT NULL
       AND COALESCE(ft.pending_inr, 0) > 0
       AND DATE(ft.payment_due_date) > ?
       AND DATE(ft.payment_due_date) <= ?
     ORDER BY ft.payment_due_date ASC
     LIMIT ${UPCOMING_LIMIT}`,
    [date, until]
  );
  return rows;
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
    ] = await Promise.all([
      safeFetch("todos", () => fetchTodos(date, userId, tenantId)),
      safeFetch("meetings", () => fetchMeetings(date, userId)),
      safeFetch("reminders", () => fetchReminders(date, userId)),
      safeFetch("lead_followup", () => fetchLeadFollowups(date, userId, tenantId)),
      safeFetch("client_followup", () => fetchClientFollowups(date)),
      safeFetch("tasks", () => fetchTasks(date, userId, tenantId)),
      safeFetch("calendar_events", () => fetchCalendarEvents(date, userId)),
      includeGoogle
        ? safeFetch("google_events", () => fetchGoogleEventsForToday(date))
        : Promise.resolve([]),
      safeFetch("apple_events", () => fetchAppleEventsForToday(date, userId)),
      safeFetch("opportunity_followup", () => fetchOpportunityFollowups(date, userId)),
      safeFetch("collection_followup", () =>
        fetchCollectionFollowups(date, userId, req.user?.role)
      ),
      safeFetch("fitness_payment_due", () => fetchPaymentDues(date)),
      safeFetch("fitness_client_task", () => fetchFitnessClientTasks(date)),
    ]);

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
      await Promise.all([
        safeFetch("upcoming_todos", () => fetchUpcomingTodos(date, userId, tenantId)),
        safeFetch("upcoming_tasks", () => fetchUpcomingTasks(date, userId, tenantId)),
        safeFetch("upcoming_meetings", () => fetchUpcomingMeetings(date, userId)),
        safeFetch("upcoming_reminders", () => fetchUpcomingReminders(date, userId)),
        safeFetch("upcoming_calendar_events", () => fetchUpcomingCalendarEvents(date, userId)),
        includeGoogle
          ? safeFetch("upcoming_google_events", () => fetchGoogleEventsUpcoming(date))
          : Promise.resolve([]),
        safeFetch("upcoming_apple_events", () => fetchAppleEventsUpcoming(date, userId)),
        safeFetch("upcoming_client_followups", () => fetchUpcomingClientFollowups(date)),
        safeFetch("upcoming_lead_followups", () =>
          fetchUpcomingLeadFollowups(date, userId, tenantId)
        ),
        safeFetch("upcoming_opportunity_followups", () =>
          fetchUpcomingOpportunityFollowups(date, userId)
        ),
        safeFetch("upcoming_collection_followups", () =>
          fetchUpcomingCollectionFollowups(date, userId, req.user?.role)
        ),
        safeFetch("upcoming_fitness_client_tasks", () => fetchUpcomingFitnessClientTasks(date)),
        safeFetch("upcoming_payment_dues", () => fetchUpcomingPaymentDues(date)),
      ])
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
  const [rows] = await pool.execute(
    `SELECT id, status, frequency, todo_date FROM crm_todos
     WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)
       AND (
         created_by = ?
         OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = crm_todos.id AND a.user_id = ?)
       )`,
    [id, tenantId, tenantId, userId, userId]
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404 };
  if (row.status === "completed") return { ok: true, already: true };

  const freq = String(row.frequency || "once").toLowerCase();
  if (freq === "once") {
    await pool.execute(
      `UPDATE crm_todos SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [id]
    );
  } else {
    const nextD = nextOccurrence(String(row.todo_date).slice(0, 10), freq);
    await pool.execute(
      `UPDATE crm_todos SET todo_date = ?, status = 'pending', completed_at = NULL, updated_at = NOW() WHERE id = ?`,
      [nextD, id]
    );
  }
  return { ok: true };
}

async function markMeetingDone(id, userId) {
  const [rows] = await pool.execute(
    `SELECT id, status FROM meetings
     WHERE id = ? AND is_deleted = 0
       AND (organizer_id = ? OR assigned_to_user_id = ?)`,
    [id, userId, userId]
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404 };
  if (row.status === "completed") return { ok: true, already: true };
  await pool.execute(
    `UPDATE meetings SET status = 'completed' WHERE id = ?`,
    [id]
  );
  return { ok: true };
}

async function markReminderDone(id, userId) {
  const [rows] = await pool.execute(
    `SELECT id, is_done FROM reminders
     WHERE id = ? AND is_deleted = 0 AND (user_id = ? OR assigned_to_user_id = ?)`,
    [id, userId, userId]
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404 };
  if (row.is_done) return { ok: true, already: true };
  await pool.execute(`UPDATE reminders SET is_done = 1 WHERE id = ?`, [id]);
  return { ok: true };
}

async function markLeadFollowupDone(id, userId, tenantId) {
  const hasTenant = await hasColumn("leads", "tenant_id");
  const hasIsDeleted = await hasColumn("leads", "is_deleted");
  const where = ["id = ?"];
  const params = [id];
  if (hasIsDeleted) where.push("is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR tenant_id = ?)");
    params.push(tenantId, tenantId);
  }
  where.push("(assigned_to = ? OR created_by = ?)");
  params.push(userId, userId);

  const [rows] = await pool.execute(
    `SELECT id FROM leads WHERE ${where.join(" AND ")}`,
    params
  );
  if (!rows[0]) return { ok: false, status: 404 };

  try {
    await pool.execute(
      `INSERT INTO lead_followups (lead_id, note, created_by, created_at)
       VALUES (?, 'Marked done from Today view', ?, NOW())`,
      [id, userId]
    );
  } catch (e) {
    if (e.code !== "ER_BAD_FIELD_ERROR") throw e;
    await pool.execute(
      `INSERT INTO lead_followups (lead_id, note, created_by) VALUES (?, 'Marked done from Today view', ?)`,
      [id, userId]
    );
  }

  await pool.execute(
    `UPDATE leads SET follow_up_date = DATE_ADD(CURDATE(), INTERVAL 7 DAY), updated_at = NOW() WHERE id = ?`,
    [id]
  );
  return { ok: true };
}

async function markClientFollowupDone(id, userId) {
  if (!(await fitnessClientsTableExists())) {
    return { ok: false, status: 404 };
  }
  const [rows] = await pool.execute(
    `SELECT client_id, follow_up_freq_days FROM fitness_clients WHERE client_id = ? AND status = 'Active'`,
    [id]
  );
  if (!rows[0]) return { ok: false, status: 404 };

  const days = Number(rows[0].follow_up_freq_days) || 14;
  await pool.execute(
    `UPDATE fitness_clients SET next_due_date = DATE_ADD(CURDATE(), INTERVAL ? DAY), updated_at = NOW()
     WHERE client_id = ?`,
    [days, id]
  );
  return { ok: true };
}

async function markCollectionFollowupDone(id, userId, body) {
  if (!(await collectionsTableExists())) {
    return { ok: false, status: 404 };
  }
  const collectionService = require("../services/collectionService");
  const ok = await collectionService.markCollectionFollowupDone(id, userId, body || {});
  return ok ? { ok: true } : { ok: false, status: 404 };
}

async function markPaymentDueDone(id) {
  if (!(await hasColumn("fitness_transactions", "payment_due_date"))) {
    return { ok: false, status: 404 };
  }
  const [result] = await pool.execute(
    `UPDATE fitness_transactions
     SET payment_due_date = NULL
     WHERE id = ? AND payment_due_date IS NOT NULL`,
    [id]
  );
  return result.affectedRows > 0 ? { ok: true } : { ok: false, status: 404 };
}

async function markOpportunityFollowupDone(id, userId) {
  if (!(await opportunitiesTableExists())) {
    return { ok: false, status: 404 };
  }
  const [rows] = await pool.execute(
    `SELECT id FROM opportunities
     WHERE id = ? AND is_deleted = 0
       AND stage NOT IN ('closed_won', 'closed_lost')
       AND (owner_user_id = ? OR created_by = ?)`,
    [id, userId, userId]
  );
  if (!rows[0]) return { ok: false, status: 404 };

  await pool.execute(
    `UPDATE opportunities SET followup_at = DATE_ADD(CURDATE(), INTERVAL 7 DAY), updated_at = NOW() WHERE id = ?`,
    [id]
  );
  return { ok: true };
}

async function syncFitnessClientNextDueAfterTaskDone(taskId) {
  const hasClientCol = await hasColumn("tasks", "client_id");
  if (!hasClientCol || !(await fitnessClientsTableExists())) return false;

  const [taskRows] = await pool.execute(
    `SELECT t.client_id FROM tasks t WHERE t.id = ?`,
    [taskId]
  );
  const fcInternalId = taskRows[0]?.client_id;
  if (!fcInternalId) return false;

  const [clients] = await pool.execute(
    `SELECT client_id, follow_up_freq_days FROM fitness_clients WHERE id = ? AND status = 'Active'`,
    [fcInternalId]
  );
  if (!clients[0]) return false;

  const days = Number(clients[0].follow_up_freq_days) || 14;
  await pool.execute(
    `UPDATE fitness_clients SET next_due_date = DATE_ADD(CURDATE(), INTERVAL ? DAY), updated_at = NOW()
     WHERE client_id = ?`,
    [days, clients[0].client_id]
  );
  return true;
}

async function markTaskDone(id, userId, tenantId) {
  const hasTenant = await hasColumn("tasks", "tenant_id");
  const hasIsDeleted = await hasColumn("tasks", "is_deleted");
  const where = ["id = ?", "(assigned_to = ? OR created_by = ?)"];
  const params = [id, userId, userId];
  if (hasIsDeleted) where.push("is_deleted = 0");
  if (hasTenant) {
    where.push("(? IS NULL OR tenant_id = ?)");
    params.push(tenantId, tenantId);
  }

  const [rows] = await pool.execute(
    `SELECT id, status FROM tasks WHERE ${where.join(" AND ")}`,
    params
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404 };
  const st = String(row.status || "").toLowerCase();
  if (st === "done" || st === "completed") return { ok: true, already: true };

  await pool.execute(
    `UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = ?`,
    [id]
  );
  const fitnessSynced = await syncFitnessClientNextDueAfterTaskDone(id);
  return { ok: true, fitnessSynced };
}

async function markFitnessClientTaskDone(id) {
  if (!(await fitnessClientTasksTableExists())) {
    return { ok: false, status: 404 };
  }
  const today = formatYmd(new Date());
  const [rows] = await pool.execute(
    `SELECT id, client_id FROM fitness_client_tasks
     WHERE id = ? AND status NOT IN ('Done', 'Carried Forward')`,
    [id]
  );
  if (!rows[0]) return { ok: false, status: 404 };

  await pool.execute(
    `UPDATE fitness_client_tasks SET status = 'Done', completed_on = ? WHERE id = ?`,
    [today, id]
  );

  const clientId = rows[0].client_id;
  if (clientId) {
    const [clients] = await pool.execute(
      `SELECT follow_up_freq_days FROM fitness_clients WHERE client_id = ?`,
      [clientId]
    );
    if (clients[0]) {
      const days = Number(clients[0].follow_up_freq_days) || 14;
      await pool.execute(
        `UPDATE fitness_clients SET next_due_date = DATE_ADD(?, INTERVAL ? DAY), updated_at = NOW()
         WHERE client_id = ?`,
        [today, days, clientId]
      );
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
