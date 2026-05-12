const { pool } = require("../config/database");
const { emitNotificationCreated } = require("../realtime/meetingsRealtime");

function clipText(v, max) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

async function createUserNotification({
  userId,
  actorUserId = null,
  entityType = "general",
  entityId = null,
  title,
  body = null,
}) {
  const uid = Number(userId);
  if (!uid) return null;
  const aid = Number(actorUserId) || null;
  if (aid && aid === uid) return null;

  const t = clipText(title, 220);
  if (!t) return null;
  const b = body ? clipText(body, 2000) : null;
  const et = clipText(entityType || "general", 50) || "general";
  const eid = entityId == null ? null : Number(entityId) || null;

  const [result] = await pool.query(
    `INSERT INTO notifications
      (user_id, actor_user_id, entity_type, entity_id, title, body, is_read)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [uid, aid, et, eid, t, b]
  );

  const [rows] = await pool.query(
    `SELECT n.*, TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS actor_name
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_user_id
     WHERE n.id = ? LIMIT 1`,
    [result.insertId]
  );
  const notification = rows[0] || null;
  if (notification) emitNotificationCreated(uid, notification);
  return notification;
}

module.exports = {
  createUserNotification,
};
