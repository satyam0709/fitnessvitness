const { pool } = require("../config/database");

async function getConversation(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const { otherId } = req.params;

    const [rows] = await pool.execute(
      `SELECT m.*,
              s.first_name as sender_first, s.last_name as sender_last,
              s.clerk_user_id as clerk_sender_id
       FROM chat_messages m
       JOIN users s ON s.id = m.sender_id
       WHERE (m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [meId, Number(otherId), Number(otherId), meId]
    );

    await pool.execute(
      "UPDATE chat_messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0",
      [meId, Number(otherId)]
    );

    res.json({ success: true, messages: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function sendMessage(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const { receiver_id, body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    const [result] = await pool.execute(
      "INSERT INTO chat_messages (sender_id, receiver_id, body) VALUES (?, ?, ?)",
      [meId, receiver_id, body.trim()]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getUnreadCount(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.json({ success: true, count: 0 });

    const [[{ count }]] = await pool.execute(
      "SELECT COUNT(*) as count FROM chat_messages WHERE receiver_id = ? AND is_read = 0",
      [meId]
    );
    res.json({ success: true, count: Number(count) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getConversation, sendMessage, getUnreadCount };
