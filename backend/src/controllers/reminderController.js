const { pool } = require("../config/database");
const { emitAdminChanged, emitCalendarChanged } = require("../realtime/meetingsRealtime");
const { createUserNotification } = require("../services/notificationService");

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
    const [rows] = await pool.query(
      `SELECT id FROM reminders
       WHERE id = ?
         AND is_deleted = 0
         AND (user_id = ? OR assigned_to_user_id = ?)`,
      [rid, uid, uid]
    );
    return rows[0];
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

    let where = "r.is_deleted = 0 AND (r.user_id = ? OR r.assigned_to_user_id = ?)";
    const params = [uid, uid];

    if (is_done !== undefined && is_done !== "") {
      where += " AND r.is_done = ?";
      params.push(is_done === "true" || is_done === "1" ? 1 : 0);
    }
    if (created_by) {
      const cid = parseInt(created_by, 10);
      if (Number.isFinite(cid) && cid > 0) {
        where += " AND r.user_id = ?";
        params.push(cid);
      }
    }
    if (assigned_to === "none") {
      where += " AND r.assigned_to_user_id IS NULL";
    } else if (assigned_to) {
      const aid = parseInt(assigned_to, 10);
      if (Number.isFinite(aid) && aid > 0) {
        where += " AND r.assigned_to_user_id = ?";
        params.push(aid);
      }
    }
    if (type && type !== "all") {
      where += " AND r.reminder_type = ?";
      params.push(String(type));
    }
    if (q && String(q).trim()) {
      where += " AND (r.title LIKE ? OR r.note LIKE ?)";
      const like = `%${String(q).trim()}%`;
      params.push(like, like);
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM reminders r WHERE ${where}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [reminders] = await pool.query(
      `SELECT r.*, l.name as lead_name,
        uc.full_name AS creator_name, uc.email AS creator_email,
        ua.full_name AS assignee_name, ua.email AS assignee_email
       FROM reminders r
       LEFT JOIN leads l ON l.id = r.lead_id
       LEFT JOIN users uc ON uc.id = r.user_id
       LEFT JOIN users ua ON ua.id = r.assigned_to_user_id
       WHERE ${where}
       ORDER BY r.remind_at ASC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    res.json({ success: true, total, reminders });
  } catch (err) {
    console.error("getReminders:", err.message);
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
      lead_id,
      assigned_to_user_id,
      reminder_type,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (!remind_at) {
      return res.status(400).json({ success: false, message: "remind_at is required" });
    }

    let assignId =
      assigned_to_user_id != null && assigned_to_user_id !== ""
        ? Number(assigned_to_user_id)
        : null;
    if (assignId !== null && !Number.isFinite(assignId)) assignId = null;

    const typeVal = normalizeType(reminder_type);

    const [result] = await pool.query(
      `INSERT INTO reminders (user_id, title, note, remind_at, lead_id, assigned_to_user_id, reminder_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        title.trim(),
        note || null,
        remind_at,
        lead_id ? Number(lead_id) : null,
        assignId,
        typeVal,
      ]
    );

    emitAdminChanged({ scope: "stats", reason: "reminders", action: "create" });
    emitCalendarChanged({ reason: "reminders" });
    if (assignId && assignId !== uid) {
      await createUserNotification({
        userId: assignId,
        actorUserId: uid,
        entityType: "reminder",
        entityId: result.insertId,
        title: "New reminder assigned",
        body: title.trim(),
      }).catch((e) => console.warn("reminder notification(create):", e.message));
    }
    res.status(201).json({ success: true, id: result.insertId });
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
    const [beforeRows] = await pool.query(
      "SELECT assigned_to_user_id, title FROM reminders WHERE id = ? AND is_deleted = 0 LIMIT 1",
      [Number(req.params.id)]
    );
    const before = beforeRows[0] || null;

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

    const fields = [];
    const vals = [];

    if (title !== undefined) {
      if (!title?.trim()) {
        return res.status(400).json({ success: false, message: "Title is required" });
      }
      fields.push("title = ?");
      vals.push(title.trim());
    }
    if (note !== undefined) {
      fields.push("note = ?");
      vals.push(note || null);
    }
    if (remind_at !== undefined) {
      fields.push("remind_at = ?");
      vals.push(remind_at || null);
    }
    if (lead_id !== undefined) {
      fields.push("lead_id = ?");
      vals.push(lead_id ? Number(lead_id) : null);
    }
    if (is_done !== undefined) {
      fields.push("is_done = ?");
      vals.push(is_done ? 1 : 0);
    }
    if (assignId !== undefined) {
      fields.push("assigned_to_user_id = ?");
      vals.push(assignId);
    }
    if (typeVal !== undefined) {
      fields.push("reminder_type = ?");
      vals.push(typeVal);
    }

    if (fields.length === 0) {
      return res.json({ success: true });
    }

    const rid = Number(req.params.id);
    vals.push(rid, uid, uid);
    await pool.query(
      `UPDATE reminders SET ${fields.join(", ")}
       WHERE id = ? AND is_deleted = 0 AND (user_id = ? OR assigned_to_user_id = ?)`,
      vals
    );
    emitAdminChanged({ scope: "stats", reason: "reminders", action: "update" });
    emitCalendarChanged({ reason: "reminders" });
    const nextAssigned =
      assignId !== undefined ? (assignId == null ? null : Number(assignId) || null) : Number(before?.assigned_to_user_id) || null;
    const prevAssigned = Number(before?.assigned_to_user_id) || null;
    if (nextAssigned && nextAssigned !== uid && nextAssigned !== prevAssigned) {
      await createUserNotification({
        userId: nextAssigned,
        actorUserId: uid,
        entityType: "reminder",
        entityId: Number(req.params.id),
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
    await pool.query(
      "UPDATE reminders SET is_done=1 WHERE id=? AND is_deleted = 0 AND (user_id=? OR assigned_to_user_id=?)",
      [rid, uid, uid]
    );
    emitCalendarChanged({ reason: "reminders" });
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
    const [result] = await pool.query(
      "UPDATE reminders SET is_deleted = 1, deleted_at = NOW() WHERE id=? AND is_deleted = 0 AND (user_id=? OR assigned_to_user_id=?)",
      [rid, uid, uid]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Reminder not found" });
    }
    emitAdminChanged({ scope: "stats", reason: "reminders", action: "delete" });
    emitCalendarChanged({ reason: "reminders" });
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
    const ph = nums.map(() => "?").join(",");
    const [result] = await pool.query(
      `UPDATE reminders
       SET is_deleted = 1, deleted_at = NOW()
       WHERE is_deleted = 0
         AND id IN (${ph})
         AND (user_id = ? OR assigned_to_user_id = ?)`,
      [...nums, uid, uid]
    );
    if (result.affectedRows) {
      emitAdminChanged({ scope: "stats", reason: "reminders", action: "bulk_delete" });
      emitCalendarChanged({ reason: "reminders" });
    }
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error("bulkDeleteReminders:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getReminders,
  createReminder,
  updateReminder,
  markReminderDone,
  deleteReminder,
  bulkDeleteReminders,
};
