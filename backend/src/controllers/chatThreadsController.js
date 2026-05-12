const { pool } = require("../config/database");

async function listChatUsers(req, res) {
  try {
    const { tenantId } = req;
    const [users] = await pool.execute(
      `SELECT id, first_name, last_name, email, avatar_url FROM users
       WHERE tenant_id = ? AND is_active = 1 AND id != ?
       ORDER BY first_name, last_name`,
      [tenantId, req.user.id]
    );
    res.json({ users });
  } catch (err) {
    console.error("listChatUsers error:", err);
    res.status(500).json({ error: "Failed to list users" });
  }
}

async function listThreads(req, res) {
  try {
    const { tenantId } = req;
    const [threads] = await pool.execute(
      `SELECT t.*, u.first_name, u.last_name, u.avatar_url,
              (SELECT content FROM chat_thread_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM chat_threads t
       LEFT JOIN users u ON (t.participant_id = u.id)
       WHERE t.tenant_id = ? AND t.user_id = ?
       ORDER BY t.updated_at DESC`,
      [tenantId, req.user.id]
    );
    res.json({ threads });
  } catch (err) {
    console.error("listThreads error:", err);
    res.status(500).json({ error: "Failed to list threads" });
  }
}

async function getThreadDetails(req, res) {
  try {
    const { threadId } = req.params;
    const { tenantId } = req;
    const [threads] = await pool.execute(
      `SELECT t.*, u.first_name, u.last_name, u.avatar_url
       FROM chat_threads t
       LEFT JOIN users u ON (t.participant_id = u.id)
       WHERE t.id = ? AND t.tenant_id = ?`,
      [threadId, tenantId]
    );
    if (!threads.length) return res.status(404).json({ error: "Thread not found" });
    res.json({ thread: threads[0] });
  } catch (err) {
    console.error("getThreadDetails error:", err);
    res.status(500).json({ error: "Failed to get thread" });
  }
}

async function createThread(req, res) {
  try {
    const { tenantId } = req;
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ error: "Participant required" });

    const [existing] = await pool.execute(
      `SELECT id FROM chat_threads
       WHERE tenant_id = ? AND user_id = ? AND participant_id = ?`,
      [tenantId, req.user.id, participantId]
    );
    if (existing.length) return res.json({ thread: existing[0] });

    const [result] = await pool.execute(
      `INSERT INTO chat_threads (tenant_id, user_id, participant_id) VALUES (?, ?, ?)`,
      [tenantId, req.user.id, participantId]
    );
    res.status(201).json({ thread: { id: result.insertId, user_id: req.user.id, participant_id: participantId } });
  } catch (err) {
    console.error("createThread error:", err);
    res.status(500).json({ error: "Failed to create thread" });
  }
}

async function listMessages(req, res) {
  try {
    const { threadId } = req.params;
    const { tenantId } = req;
    const [messages] = await pool.execute(
      `SELECT m.*, u.first_name, u.last_name, u.avatar_url
       FROM chat_thread_messages m
       LEFT JOIN users u ON (m.sender_id = u.id)
       WHERE m.thread_id = ? AND m.tenant_id = ?
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [threadId, tenantId]
    );
    res.json({ messages });
  } catch (err) {
    console.error("listMessages error:", err);
    res.status(500).json({ error: "Failed to list messages" });
  }
}

async function sendMessageToThread(req, res) {
  try {
    const { threadId } = req.params;
    const { content } = req.body;
    const { tenantId } = req;
    if (!content) return res.status(400).json({ error: "Content required" });

    const [result] = await pool.execute(
      `INSERT INTO chat_thread_messages (tenant_id, thread_id, sender_id, content) VALUES (?, ?, ?, ?)`,
      [tenantId, threadId, req.user.id, content]
    );
    await pool.execute(`UPDATE chat_threads SET updated_at = NOW() WHERE id = ?`, [threadId]);
    res.status(201).json({ id: result.insertId, content, sender_id: req.user.id });
  } catch (err) {
    console.error("sendMessageToThread error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

async function markThreadRead(req, res) {
  try {
    const { threadId } = req.params;
    const { tenantId } = req;
    await pool.execute(
      `UPDATE chat_thread_messages SET is_read = 1 WHERE thread_id = ? AND receiver_id = ? AND tenant_id = ?`,
      [threadId, req.user.id, tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("markThreadRead error:", err);
    res.status(500).json({ error: "Failed to mark thread read" });
  }
}

async function deleteThread(req, res) {
  try {
    const { threadId } = req.params;
    const { tenantId } = req;
    await pool.execute(`DELETE FROM chat_threads WHERE id = ? AND tenant_id = ? AND user_id = ?`, [threadId, tenantId, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteThread error:", err);
    res.status(500).json({ error: "Failed to delete thread" });
  }
}

async function getChatRetentionStatus(req, res) {
  try {
    res.json({ retention_days: 30, status: "active" });
  } catch (err) {
    res.status(500).json({ error: "Failed to get retention status" });
  }
}

module.exports = {
  listChatUsers,
  listThreads,
  getThreadDetails,
  createThread,
  listMessages,
  sendMessageToThread,
  markThreadRead,
  deleteThread,
  getChatRetentionStatus,
};