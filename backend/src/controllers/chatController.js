const { pool } = require("../config/database");

async function getConversation(req, res) {
  try {
    const { tenantId } = req;
    const { otherUserId } = req.params;

    if (!tenantId || !otherUserId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const [messages] = await pool.execute(
      `SELECT * FROM chat_messages
       WHERE tenant_id = ? AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       ORDER BY created_at ASC
       LIMIT 100`,
      [tenantId, req.user.id, otherUserId, otherUserId, req.user.id]
    );

    res.json({ messages });
  } catch (err) {
    console.error("getConversation error:", err);
    res.status(500).json({ error: "Failed to get conversation" });
  }
}

async function sendMessage(req, res) {
  try {
    const { tenantId } = req;
    const { receiverId, content } = req.body;

    if (!tenantId || !receiverId || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [result] = await pool.execute(
      `INSERT INTO chat_messages (tenant_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)`,
      [tenantId, req.user.id, receiverId, content]
    );

    res.status(201).json({ id: result.insertId, sender_id: req.user.id, receiver_id: receiverId, content });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

async function getUnreadCount(req, res) {
  try {
    const { tenantId } = req;

    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM chat_messages
       WHERE tenant_id = ? AND receiver_id = ? AND is_read = 0`,
      [tenantId, req.user.id]
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