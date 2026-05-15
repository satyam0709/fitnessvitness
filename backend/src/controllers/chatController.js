const { pool } = require("../config/database");

async function getConversation(req, res) {
  try {
    const { otherUserId } = req.params;

    if (!otherUserId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const [messages] = await pool.execute(
      `SELECT * FROM chat_messages
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       ORDER BY created_at ASC
       LIMIT 100`,
      [req.user.id, otherUserId, otherUserId, req.user.id]
    );

    res.json({ messages });
  } catch (err) {
    console.error("getConversation error:", err);
    res.status(500).json({ error: "Failed to get conversation" });
  }
}

async function sendMessage(req, res) {
  try {
    const { receiverId, content } = req.body;

    if (!receiverId || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [result] = await pool.execute(
      `INSERT INTO chat_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`,
      [req.user.id, receiverId, content]
    );

    res.status(201).json({ id: result.insertId, sender_id: req.user.id, receiver_id: receiverId, content });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

async function getUnreadCount(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM chat_messages
       WHERE receiver_id = ? AND is_read = 0`,
      [req.user.id]
    );

    res.json({ unreadCount: rows[0].count });
  } catch (err) {
    console.error("getUnreadCount error:", err);
    res.status(500).json({ error: "Failed to get unread count" });
  }
}

module.exports = {
  getConversation,
  sendMessage,
  getUnreadCount,
};