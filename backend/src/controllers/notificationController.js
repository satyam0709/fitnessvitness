const { pool } = require("../config/database");
const { emitNotificationReadState } = require("../realtime/meetingsRealtime");

function toLimit(v, fallback = 25, max = 100) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

async function getNotifications(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const limit = toLimit(req.query?.limit, 25, 100);

    const [rows] = await pool.query(
      `SELECT n.*, TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS actor_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_user_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`,
      [uid, limit]
    );

    const [[counts]] = await pool.query(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
       FROM notifications
       WHERE user_id = ?`,
      [uid]
    );

    res.json({
      success: true,
      notifications: rows,
      unread: Number(counts?.unread) || 0,
      total: Number(counts?.total) || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [result] = await pool.query(`DELETE FROM notifications WHERE user_id = ?`, [uid]);

    emitNotificationReadState(uid, { unread: 0, readAll: true, cleared: true });
    res.json({
      success: true,
      deleted: Number(result?.affectedRows) || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getNotifications,
  markAllNotificationsRead,
};
