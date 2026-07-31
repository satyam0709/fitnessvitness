const prisma = require("../config/prisma");
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

function toRangeBounds(from, to) {
  return {
    rs: new Date(`${from}T00:00:00`),
    re: new Date(`${to}T23:59:59`),
  };
}

function toDateOnly(ymd) {
  return new Date(`${ymd}T00:00:00`);
}

function toMysqlDateTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(
      v.getHours()
    )}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = String(v).trim().replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function parseYmd(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function parseDateTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const sql = toMysqlDateTime(v);
  if (!sql) return null;
  const d = new Date(sql.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
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
  const { rs, re } = toRangeBounds(ymd, ymd);
  const dayDate = toDateOnly(ymd);

  const a = await prisma.crm_calendar_events.count({
    where: {
      user_id: uid,
      start_at: { lte: re },
      OR: [
        { end_at: { gte: rs } },
        { AND: [{ end_at: null }, { start_at: { gte: rs } }] },
      ],
    },
  });

  let b = 0;
  if (await tableExists("meetings")) {
    b = await prisma.meetings.count({
      where: {
        is_deleted: false,
        start_time: { gte: rs, lte: re },
        OR: [
          { organizer_id: uid },
          { meeting_attendees: { some: { user_id: uid } } },
        ],
      },
    });
  }

  let c = 0;
  if (await tableExists("reminders")) {
    c = await prisma.reminders.count({
      where: {
        is_deleted: false,
        is_done: false,
        remind_at: { gte: rs, lte: re },
        OR: [{ user_id: uid }, { assigned_to_user_id: uid }],
      },
    });
  }

  let d = 0;
  if (await tableExists("tasks")) {
    d = await prisma.tasks.count({
      where: {
        OR: [{ assigned_to: uid }, { created_by: uid }],
        due_date: dayDate,
        status: { notIn: ["done", "completed"] },
      },
    });
  }

  const e = await prisma.crm_todos.count({
    where: {
      is_deleted: false,
      status: "pending",
      todo_date: dayDate,
      OR: [
        { created_by: uid },
        { crm_todo_assignees: { some: { user_id: uid } } },
      ],
    },
  });

  let f = 0;
  if (await tableExists("leads")) {
    f = await prisma.leads.count({
      where: {
        OR: [{ created_by: uid }, { assigned_to: uid }],
        follow_up_date: dayDate,
      },
    });
  }

  return Number(a || 0) + b + c + d + Number(e || 0) + f;
}

async function maybeNotifyCalendarDayDigest(uid, fromStr, toStr) {
  const uidn = Number(uid);
  if (!uidn) return;
  const today = new Date().toISOString().slice(0, 10);
  if (today < fromStr || today > toStr) return;
  const digestId = Number(today.replace(/-/g, ""));
  const existing = await prisma.notifications.findFirst({
    where: {
      user_id: uidn,
      entity_type: "calendar_day",
      entity_id: BigInt(digestId),
    },
    select: { id: true },
  });
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

    const { rs, re } = toRangeBounds(from, to);
    const fromDate = toDateOnly(from);
    const toDate = toDateOnly(to);
    const items = [];

    const customRows = await prisma.crm_calendar_events.findMany({
      where: {
        user_id: uid,
        start_at: { lte: re },
        OR: [
          { end_at: { gte: rs } },
          { AND: [{ end_at: null }, { start_at: { gte: rs } }] },
        ],
      },
      select: {
        id: true,
        title: true,
        description: true,
        start_at: true,
        end_at: true,
        all_day: true,
        category: true,
      },
    });
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
          googleEventId: null,
        },
      });
    });

    if (await tableExists("meetings")) {
      try {
        const meetRows = await prisma.meetings.findMany({
          where: {
            start_time: { gte: rs, lte: re },
            OR: [
              { organizer_id: uid },
              { meeting_attendees: { some: { user_id: uid } } },
            ],
          },
          select: {
            id: true,
            title: true,
            start_time: true,
            end_time: true,
            status: true,
            lead_id: true,
            leads: { select: { name: true } },
          },
        });
        meetRows.forEach((m) => {
          items.push({
            id: `meeting-${m.id}`,
            source: "meeting",
            type: "meeting",
            title: m.title || "Meeting",
            description: m.leads?.name ? `Lead: ${m.leads.name}` : null,
            start: m.start_time,
            end: m.end_time || m.start_time,
            allDay: false,
            meta: { meetingId: m.id, status: m.status, leadId: m.lead_id },
          });
        });
      } catch (e) {
        const msg = String(e?.message || "");
        if (
          e?.code === "P2021" ||
          /Table ['`]?[^' ]*\.?['`]?leads['`]? doesn't exist/i.test(msg) ||
          /doesn't exist.*\bleads\b/i.test(msg)
        ) {
          const meetRows = await prisma.meetings.findMany({
            where: {
              start_time: { gte: rs, lte: re },
              OR: [
                { organizer_id: uid },
                { meeting_attendees: { some: { user_id: uid } } },
              ],
            },
            select: {
              id: true,
              title: true,
              start_time: true,
              end_time: true,
              status: true,
              lead_id: true,
            },
          });
          meetRows.forEach((m) => {
            items.push({
              id: `meeting-${m.id}`,
              source: "meeting",
              type: "meeting",
              title: m.title || "Meeting",
              description: null,
              start: m.start_time,
              end: m.end_time || m.start_time,
              allDay: false,
              meta: { meetingId: m.id, status: m.status, leadId: m.lead_id },
            });
          });
        } else {
          throw e;
        }
      }
    }

    if (await tableExists("reminders")) {
      try {
        const remRows = await prisma.reminders.findMany({
          where: {
            is_done: false,
            remind_at: { gte: rs, lte: re },
            OR: [{ user_id: uid }, { assigned_to_user_id: uid }],
          },
          select: {
            id: true,
            title: true,
            note: true,
            remind_at: true,
            lead_id: true,
            leads: { select: { name: true } },
          },
        });
        remRows.forEach((r) => {
          items.push({
            id: `reminder-${r.id}`,
            source: "reminder",
            type: "reminder",
            title: r.title || "Reminder",
            description: r.note || (r.leads?.name ? `Lead: ${r.leads.name}` : null),
            start: r.remind_at,
            end: r.remind_at,
            allDay: false,
            meta: { reminderId: r.id, leadId: r.lead_id },
          });
        });
      } catch (e) {
        const msg = String(e?.message || "");
        if (
          e?.code === "P2021" ||
          /Table ['`]?[^' ]*\.?['`]?leads['`]? doesn't exist/i.test(msg) ||
          /doesn't exist.*\bleads\b/i.test(msg)
        ) {
          const remRows = await prisma.reminders.findMany({
            where: {
              is_done: false,
              remind_at: { gte: rs, lte: re },
              OR: [{ user_id: uid }, { assigned_to_user_id: uid }],
            },
            select: {
              id: true,
              title: true,
              note: true,
              remind_at: true,
              lead_id: true,
            },
          });
          remRows.forEach((r) => {
            items.push({
              id: `reminder-${r.id}`,
              source: "reminder",
              type: "reminder",
              title: r.title || "Reminder",
              description: r.note || null,
              start: r.remind_at,
              end: r.remind_at,
              allDay: false,
              meta: { reminderId: r.id, leadId: r.lead_id },
            });
          });
        } else {
          throw e;
        }
      }
    }

    if (await tableExists("tasks")) {
      const taskRows = await prisma.tasks.findMany({
        where: {
          OR: [{ assigned_to: uid }, { created_by: uid }],
          due_date: { not: null, gte: fromDate, lte: toDate },
          status: { notIn: ["done", "completed"] },
        },
        select: {
          id: true,
          title: true,
          due_date: true,
          status: true,
          priority: true,
        },
      });
      taskRows.forEach((t) => {
        const d = parseYmd(t.due_date);
        if (!d) return;
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

    const todoRows = await prisma.crm_todos.findMany({
      where: {
        is_deleted: false,
        status: "pending",
        todo_date: { gte: fromDate, lte: toDate },
        OR: [
          { created_by: uid },
          { crm_todo_assignees: { some: { user_id: uid } } },
        ],
      },
      select: {
        id: true,
        body: true,
        todo_date: true,
        status: true,
        priority: true,
      },
    });
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
      const oppRows = await prisma.opportunities.findMany({
        where: {
          is_deleted: false,
          followup_at: { not: null, gte: rs, lte: re },
          stage: { notIn: ["closed_won", "closed_lost"] },
          OR: [{ owner_user_id: uid }, { created_by: uid }],
        },
        select: {
          id: true,
          title: true,
          followup_at: true,
          followup_type: true,
          stage: true,
        },
      });
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
    const fitnessRows = await prisma.fitness_clients.findMany({
      where: {
        OR: [
          { plan_start_date: { gte: fromDate, lte: toDate } },
          { plan_expiry_date: { gte: fromDate, lte: toDate } },
          { next_due_date: { gte: fromDate, lte: toDate } },
        ],
      },
      select: {
        client_id: true,
        full_name: true,
        plan_start_date: true,
        plan_expiry_date: true,
        next_due_date: true,
        status: true,
      },
    });

    fitnessRows.forEach((f) => {
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
          meta: { clientId: f.client_id, category: "plan_start" },
        });
      }
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
          meta: { clientId: f.client_id, category: "plan_expiry" },
        });
      }
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
          meta: { clientId: f.client_id, category: "consultation_due" },
        });
      }
    });

    const consultRows = await prisma.fitness_consultations.findMany({
      where: { consult_date: { gte: fromDate, lte: toDate } },
      select: {
        id: true,
        client_id: true,
        consult_date: true,
        consult_type: true,
        key_observations: true,
      },
    });
    if (consultRows.length) {
      const clientIds = [...new Set(consultRows.map((c) => c.client_id).filter(Boolean))];
      const clients = await prisma.fitness_clients.findMany({
        where: { client_id: { in: clientIds } },
        select: { client_id: true, full_name: true },
      });
      const nameById = Object.fromEntries(clients.map((c) => [c.client_id, c.full_name]));
      consultRows.forEach((c) => {
        const d = parseYmd(c.consult_date);
        if (!d) return;
        const fullName = nameById[c.client_id] || "Client";
        items.push({
          id: `fitness-consult-${c.id}`,
          source: "fitness",
          type: "fitness",
          title: `Consult: ${fullName}`,
          description: `${c.consult_type || "Consultation"}: ${c.key_observations || ""}`,
          start: `${d}T11:00:00`,
          end: `${d}T12:00:00`,
          allDay: false,
          meta: { clientId: c.client_id, consultationId: c.id },
        });
      });
    }

    const fTaskRows = await prisma.fitness_client_tasks.findMany({
      where: {
        due_date: { gte: fromDate, lte: toDate },
        status: { notIn: ["Done", "Carried_Forward"] },
      },
      select: {
        id: true,
        client_id: true,
        task_description: true,
        due_date: true,
        status: true,
      },
    });
    if (fTaskRows.length) {
      const clientIds = [...new Set(fTaskRows.map((t) => t.client_id).filter(Boolean))];
      const clients = await prisma.fitness_clients.findMany({
        where: { client_id: { in: clientIds } },
        select: { client_id: true, full_name: true },
      });
      const nameById = Object.fromEntries(clients.map((c) => [c.client_id, c.full_name]));
      fTaskRows.forEach((t) => {
        const d = parseYmd(t.due_date);
        if (!d) return;
        const fullName = nameById[t.client_id] || "Client";
        items.push({
          id: `fitness-task-${t.id}`,
          source: "fitness",
          type: "fitness",
          title: `Client Task: ${fullName}`,
          description: t.task_description,
          start: `${d}T14:00:00`,
          end: `${d}T15:00:00`,
          allDay: false,
          meta: { clientId: t.client_id, taskId: t.id },
        });
      });
    }

    if (await tableExists("leads")) {
      const leadRows = await prisma.leads.findMany({
        where: {
          OR: [{ created_by: uid }, { assigned_to: uid }],
          follow_up_date: { not: null, gte: fromDate, lte: toDate },
        },
        select: {
          id: true,
          name: true,
          follow_up_date: true,
          status: true,
        },
        take: 500,
      });
      leadRows.forEach((l) => {
        const d = parseYmd(l.follow_up_date);
        if (!d) return;
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
    const startDt = parseDateTime(start_at);
    if (!startDt) return res.status(400).json({ success: false, message: "start_at is required" });
    const endDt = end_at ? parseDateTime(end_at) : null;
    const allDay =
      all_day === true || all_day === 1 || String(all_day).toLowerCase() === "true";
    const cat = ALLOWED_CATEGORY.has(String(category || "").toLowerCase())
      ? String(category).toLowerCase()
      : "event";

    try {
      const token = await getGoogleToken(clerkUserId);
      if (token) {
        await createGoogleEvent(token, {
          title: String(title).trim(),
          description: description || null,
          start: startDt.toISOString(),
          end: endDt ? endDt.toISOString() : null,
        });
      }
    } catch (e) {
      console.warn("calendar google create:", e.message);
    }

    const created = await prisma.crm_calendar_events.create({
      data: {
        user_id: uid,
        title: String(title).trim(),
        description: description || null,
        start_at: startDt,
        end_at: endDt,
        all_day: allDay,
        category: cat,
      },
      select: { id: true },
    });

    emitCalendarChanged({ reason: "calendar", action: "create", id: created.id });
    return res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    console.error("createCalendarEvent", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function updateCalendarEvent(req, res) {
  try {
    const uid = Number(req.user?.id);
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const existing = await prisma.crm_calendar_events.findFirst({
      where: { id, user_id: uid },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    const { title, description, start_at, end_at, all_day, category } = req.body || {};
    const data = {};
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ success: false, message: "title is required" });
      data.title = String(title).trim();
    }
    if (description !== undefined) {
      data.description = description || null;
    }
    if (start_at !== undefined) {
      const s = parseDateTime(start_at);
      if (!s) return res.status(400).json({ success: false, message: "Invalid start_at" });
      data.start_at = s;
    }
    if (end_at !== undefined) {
      data.end_at = end_at ? parseDateTime(end_at) : null;
    }
    if (all_day !== undefined) {
      data.all_day =
        all_day === true || all_day === 1 || String(all_day).toLowerCase() === "true";
    }
    if (category !== undefined) {
      data.category = ALLOWED_CATEGORY.has(String(category || "").toLowerCase())
        ? String(category).toLowerCase()
        : "event";
    }
    if (!Object.keys(data).length) return res.json({ success: true });

    await prisma.crm_calendar_events.update({
      where: { id },
      data,
    });

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
    const id = Number(req.params.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const existing = await prisma.crm_calendar_events.findFirst({
      where: { id, user_id: uid },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    const { count } = await prisma.crm_calendar_events.deleteMany({
      where: { id, user_id: uid },
    });
    emitCalendarChanged({ reason: "calendar", action: "delete", id });
    return res.json({ success: true, deleted: Number(count) || 0 });
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

    await ensureCalendarCrmTables();

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
      const created = await prisma.tasks.create({
        data: {
          tenant_id: tenantId || null,
          title,
          description: b.description || null,
          lead_id: lid,
          assigned_to: uid,
          created_by: uid,
          due_date: dueDate ? toDateOnly(dueDate) : null,
          priority: "medium",
          status: "todo",
        },
        select: { id: true },
      });
      emitCalendarChanged({ reason: "tasks", action: "quick_add", id: created.id });
      emitAdminChanged({ scope: "stats", reason: "tasks", action: "create" });
      return res.status(201).json({ success: true, kind: "task", id: created.id });
    }

    if (kind === "reminder") {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "title is required" });
      const remindAt = parseDateTime(b.start_at || b.remind_at);
      if (!remindAt) return res.status(400).json({ success: false, message: "start_at or remind_at is required" });
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      const lid = Number.isFinite(leadId) && leadId > 0 ? leadId : null;
      const typeVal = normalizeReminderTypeCal(b.reminder_type);
      const created = await prisma.reminders.create({
        data: {
          user_id: uid,
          title,
          note: b.note || b.description || null,
          remind_at: remindAt,
          lead_id: lid,
          assigned_to_user_id: null,
          reminder_type: typeVal,
        },
        select: { id: true },
      });
      emitCalendarChanged({ reason: "reminders", action: "quick_add", id: created.id });
      emitAdminChanged({ scope: "stats", reason: "reminders", action: "create" });
      return res.status(201).json({ success: true, kind: "reminder", id: created.id });
    }

    if (kind === "meeting") {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "title is required" });
      const startDt = parseDateTime(b.start_at);
      if (!startDt) return res.status(400).json({ success: false, message: "start_at is required" });
      let endDt = parseDateTime(b.end_at);
      if (!endDt) {
        endDt = new Date(startDt.getTime());
        endDt.setHours(endDt.getHours() + 1);
      }
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      const lid = Number.isFinite(leadId) && leadId > 0 ? leadId : null;
      const meeting = await prisma.$transaction(async (tx) => {
        const created = await tx.meetings.create({
          data: {
            title,
            description: b.description || null,
            start_time: startDt,
            end_time: endDt,
            location: b.location || null,
            meet_link: b.meet_link || null,
            meeting_type: "virtual",
            status: "scheduled",
            recurrence: "once",
            organizer_id: uid,
            assigned_to_user_id: uid,
            lead_id: lid,
          },
          select: { id: true },
        });
        await tx.meeting_attendees.createMany({
          data: [{ meeting_id: created.id, user_id: uid }],
          skipDuplicates: true,
        });
        return created;
      });
      emitMeetingsChanged({ action: "create", id: meeting.id });
      emitCalendarChanged({ reason: "meetings", action: "quick_add", id: meeting.id });
      emitAdminChanged({ scope: "stats", reason: "meetings" });
      return res.status(201).json({ success: true, kind: "meeting", id: meeting.id });
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
      const todoId = await prisma.$transaction(async (tx) => {
        const created = await tx.crm_todos.create({
          data: {
            tenant_id: tenantId,
            body,
            frequency: "once",
            todo_date: toDateOnly(todoDate),
            priority: pri,
            carry_forward: false,
            status: "pending",
            attachment_json: null,
            created_by: uid,
          },
          select: { id: true },
        });
        await tx.crm_todo_assignees.deleteMany({ where: { todo_id: created.id } });
        await tx.crm_todo_assignees.create({
          data: { todo_id: created.id, user_id: uid },
        });
        return created.id;
      });
      emitTodosChanged({ action: "create", id: todoId, tenantId: tenantId || undefined });
      emitCalendarChanged({ reason: "todos", action: "quick_add", id: todoId });
      return res.status(201).json({ success: true, kind: "todo", id: todoId });
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
      const { count } = await prisma.leads.updateMany({
        where: {
          id: leadId,
          OR: [{ created_by: uid }, { assigned_to: uid }],
        },
        data: { follow_up_date: toDateOnly(fu) },
      });
      if (!count) {
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
    if (code === "P2021" || code === "ER_NO_SUCH_TABLE" || /doesn't exist/i.test(msg)) {
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
