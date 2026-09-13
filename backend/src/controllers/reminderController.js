const prisma = require("../config/prisma");
const { emitAdminChanged, emitCalendarChanged, emitRemindersChanged } = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");
const { getReminderFormMeta, computeRemindAt, sanitizeRecurrence } = require("../services/reminderFormMeta");

const REMINDER_TYPES = new Set([
  "general",
  "follow_up",
  "payment",
  "meeting",
  "customer_reminder",
]);

function normalizeType(t) {
  const v = (t && String(t).trim()) || "general";
  return REMINDER_TYPES.has(v) ? v : "general";
}

async function assertReminderAccess(reminderId, dbUserId) {
  const rid = Number(reminderId);
  const uid = Number(dbUserId);
  if (!Number.isFinite(rid) || !Number.isFinite(uid)) return null;
  try {
    const row = await prisma.reminders.findFirst({
      where: {
        id: rid,
        is_deleted: false,
        OR: [
          { user_id: uid },
          { assigned_to_user_id: uid }
        ]
      },
      select: { id: true }
    });
    return row;
  } catch {
    return null;
  }
}

async function getReminders(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({
        success: false,
        message:
          "Could not resolve your account in the database. Try syncing from profile or sign in again.",
      });
    }
    const {
      limit: limitRaw,
      page: pageRaw,
      is_done,
      q,
      created_by,
      assigned_to,
      type,
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500);
    const pag = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const offset = (pag - 1) * lim;

    const conditions = [
      { is_deleted: false },
      {
        OR: [
          { user_id: uid },
          { assigned_to_user_id: uid }
        ]
      }
    ];

    if (is_done !== undefined && is_done !== "") {
      const doneVal = is_done === "true" || is_done === "1";
      conditions.push({ is_done: doneVal });
    }
    if (created_by) {
      const cid = parseInt(created_by, 10);
      if (Number.isFinite(cid) && cid > 0) {
        conditions.push({ user_id: cid });
      }
    }
    if (assigned_to === "none") {
      conditions.push({ assigned_to_user_id: null });
    } else if (assigned_to) {
      const aid = parseInt(assigned_to, 10);
      if (Number.isFinite(aid) && aid > 0) {
        conditions.push({ assigned_to_user_id: aid });
      }
    }
    if (type && type !== "all") {
      conditions.push({ reminder_type: String(type) });
    }
    if (q && String(q).trim()) {
      const qStr = String(q).trim();
      conditions.push({
        OR: [
          { title: { contains: qStr } },
          { note: { contains: qStr } }
        ]
      });
    }

    const total = await prisma.reminders.count({
      where: { AND: conditions }
    });

    const rows = await prisma.reminders.findMany({
      where: { AND: conditions },
      include: {
        leads: {
          select: { name: true }
        },
        users_reminders_user_idTousers: {
          select: { first_name: true, last_name: true, email: true }
        },
        users_reminders_assigned_to_user_idTousers: {
          select: { first_name: true, last_name: true, email: true }
        }
      },
      orderBy: { remind_at: "asc" },
      skip: offset,
      take: lim
    });

    const reminders = rows.map(r => {
      const creator = r.users_reminders_user_idTousers;
      const assignee = r.users_reminders_assigned_to_user_idTousers;
      const lead = r.leads;

      const formatted = { ...r };
      delete formatted.users_reminders_user_idTousers;
      delete formatted.users_reminders_assigned_to_user_idTousers;
      delete formatted.leads;

      formatted.lead_name = lead?.name || null;
      formatted.creator_name = creator ? `${creator.first_name || ""} ${creator.last_name || ""}`.trim() : "";
      formatted.creator_email = creator?.email || null;
      formatted.assignee_name = assignee ? `${assignee.first_name || ""} ${assignee.last_name || ""}`.trim() : null;
      formatted.assignee_email = assignee?.email || null;

      return formatted;
    });

    res.json({ success: true, total, reminders });
  } catch (err) {
    console.error("getReminders:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getReminderMeta(_req, res) {
  try {
    res.json({ success: true, data: getReminderFormMeta() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createReminder(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({
        success: false,
        message: "Could not resolve your account in the database.",
      });
    }
    const {
      title,
      note,
      remind_at,
      time,
      weekday,
      lead_id,
      assigned_to_user_id,
      reminder_type,
      recurrence,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const rec = sanitizeRecurrence(recurrence);
    const computed = computeRemindAt({
      recurrence: rec,
      remind_at,
      time,
      weekday,
    });
    const remindAtDate = computed || (remind_at ? new Date(remind_at) : null);
    if (!remindAtDate || Number.isNaN(remindAtDate.getTime())) {
      return res.status(400).json({ success: false, message: "remind_at is required" });
    }

    let assignId =
      assigned_to_user_id != null && assigned_to_user_id !== ""
        ? Number(assigned_to_user_id)
        : null;
    if (assignId !== null && !Number.isFinite(assignId)) assignId = null;

    const typeVal = normalizeType(reminder_type);

    const result = await prisma.reminders.create({
      data: {
        user_id: uid,
        title: title.trim(),
        note: note || null,
        remind_at: remindAtDate,
        lead_id: lead_id ? Number(lead_id) : null,
        assigned_to_user_id: assignId,
        reminder_type: typeVal
      }
    });

    emitAdminChanged({ scope: "stats", reason: "reminders", action: "create" });
    emitCalendarChanged({ reason: "reminders" });
    emitRemindersChanged({ reason: "reminders" });
    if (assignId && assignId !== uid) {
      await createUserNotification({
        userId: assignId,
        actorUserId: uid,
        entityType: "reminder",
        entityId: result.id,
        title: "New reminder assigned",
        body: title.trim(),
      }).catch((e) => console.warn("reminder notification(create):", e.message));
    }
    res.status(201).json({ success: true, id: result.id });
  } catch (err) {
    console.error("createReminder:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateReminder(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({
        success: false,
        message: "Could not resolve your account in the database.",
      });
    }
    const row = await assertReminderAccess(req.params.id, uid);
    if (!row) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }
    const before = await prisma.reminders.findFirst({
      where: { id: Number(req.params.id), is_deleted: false },
      select: { assigned_to_user_id: true, title: true }
    });

    const {
      title,
      note,
      remind_at,
      lead_id,
      is_done,
      assigned_to_user_id,
      reminder_type,
    } = req.body;

    let assignId =
      assigned_to_user_id !== undefined
        ? assigned_to_user_id != null && assigned_to_user_id !== ""
          ? Number(assigned_to_user_id)
          : null
        : undefined;

    if (assignId !== undefined && assignId !== null && !Number.isFinite(assignId)) {
      assignId = null;
    }

    const typeVal =
      reminder_type !== undefined ? normalizeType(reminder_type) : undefined;

    const data = {};

    if (title !== undefined) {
      if (!title?.trim()) {
        return res.status(400).json({ success: false, message: "Title is required" });
      }
      data.title = title.trim();
    }
    if (note !== undefined) {
      data.note = note || null;
    }
    if (remind_at !== undefined) {
      data.remind_at = remind_at ? new Date(remind_at) : null;
    }
    if (lead_id !== undefined) {
      data.lead_id = lead_id ? Number(lead_id) : null;
    }
    if (is_done !== undefined) {
      data.is_done = !!is_done;
    }
    if (assignId !== undefined) {
      data.assigned_to_user_id = assignId;
    }
    if (typeVal !== undefined) {
      data.reminder_type = typeVal;
    }

    if (Object.keys(data).length === 0) {
      return res.json({ success: true });
    }

    const rid = Number(req.params.id);
    await prisma.reminders.update({
      where: { id: rid },
      data
    });

    emitAdminChanged({ scope: "stats", reason: "reminders", action: "update" });
    emitCalendarChanged({ reason: "reminders" });
    emitRemindersChanged({ reason: "reminders" });
    
    const nextAssigned =
      assignId !== undefined ? (assignId == null ? null : Number(assignId) || null) : Number(before?.assigned_to_user_id) || null;
    const prevAssigned = Number(before?.assigned_to_user_id) || null;
    if (nextAssigned && nextAssigned !== uid && nextAssigned !== prevAssigned) {
      await createUserNotification({
        userId: nextAssigned,
        actorUserId: uid,
        entityType: "reminder",
        entityId: rid,
        title: "Reminder assigned to you",
        body: title?.trim() || before?.title || "A reminder was assigned to you.",
      }).catch((e) => console.warn("reminder notification(assign):", e.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("updateReminder:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markReminderDone(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({ success: false, message: "User not resolved" });
    }
    const row = await assertReminderAccess(req.params.id, uid);
    if (!row) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }
    const rid = Number(req.params.id);
    await prisma.reminders.update({
      where: { id: rid },
      data: { is_done: true }
    });
    emitCalendarChanged({ reason: "reminders" });
    emitRemindersChanged({ reason: "reminders" });
    res.json({ success: true });
  } catch (err) {
    console.error("markReminderDone:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteReminder(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({ success: false, message: "User not resolved" });
    }
    const rid = Number(req.params.id);
    const row = await assertReminderAccess(rid, uid);
    if (!row) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }
    await prisma.reminders.update({
      where: { id: rid },
      data: {
        is_deleted: true,
        deleted_at: new Date()
      }
    });
    emitAdminChanged({ scope: "stats", reason: "reminders", action: "delete" });
    emitCalendarChanged({ reason: "reminders" });
    emitRemindersChanged({ reason: "reminders" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteReminder:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function bulkDeleteReminders(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(500).json({ success: false, message: "User not resolved" });
    }
    let { ids } = req.body;
    if (!Array.isArray(ids)) ids = [];
    const nums = [
      ...new Set(
        ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      ),
    ];
    if (nums.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Non-empty ids array required" });
    }
    
    const deletedCount = await prisma.$transaction(async (tx) => {
      const result = await tx.reminders.updateMany({
        where: {
          id: { in: nums },
          is_deleted: false,
          OR: [
            { user_id: uid },
            { assigned_to_user_id: uid }
          ]
        },
        data: {
          is_deleted: true,
          deleted_at: new Date()
        }
      });
      return result.count;
    });

    if (deletedCount) {
      emitAdminChanged({ scope: "stats", reason: "reminders", action: "bulk_delete" });
      emitCalendarChanged({ reason: "reminders" });
      emitRemindersChanged({ reason: "reminders" });
    }
    res.json({ success: true, deleted: deletedCount });
  } catch (err) {
    console.error("bulkDeleteReminders:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getReminders,
  getReminderMeta,
  createReminder,
  updateReminder,
  markReminderDone,
  deleteReminder,
  bulkDeleteReminders,
};
