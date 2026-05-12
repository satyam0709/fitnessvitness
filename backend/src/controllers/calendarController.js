const { pool } = require("../config/database");
const { emitCalendarChanged } = require("../realtime/meetingsRealtime");

const {
  fetchGoogleEvents,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
} = require("../services/googleCalendarService");

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

    const [meetRows] = await pool.query(
      `SELECT m.id, m.title, m.start_time, m.end_time, m.status, m.lead_id, l.name AS lead_name
       FROM meetings m
       LEFT JOIN leads l ON l.id = m.lead_id
       WHERE (m.organizer_id = ? OR EXISTS (
         SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ?
       ))
       AND m.start_time >= ? AND m.start_time <= ?`,
      [uid, uid, rs, re]
    );
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

    const [remRows] = await pool.query(
      `SELECT r.id, r.title, r.note, r.remind_at, r.lead_id, l.name AS lead_name
       FROM reminders r
       LEFT JOIN leads l ON l.id = r.lead_id
       WHERE (r.user_id = ? OR r.assigned_to_user_id = ?)
         AND r.remind_at >= ? AND r.remind_at <= ?
         AND r.is_done = 0`,
      [uid, uid, rs, re]
    );
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

    items.sort((a, b) => new Date(a.start) - new Date(b.start));
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

module.exports = {
  getCalendarFeed,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getGoogleCalendarStatus,
  postGoogleCalendarSync,
};