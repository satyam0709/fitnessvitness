const { pool } = require("../config/database");
const { tableExists } = require("../utils/schemaHelpers");
const { ensureCalendarCrmTables } = require("../utils/ensureCalendarCrmTables");
const {
  emitCalendarChanged,
  emitTodosChanged,
  emitAdminChanged,
  emitMeetingsChanged,
} = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");

const {
  fetchGoogleEvents,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
} = require("../services/googleCalendarService");
const {
  fetchAppleEvents,
  getAppleCalendarSettings,
  saveAppleCalendarSettings,
  disconnectAppleCalendar,
  testAppleConnection,
  isConnected: isAppleCalendarConnected,
} = require("../services/appleCalendarService");

const ALLOWED_CATEGORY = new Set(["event", "holiday", "service"]);

let hasGoogleEventIdCol = null;

async function ensureGoogleEventIdColumn() {
  if (hasGoogleEventIdCol !== null) return hasGoogleEventIdCol;
  try {
    const [rows] = await pool.query(
      `SELECT 1 AS ok
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'crm_calendar_events'
         AND COLUMN_NAME = 'google_event_id'
       LIMIT 1`
    );
    hasGoogleEventIdCol = rows.length > 0;
  } catch {
    hasGoogleEventIdCol = false;
  }
  return hasGoogleEventIdCol;
}

function toMysqlRange(from, to) {
  return { rs: `${from} 00:00:00`, re: `${to} 23:59:59` };
}

function toMysqlDateTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(
      v.getMinutes()
    )}:${p(v.getSeconds())}`;
  }
  const s = String(v).trim().replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function parseYmd(v) {
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

async function getGoogleToken(_clerkUserId) {
  return null;
}

function staticHolidaysInRange(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
  const HOLIDAYS = [
    { month: 1, day: 26, title: "Republic Day" },
    { month: 8, day: 15, title: "Independence Day" },
    { month: 10, day: 2, title: "Gandhi Jayanti" },
    { month: 12, day: 25, title: "Christmas" },
  ];
  const out = [];
  for (let y = from.getFullYear(); y <= to.getFullYear(); y += 1) {
    HOLIDAYS.forEach((h) => {
      const d = new Date(y, h.month - 1, h.day, 12, 0, 0);
      if (d >= from && d <= to) {
        const m = String(h.month).padStart(2, "0");
        const day = String(h.day).padStart(2, "0");
        const ymd = `${y}-${m}-${day}`;
        out.push({
          id: `holiday-static-${ymd}`,
          source: "holiday",
          type: "holiday",
          title: h.title,
          start: `${ymd}T00:00:00`,
          end: `${ymd}T23:59:59`,
          allDay: true,
          meta: { static: true },
        });
      }
    });
  }
  return out;
}

async function countUserScheduledItemsOnDate(uid, ymd) {
  const rs = `${ymd} 00:00:00`;
  const re = `${ymd} 23:59:59`;
  const [[a]] = await pool.query(
    `SELECT COUNT(*) AS c FROM crm_calendar_events
     WHERE user_id = ? AND start_at <= ? AND COALESCE(end_at, start_at) >= ?`,
    [uid, re, rs]
  );
  let b = 0;
  if (await tableExists("meetings")) {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM meetings m
         WHERE m.is_deleted = 0
           AND (m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?))
           AND m.start_time >= ? AND m.start_time <= ?`,
        [uid, uid, rs, re]
      );
      b = Number(row?.c || 0);
    } catch (e) {
      const msg = String(e?.message || "");
      if (!/Unknown column ['`]?is_deleted/i.test(msg)) throw e;
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM meetings m
         WHERE (m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?))
           AND m.start_time >= ? AND m.start_time <= ?`,
        [uid, uid, rs, re]
      );
      b = Number(row?.c || 0);
    }
  }
  let c = 0;
  if (await tableExists("reminders")) {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM reminders r
         WHERE r.is_deleted = 0 AND (r.user_id = ? OR r.assigned_to_user_id = ?)
           AND r.remind_at >= ? AND r.remind_at <= ? AND r.is_done = 0`,
        [uid, uid, rs, re]
      );
      c = Number(row?.c || 0);
    } catch (e) {
      const msg = String(e?.message || "");
      if (!/Unknown column ['`]?is_deleted/i.test(msg)) throw e;
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM reminders r
         WHERE (r.user_id = ? OR r.assigned_to_user_id = ?)
           AND r.remind_at >= ? AND r.remind_at <= ? AND r.is_done = 0`,
        [uid, uid, rs, re]
      );
      c = Number(row?.c || 0);
    }
  }
  let d = 0;
  if (await tableExists("tasks")) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c FROM tasks t
       WHERE (t.assigned_to = ? OR t.created_by = ?)
         AND t.due_date IS NOT NULL AND DATE(t.due_date) = ?
         AND t.status NOT IN ('done','completed')`,
      [uid, uid, ymd]
    );
    d = Number(row?.c || 0);
  }
  const [[e]] = await pool.query(
    `SELECT COUNT(*) AS c FROM crm_todos t
     WHERE t.is_deleted = 0
       AND (t.created_by = ? OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?))
       AND t.todo_date = ? AND t.status = 'pending'`,
    [uid, uid, ymd]
  );
  let f = 0;
  if (await tableExists("leads")) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE (l.created_by = ? OR l.assigned_to = ?) AND l.follow_up_date = ?`,
      [uid, uid, ymd]
    );
    f = Number(row?.c || 0);
  }
  return (
    Number(a?.c || 0) +
    b +
    c +
    d +
    Number(e?.c || 0) +
    f
  );
}

async function maybeNotifyCalendarDayDigest(uid, fromStr, toStr) {
  const uidn = Number(uid);
  if (!uidn) return;
  const today = new Date().toISOString().slice(0, 10);
  if (today < fromStr || today > toStr) return;
  const digestId = Number(today.replace(/-/g, ""));
  const [[existing]] = await pool.query(
    `SELECT id FROM notifications WHERE user_id = ? AND entity_type = 'calendar_day' AND entity_id = ? LIMIT 1`,
    [uidn, digestId]
  );
  if (existing) return;
  const n = await countUserScheduledItemsOnDate(uidn, today);
  if (n < 1) return;
  await createUserNotification({
    userId: uidn,
    entityType: "calendar_day",
    entityId: digestId,
    title: `Today's schedule (${today})`,
    body: `You have ${n} item(s) on your calendar today. Open Calendar to review your day.`,
  });
}

