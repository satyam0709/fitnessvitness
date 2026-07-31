const prisma = require("../config/prisma");

async function getConversation(req, res) {
  try {
    const { otherUserId } = req.params;

    if (!otherUserId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const me = Number(req.user.id);
    const other = Number(otherUserId);

    const messages = await prisma.chat_messages.findMany({
      where: {
        OR: [
          { sender_id: me, receiver_id: other },
          { sender_id: other, receiver_id: me },
        ],
      },
      orderBy: { created_at: "asc" },
      take: 100,
    });

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

    const created = await prisma.chat_messages.create({
      data: {
        sender_id: req.user.id,
        receiver_id: Number(receiverId),
        content,
      },
    });

    res.status(201).json({
      id: created.id,
      sender_id: req.user.id,
      receiver_id: Number(receiverId),
      content,
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

async function getUnreadCount(req, res) {
  try {
    const count = await prisma.chat_messages.count({
      where: {
        receiver_id: req.user.id,
        is_read: false,
      },
    });

    res.json({ unreadCount: count });
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