async function getCalendarFeed(req, res) {
  try {
    const uid = Number(req.user?.id);
    const clerkUserId = req.user?.clerkUserId;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const from = parseYmd(req.query.from);
    const to = parseYmd(req.query.to);
    if (!from || !to) {
      return res.status(400).json({ success: false, message: "from and to are required (YYYY-MM-DD)" });
    }

    const { rs, re } = toMysqlRange(from, to);
    const items = [];
    const hasGoogleCol = await ensureGoogleEventIdColumn();

    const [customRows] = await pool.query(
      `SELECT id, title, description, start_at, end_at, all_day, category${hasGoogleCol ? ", google_event_id" : ""}
       FROM crm_calendar_events
       WHERE user_id = ?
         AND start_at <= ?
         AND COALESCE(end_at, start_at) >= ?`,
      [uid, re, rs]
    );
    customRows.forEach((r) => {
      const type = ALLOWED_CATEGORY.has(String(r.category || "").toLowerCase())
        ? String(r.category).toLowerCase()
        : "event";
      items.push({
        id: `event-${r.id}`,
        source: "custom",
        type,
        title: r.title,
        description: r.description || null,
        start: r.start_at,
        end: r.end_at || r.start_at,
        allDay: !!r.all_day,
        meta: {
          eventId: r.id,
          googleEventId: hasGoogleCol ? r.google_event_id || null : null,
        },
      });
    });

    if (await tableExists("meetings")) {
      const meetSqlWithLeads = `SELECT m.id, m.title, m.start_time, m.end_time, m.status, m.lead_id, l.name AS lead_name
           FROM meetings m
           LEFT JOIN leads l ON l.id = m.lead_id
           WHERE (m.organizer_id = ? OR EXISTS (
             SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?
           ))
           AND m.start_time >= ? AND m.start_time <= ?`;
      const meetSqlNoLeads = `SELECT m.id, m.title, m.start_time, m.end_time, m.status, m.lead_id, NULL AS lead_name
           FROM meetings m
           WHERE (m.organizer_id = ? OR EXISTS (
             SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?
           ))
           AND m.start_time >= ? AND m.start_time <= ?`;
      const params = [uid, uid, rs, re];
      let meetRows;
      try {
        if (await tableExists("leads")) {
          const [rows] = await pool.query(meetSqlWithLeads, params);
          meetRows = rows;
        } else {
          const [rows] = await pool.query(meetSqlNoLeads, params);
          meetRows = rows;
        }
      } catch (e) {
        const msg = String(e?.message || "");
        const code = e?.code;
        if (
          code === "ER_NO_SUCH_TABLE" ||
          /Table ['`]?[^' ]*\.?['`]?leads['`]? doesn't exist/i.test(msg) ||
          /doesn't exist.*\bleads\b/i.test(msg)
        ) {
          const [rows] = await pool.query(meetSqlNoLeads, params);
          meetRows = rows;
        } else {
          throw e;
        }
      }
      meetRows.forEach((m) => {
        items.push({
          id: `meeting-${m.id}`,
          source: "meeting",
          type: "meeting",
          title: m.title || "Meeting",
          description: m.lead_name ? `Lead: ${m.lead_name}` : null,
          start: m.start_time,
          end: m.end_time || m.start_time,
          allDay: false,
          meta: { meetingId: m.id, status: m.status, leadId: m.lead_id },
        });
      });
    }

    if (await tableExists("reminders")) {
      const remSqlWithLeads = `SELECT r.id, r.title, r.note, r.remind_at, r.lead_id, l.name AS lead_name
           FROM reminders r
           LEFT JOIN leads l ON l.id = r.lead_id
           WHERE (r.user_id = ? OR r.assigned_to_user_id = ?)
             AND r.remind_at >= ? AND r.remind_at <= ?
             AND r.is_done = 0`;
      const remSqlNoLeads = `SELECT r.id, r.title, r.note, r.remind_at, r.lead_id, NULL AS lead_name
           FROM reminders r
           WHERE (r.user_id = ? OR r.assigned_to_user_id = ?)
             AND r.remind_at >= ? AND r.remind_at <= ?
             AND r.is_done = 0`;
      const remParams = [uid, uid, rs, re];
      let remRows;
      try {
        if (await tableExists("leads")) {
          const [rows] = await pool.query(remSqlWithLeads, remParams);
          remRows = rows;
        } else {
          const [rows] = await pool.query(remSqlNoLeads, remParams);
          remRows = rows;
        }
      } catch (e) {
        const msg = String(e?.message || "");
        const code = e?.code;
        if (
          code === "ER_NO_SUCH_TABLE" ||
          /Table ['`]?[^' ]*\.?['`]?leads['`]? doesn't exist/i.test(msg) ||
          /doesn't exist.*\bleads\b/i.test(msg)
        ) {
          const [rows] = await pool.query(remSqlNoLeads, remParams);
          remRows = rows;
        } else {
          throw e;
        }
      }
      remRows.forEach((r) => {
        items.push({
          id: `reminder-${r.id}`,
          source: "reminder",
          type: "reminder",
          title: r.title || "Reminder",
          description: r.note || (r.lead_name ? `Lead: ${r.lead_name}` : null),
          start: r.remind_at,
          end: r.remind_at,
          allDay: false,
          meta: { reminderId: r.id, leadId: r.lead_id },
        });
      });
    }

    if (await tableExists("tasks")) {
      const [taskRows] = await pool.query(
        `SELECT t.id, t.title, t.due_date, t.status, t.priority
         FROM tasks t
         WHERE (t.assigned_to = ? OR t.created_by = ?)
           AND t.due_date IS NOT NULL
           AND DATE(t.due_date) >= ? AND DATE(t.due_date) <= ?
           AND t.status NOT IN ('done','completed')`,
        [uid, uid, from, to]
      );
      taskRows.forEach((t) => {
        const d = String(t.due_date).slice(0, 10);
        items.push({
          id: `task-${t.id}`,
          source: "task",
          type: "task",
          title: t.title || "Task",
          description: t.priority ? `Priority: ${t.priority}` : null,
          start: `${d}T09:00:00`,
          end: `${d}T09:30:00`,
          allDay: true,
          meta: { taskId: t.id, status: t.status },
        });
      });
    }

    const [todoRows] = await pool.query(
      `SELECT t.id, t.body, t.todo_date, t.status, t.priority
       FROM crm_todos t
       WHERE t.is_deleted = 0
         AND (t.created_by = ? OR EXISTS (
           SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?
         ))
         AND t.todo_date BETWEEN ? AND ?
         AND t.status = 'pending'`,
      [uid, uid, from, to]
    );
    todoRows.forEach((t) => {
      const d = parseYmd(t.todo_date);
      if (!d) return;
      items.push({
        id: `todo-${t.id}`,
        source: "todo",
        type: "todo",
        title: t.body ? String(t.body).slice(0, 120) : "To-do",
        description: t.priority ? `Priority: ${t.priority}` : null,
        start: `${d}T08:00:00`,
        end: `${d}T08:30:00`,
        allDay: false,
        meta: { todoId: t.id },
      });
    });

    try {
      const [oppRows] = await pool.query(
        `SELECT o.id, o.title, o.followup_at, o.followup_type, o.stage
         FROM opportunities o
         WHERE o.is_deleted = 0
           AND o.followup_at IS NOT NULL
           AND o.followup_at >= ? AND o.followup_at <= ?
           AND o.stage NOT IN ('closed_won', 'closed_lost')
           AND (o.owner_user_id = ? OR o.created_by = ?)`,
        [rs, re, uid, uid]
      );
      oppRows.forEach((o) => {
        const start = o.followup_at;
        items.push({
          id: `opportunity-${o.id}`,
          source: "opportunity",
          type: "opportunity",
          title: o.title ? `Prospect: ${o.title}` : "Prospect follow-up",
          description: o.followup_type ? `Follow-up: ${o.followup_type}` : null,
          start,
          end: start,
          allDay: false,
          meta: { opportunityId: o.id, stage: o.stage },
        });
      });
    } catch (e) {
      console.warn("calendar opportunity followups:", e.message);
    }

    // --- Fitness CRM: Client Milestones & Consultations ---
    const [fitnessRows] = await pool.query(
      `SELECT client_id, full_name, plan_start_date, plan_expiry_date, next_due_date, status
       FROM fitness_clients
       WHERE (plan_start_date BETWEEN ? AND ?)
          OR (plan_expiry_date BETWEEN ? AND ?)
          OR (next_due_date BETWEEN ? AND ?)`,
      [from, to, from, to, from, to]
    );

    fitnessRows.forEach((f) => {
      // Plan Start
      if (f.plan_start_date && parseYmd(f.plan_start_date) >= from && parseYmd(f.plan_start_date) <= to) {
        items.push({
          id: `fitness-start-${f.client_id}`,
          source: "fitness",
          type: "fitness",
          title: `Start: ${f.full_name}`,
          description: `Plan started for ${f.full_name}`,
          start: `${parseYmd(f.plan_start_date)}T09:00:00`,
          end: `${parseYmd(f.plan_start_date)}T09:30:00`,
          allDay: false,
          meta: { clientId: f.client_id, category: 'plan_start' },
        });
      }
      // Plan Expiry
      if (f.plan_expiry_date && parseYmd(f.plan_expiry_date) >= from && parseYmd(f.plan_expiry_date) <= to) {
        items.push({
          id: `fitness-expiry-${f.client_id}`,
          source: "fitness",
          type: "fitness", 
          title: `Expiry: ${f.full_name}`,
          description: `Plan expires for ${f.full_name}`,
          start: `${parseYmd(f.plan_expiry_date)}T00:00:00`,
          end: `${parseYmd(f.plan_expiry_date)}T23:59:59`,
          allDay: true,
          meta: { clientId: f.client_id, category: 'plan_expiry' },
        });
      }
      // Next Due
      if (f.next_due_date && parseYmd(f.next_due_date) >= from && parseYmd(f.next_due_date) <= to) {
        items.push({
          id: `fitness-due-${f.client_id}`,
          source: "fitness",
          type: "fitness",
          title: `Due: ${f.full_name}`,
          description: `Next consult due for ${f.full_name}`,
          start: `${parseYmd(f.next_due_date)}T10:00:00`,
          end: `${parseYmd(f.next_due_date)}T11:00:00`,
          allDay: false,
          meta: { clientId: f.client_id, category: 'consultation_due' },
        });
      }
    });

    // Actual consultations (column names match fitness_consultations schema)
    const [consultRows] = await pool.query(
      `SELECT c.id, c.client_id, cl.full_name, c.consult_date, c.consult_type, c.key_observations
       FROM fitness_consultations c
       JOIN fitness_clients cl ON cl.client_id = c.client_id
       WHERE c.consult_date BETWEEN ? AND ?`,
      [from, to]
    );
    consultRows.forEach((c) => {
      const d = parseYmd(c.consult_date);
      if (!d) return;
      items.push({
        id: `fitness-consult-${c.id}`,
        source: "fitness",
        type: "fitness",
        title: `Consult: ${c.full_name}`,
        description: `${c.consult_type || "Consultation"}: ${c.key_observations || ""}`,
        start: `${d}T11:00:00`,
        end: `${d}T12:00:00`,
        allDay: false,
        meta: { clientId: c.client_id, consultationId: c.id },
      });
    });

    // Fitness client tasks (schema: task_description, status enum without "Completed")
    const [fTaskRows] = await pool.query(
      `SELECT t.id, t.client_id, cl.full_name, t.task_description, t.due_date, t.status
       FROM fitness_client_tasks t
       JOIN fitness_clients cl ON cl.client_id = t.client_id
       WHERE t.due_date BETWEEN ? AND ? AND t.status NOT IN ('Done','Carried Forward')`,
      [from, to]
    );
    fTaskRows.forEach((t) => {
      const d = parseYmd(t.due_date);
      if (!d) return;
      items.push({
        id: `fitness-task-${t.id}`,
        source: "fitness",
        type: "fitness",
        title: `Client Task: ${t.full_name}`,
        description: t.task_description,
        start: `${d}T14:00:00`,
        end: `${d}T15:00:00`,
        allDay: false,
        meta: { clientId: t.client_id, taskId: t.id },
      });
    });

    if (await tableExists("leads")) {
      const [leadRows] = await pool.query(
        `SELECT l.id, l.name, l.follow_up_date, l.status
         FROM leads l
         WHERE (l.created_by = ? OR l.assigned_to = ?)
           AND l.follow_up_date IS NOT NULL
           AND l.follow_up_date >= ? AND l.follow_up_date <= ?
         LIMIT 500`,
        [uid, uid, from, to]
      );
      leadRows.forEach((l) => {
        const d = String(l.follow_up_date).slice(0, 10);
        items.push({
          id: `lead-${l.id}`,
          source: "lead",
          type: "lead",
          title: l.name ? `Follow-up: ${l.name}` : "Lead follow-up",
          description: l.status ? `Status: ${l.status}` : null,
          start: `${d}T00:00:00`,
          end: `${d}T23:59:59`,
          allDay: true,
          meta: { leadId: l.id },
        });
      });
    }

    items.push(...staticHolidaysInRange(from, to));

    try {
      const token = await getGoogleToken(clerkUserId);
      if (token) {
        const gEvents = await fetchGoogleEvents(token, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
        items.push(...gEvents);
      }
    } catch (e) {
      // Keep CRM feed functional even if Google integration is unavailable.
      console.warn("calendar google fetch:", e.message);
    }

    try {
      const appleEvents = await fetchAppleEvents(uid, from, to);
      items.push(...appleEvents);
    } catch (e) {
      console.warn("calendar apple fetch:", e.message);
    }

    items.sort((a, b) => new Date(a.start) - new Date(b.start));
    await maybeNotifyCalendarDayDigest(uid, from, to).catch((e) =>
      console.warn("calendar day digest:", e.message)
    );
    return res.json({ success: true, range: { from, to }, items });
  } catch (err) {
    console.error("getCalendarFeed", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function createCalendarEvent(req, res) {
  try {
    const uid = Number(req.user?.id);
    const clerkUserId = req.user?.clerkUserId;
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { title, description, start_at, end_at, all_day, category } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: "title is required" });
    }
    const startSql = toMysqlDateTime(start_at);
    if (!startSql) return res.status(400).json({ success: false, message: "start_at is required" });
    const endSql = end_at ? toMysqlDateTime(end_at) : null;
    const allDay = all_day === true || all_day === 1 || String(all_day).toLowerCase() === "true" ? 1 : 0;
    const cat = ALLOWED_CATEGORY.has(String(category || "").toLowerCase())
      ? String(category).toLowerCase()
      : "event";

    let googleEventId = null;
    try {
      const token = await getGoogleToken(clerkUserId);
      if (token) {
        googleEventId = await createGoogleEvent(token, {
          title: String(title).trim(),
          description: description || null,
          start: new Date(startSql.replace(" ", "T")).toISOString(),
          end: endSql ? new Date(endSql.replace(" ", "T")).toISOString() : null,
        });
      }
    } catch (e) {
      console.warn("calendar google create:", e.message);
    }

    const hasGoogleCol = await ensureGoogleEventIdColumn();
    const [result] = hasGoogleCol
      ? await pool.query(
          `INSERT INTO crm_calendar_events
           (user_id, title, description, start_at, end_at, all_day, category, google_event_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid, String(title).trim(), description || null, startSql, endSql, allDay, cat, googleEventId]
        )
      : await pool.query(
          `INSERT INTO crm_calendar_events
           (user_id, title, description, start_at, end_at, all_day, category)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uid, String(title).trim(), description || null, startSql, endSql, allDay, cat]
        );

    emitCalendarChanged({ reason: "calendar", action: "create", id: result.insertId });
    return res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("createCalendarEvent", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function updateCalendarEvent(req, res) {
  try {
    const uid = Number(req.user?.id);
    const clerkUserId = req.user?.clerkUserId;
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const hasGoogleCol = await ensureGoogleEventIdColumn();
    const [[existing]] = await pool.query(
      `SELECT id${hasGoogleCol ? ", google_event_id" : ""}
       FROM crm_calendar_events
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [id, uid]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    const { title, description, start_at, end_at, all_day, category } = req.body || {};
    const sets = [];
    const vals = [];
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ success: false, message: "title is required" });
      sets.push("title = ?");
      vals.push(String(title).trim());
    }
    if (description !== undefined) {
      sets.push("description = ?");
      vals.push(description || null);
    }
    if (start_at !== undefined) {
      const s = toMysqlDateTime(start_at);
      if (!s) return res.status(400).json({ success: false, message: "Invalid start_at" });
      sets.push("start_at = ?");
      vals.push(s);
    }
    if (end_at !== undefined) {
      sets.push("end_at = ?");
      vals.push(end_at ? toMysqlDateTime(end_at) : null);
    }
    if (all_day !== undefined) {
      sets.push("all_day = ?");
      vals.push(all_day === true || all_day === 1 || String(all_day).toLowerCase() === "true" ? 1 : 0);
    }
    if (category !== undefined) {
      const cat = ALLOWED_CATEGORY.has(String(category || "").toLowerCase())
        ? String(category).toLowerCase()
        : "event";
      sets.push("category = ?");
      vals.push(cat);
    }
    if (!sets.length) return res.json({ success: true });

    vals.push(id, uid);
    await pool.query(
      `UPDATE crm_calendar_events SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      vals
    );

    if (hasGoogleCol && existing.google_event_id) {
      try {
        const token = await getGoogleToken(clerkUserId);
        if (token) {
          const [[updated]] = await pool.query(
            "SELECT title, description, start_at, end_at FROM crm_calendar_events WHERE id = ? LIMIT 1",
            [id]
          );
          await updateGoogleEvent(token, existing.google_event_id, {
            title: updated.title,
            description: updated.description || null,
            start: new Date(String(updated.start_at).replace(" ", "T")).toISOString(),
            end: updated.end_at ? new Date(String(updated.end_at).replace(" ", "T")).toISOString() : null,
          });
        }
      } catch (e) {
        console.warn("calendar google update:", e.message);
      }
    }

    emitCalendarChanged({ reason: "calendar", action: "update", id });
    return res.json({ success: true });
  } catch (err) {
    console.error("updateCalendarEvent", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteCalendarEvent(req, res) {
  try {
    const uid = Number(req.user?.id);
    const clerkUserId = req.user?.clerkUserId;
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const hasGoogleCol = await ensureGoogleEventIdColumn();
    const [[existing]] = await pool.query(
      `SELECT id${hasGoogleCol ? ", google_event_id" : ""}
       FROM crm_calendar_events
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [id, uid]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    if (hasGoogleCol && existing.google_event_id) {
      try {
        const token = await getGoogleToken(clerkUserId);
        if (token) await deleteGoogleEvent(token, existing.google_event_id);
      } catch (e) {
        console.warn("calendar google delete:", e.message);
      }
    }

    const [r] = await pool.query("DELETE FROM crm_calendar_events WHERE id = ? AND user_id = ?", [id, uid]);
    emitCalendarChanged({ reason: "calendar", action: "delete", id });
    return res.json({ success: true, deleted: Number(r.affectedRows) || 0 });
  } catch (err) {
    console.error("deleteCalendarEvent", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getGoogleCalendarStatus(req, res) {
  try {
    const available = false;
    const token = null;
    return res.json({
      success: true,
      available,
      connected: !!token,
      message:
        "Google Calendar OAuth via Clerk is disabled. CRM local calendar events still work.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function postGoogleCalendarSync(req, res) {
  try {
    const clerkUserId = req.user?.clerkUserId;
    const token = await getGoogleToken(clerkUserId);
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Google account not connected for this user.",
      });
    }
    const from = parseYmd(req.body?.from || req.query?.from) || new Date().toISOString().slice(0, 10);
    const to = parseYmd(req.body?.to || req.query?.to) || from;
    const events = await fetchGoogleEvents(token, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
    return res.json({
      success: true,
      count: Array.isArray(events) ? events.length : 0,
      message: "Google Calendar sync is active.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getAppleCalendarStatus(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const settings = await getAppleCalendarSettings(uid);
    const connected = isAppleCalendarConnected(settings);
    return res.json({
      success: true,
      connected,
      has_ical: Boolean(String(settings?.ical_url || "").trim()),
      has_caldav: Boolean(String(settings?.caldav_username || "").trim()),
      caldav_username: settings?.caldav_username || null,
      ical_url: settings?.ical_url || null,
      last_sync_at: settings?.last_sync_at || null,
      last_error: settings?.last_error || null,
      message: connected
        ? "Apple Calendar is connected. Events load automatically with your calendar."
        : "Connect Apple Calendar with iCloud (recommended) or a subscription URL.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function putAppleCalendarSettings(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const body = req.body || {};
    const hasIcal = Boolean(String(body.ical_url || "").trim());
    const hasCaldav =
      Boolean(String(body.caldav_username || "").trim()) &&
      Boolean(String(body.caldav_password || "").trim());

    const existing = await getAppleCalendarSettings(uid);
    const keepCaldav =
      Boolean(String(body.caldav_username || "").trim()) &&
      !String(body.caldav_password || "").trim() &&
      Boolean(String(existing?.caldav_password || "").trim());

    if (!hasIcal && !hasCaldav && !keepCaldav) {
      return res.status(400).json({
        success: false,
        message:
          "Provide iCloud Apple ID + app-specific password, or a calendar subscription (webcal) URL.",
      });
    }

    await saveAppleCalendarSettings(uid, body);

    const from = parseYmd(body.from) || new Date().toISOString().slice(0, 10);
    const d = new Date(`${from}T00:00:00`);
    d.setDate(d.getDate() + 30);
    const to =
      parseYmd(body.to) ||
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const test = await testAppleConnection(uid, {
      ...body,
      caldav_password: body.caldav_password || existing?.caldav_password,
      from,
      to,
    });

    emitCalendarChanged({ reason: "apple_connected", userId: uid });
    return res.json({
      success: true,
      connected: true,
      count: test.count,
      message: `Apple Calendar connected. Found ${test.count} event(s) in the next 30 days.`,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

async function deleteAppleCalendarDisconnect(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    await disconnectAppleCalendar(uid);
    emitCalendarChanged({ reason: "apple_disconnected", userId: uid });
    return res.json({ success: true, message: "Apple Calendar disconnected." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function postAppleCalendarSync(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const settings = await getAppleCalendarSettings(uid);
    if (!isAppleCalendarConnected(settings)) {
      return res.status(400).json({
        success: false,
        message: "Apple Calendar is not connected. Add iCloud or subscription URL first.",
      });
    }

    const from = parseYmd(req.body?.from || req.query?.from) || new Date().toISOString().slice(0, 10);
    const to = parseYmd(req.body?.to || req.query?.to) || from;
    const events = await fetchAppleEvents(uid, from, to);
    emitCalendarChanged({ reason: "apple_sync", userId: uid });
    return res.json({
      success: true,
      count: Array.isArray(events) ? events.length : 0,
      message: `Synced ${events.length} Apple Calendar event(s) for this range.`,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

let calendarMeetingRecurrenceChecked = false;
async function ensureMeetingsRecurrenceColumnCal() {
  if (calendarMeetingRecurrenceChecked) return;
  calendarMeetingRecurrenceChecked = true;
  try {
    const [cols] = await pool.query(
      `SELECT 1 AS ok FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'recurrence' LIMIT 1`
    );
    if (!cols.length) {
      await pool.query(
        "ALTER TABLE meetings ADD COLUMN recurrence VARCHAR(50) NOT NULL DEFAULT 'once'"
      );
    }
  } catch (e) {
    calendarMeetingRecurrenceChecked = false;
    console.warn("calendar meetings recurrence check:", e.message);
  }
}

const REMINDER_TYPES_CAL = new Set(["general", "follow_up", "payment", "meeting", "customer_reminder"]);
function normalizeReminderTypeCal(t) {
  const v = (t && String(t).trim()) || "general";
  return REMINDER_TYPES_CAL.has(v) ? v : "general";
}

async function quickAddFromCalendar(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const tenantId = req.user?.tenantId ?? null;
    const b = req.body || {};
    const kind = String(b.kind || "").toLowerCase().trim();

    await ensureCalendarCrmTables(pool);

    if (kind === "calendar_event" || kind === "event") {
      req.body = {
        title: b.title,
        description: b.description,
        start_at: b.start_at,
        end_at: b.end_at,
        all_day: b.all_day,
        category: b.category || "event",
      };
      return createCalendarEvent(req, res);
    }

    if (kind === "task") {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "title is required" });
      let dueDate = b.due_date ? String(b.due_date).slice(0, 10) : null;
      if (!dueDate && b.start_at) dueDate = String(b.start_at).slice(0, 10);
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      const lid = Number.isFinite(leadId) && leadId > 0 ? leadId : null;
      let insertId;
      try {
        const [result] = await pool.execute(
          `INSERT INTO tasks (tenant_id, title, description, lead_id, assigned_to, created_by, due_date, priority, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 'todo')`,
          [tenantId || null, title, b.description || null, lid, uid, uid, dueDate]
        );
        insertId = result.insertId;
      } catch (e1) {
        const msg = String(e1?.message || "");
        if (e1?.code !== "ER_BAD_FIELD_ERROR" && !/Unknown column/i.test(msg)) throw e1;
        const [result] = await pool.execute(
          `INSERT INTO tasks (title, description, status, priority, assigned_to, lead_id, due_date, created_by)
           VALUES (?, ?, 'todo', 'medium', ?, ?, ?, ?)`,
          [title, b.description || null, uid, lid, dueDate, uid]
        );
        insertId = result.insertId;
      }
      emitCalendarChanged({ reason: "tasks", action: "quick_add", id: insertId });
      emitAdminChanged({ scope: "stats", reason: "tasks", action: "create" });
      return res.status(201).json({ success: true, kind: "task", id: insertId });
    }

    if (kind === "reminder") {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "title is required" });
      const remindAt = toMysqlDateTime(b.start_at || b.remind_at);
      if (!remindAt) return res.status(400).json({ success: false, message: "start_at or remind_at is required" });
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      const lid = Number.isFinite(leadId) && leadId > 0 ? leadId : null;
      const typeVal = normalizeReminderTypeCal(b.reminder_type);
      const [result] = await pool.query(
        `INSERT INTO reminders (user_id, title, note, remind_at, lead_id, assigned_to_user_id, reminder_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uid, title, b.note || b.description || null, remindAt, lid, null, typeVal]
      );
      const insertId = result.insertId;
      emitCalendarChanged({ reason: "reminders", action: "quick_add", id: insertId });
      emitAdminChanged({ scope: "stats", reason: "reminders", action: "create" });
      return res.status(201).json({ success: true, kind: "reminder", id: insertId });
    }

    if (kind === "meeting") {
      await ensureMeetingsRecurrenceColumnCal();
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "title is required" });
      const startSql = toMysqlDateTime(b.start_at);
      if (!startSql) return res.status(400).json({ success: false, message: "start_at is required" });
      let endSql = toMysqlDateTime(b.end_at);
      if (!endSql) {
        const d = new Date(startSql.replace(" ", "T"));
        if (!Number.isNaN(d.getTime())) {
          d.setHours(d.getHours() + 1);
          endSql = toMysqlDateTime(d);
        }
      }
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      const lid = Number.isFinite(leadId) && leadId > 0 ? leadId : null;
      const [result] = await pool.query(
        `INSERT INTO meetings (title, description, start_time, end_time, location, meet_link,
          meeting_type, status, recurrence, organizer_id, assigned_to_user_id, lead_id)
         VALUES (?, ?, ?, ?, ?, ?, 'virtual', 'scheduled', 'once', ?, ?, ?)`,
        [
          title,
          b.description || null,
          startSql,
          endSql,
          b.location || null,
          b.meet_link || null,
          uid,
          uid,
          lid,
        ]
      );
      const meetingId = result.insertId;
      await pool.query("INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)", [
        meetingId,
        uid,
      ]);
      emitMeetingsChanged({ action: "create", id: meetingId });
      emitCalendarChanged({ reason: "meetings", action: "quick_add", id: meetingId });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
      return res.status(201).json({ success: true, kind: "meeting", id: meetingId });
    }

    if (kind === "todo") {
      if (!(await tableExists("crm_todos"))) {
        return res.status(503).json({
          success: false,
          message:
            "To-dos storage is not ready yet. Restart the server so the database schema can finish, then try again.",
        });
      }
      const body = String(b.body || b.title || "").trim();
      if (!body) return res.status(400).json({ success: false, message: "body or title is required" });
      let todoDate = b.todo_date ? String(b.todo_date).slice(0, 10) : null;
      if (!todoDate && b.start_at) todoDate = String(b.start_at).slice(0, 10);
      if (!todoDate) return res.status(400).json({ success: false, message: "todo_date or start_at date is required" });
      const pri = ["low", "medium", "high"].includes(String(b.priority || "").toLowerCase())
        ? String(b.priority).toLowerCase()
        : "medium";
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        let todoId;
        try {
          const [result] = await conn.execute(
            `INSERT INTO crm_todos
              (tenant_id, body, frequency, todo_date, priority, carry_forward, status, attachment_json, created_by)
             VALUES (?, ?, 'once', ?, ?, 0, 'pending', NULL, ?)`,
            [tenantId, body, todoDate, pri, uid]
          );
          todoId = result.insertId;
        } catch (e2) {
          const msg = String(e2?.message || "");
          if (e2?.code !== "ER_BAD_FIELD_ERROR" && !/Unknown column/i.test(msg)) throw e2;
          const [result] = await conn.execute(
            `INSERT INTO crm_todos
              (body, frequency, todo_date, priority, carry_forward, status, attachment_json, created_by)
             VALUES (?, 'once', ?, ?, 0, 'pending', NULL, ?)`,
            [body, todoDate, pri, uid]
          );
          todoId = result.insertId;
        }
        await conn.execute(`DELETE FROM crm_todo_assignees WHERE todo_id = ?`, [todoId]);
        await conn.execute(`INSERT INTO crm_todo_assignees (todo_id, user_id) VALUES (?, ?)`, [todoId, uid]);
        await conn.commit();
        emitTodosChanged({ action: "create", id: todoId, tenantId: tenantId || undefined });
        emitCalendarChanged({ reason: "todos", action: "quick_add", id: todoId });
        return res.status(201).json({ success: true, kind: "todo", id: todoId });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    if (kind === "lead_followup") {
      if (!(await tableExists("leads"))) {
        return res.status(400).json({
          success: false,
          message:
            "Leads are not enabled in this database. Use Tasks, Reminders, or Meetings instead, or run full CRM database setup.",
        });
      }
      const leadId = Number(b.lead_id);
      if (!Number.isFinite(leadId) || leadId <= 0) {
        return res.status(400).json({ success: false, message: "lead_id is required" });
      }
      let fu = b.follow_up_date ? String(b.follow_up_date).slice(0, 10) : null;
      if (!fu && b.start_at) {
        const s = toMysqlDateTime(b.start_at);
        if (s) fu = String(s).slice(0, 10);
      }
      if (!fu) return res.status(400).json({ success: false, message: "follow_up_date or start_at is required" });
      const [r] = await pool.execute(
        `UPDATE leads SET follow_up_date = ? WHERE id = ? AND (created_by = ? OR assigned_to = ?)`,
        [fu, leadId, uid, uid]
      );
      if (!r.affectedRows) {
        return res.status(404).json({ success: false, message: "Lead not found or no access" });
      }
      emitCalendarChanged({ reason: "leads", action: "follow_up", id: leadId });
      emitAdminChanged({ scope: "stats", reason: "leads", action: "update" });
      return res.json({ success: true, kind: "lead_followup", id: leadId });
    }

    return res.status(400).json({
      success: false,
      message:
        "Invalid kind. Use: event, task, reminder, meeting, todo, lead_followup",
    });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");
    if (code === "ER_NO_SUCH_TABLE" || /doesn't exist/i.test(msg)) {
      console.error("quickAddFromCalendar (missing table):", msg);
      return res.status(503).json({
        success: false,
        message:
          "A required database table is missing. Restart the backend once so migrations can run, then try again.",
      });
    }
    console.error("quickAddFromCalendar", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getCalendarFeed,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getGoogleCalendarStatus,
  postGoogleCalendarSync,
  getAppleCalendarStatus,
  putAppleCalendarSettings,
  deleteAppleCalendarDisconnect,
  postAppleCalendarSync,
  quickAddFromCalendar,
};