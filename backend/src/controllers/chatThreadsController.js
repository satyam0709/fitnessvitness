const prisma = require("../config/prisma");

function displayName(u) {
  if (!u) return "";
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "";
}

function pairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

async function listChatUsers(req, res) {
  try {
    const users = await prisma.users.findMany({
      where: { is_active: true, NOT: { id: req.user.id } },
      select: { id: true, first_name: true, last_name: true, email: true, profile_image: true },
      orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        full_name: displayName(u),
        email: u.email,
        avatar_url: u.profile_image || null,
      })),
    });
  } catch (err) {
    console.error("listChatUsers error:", err);
    res.status(500).json({ error: "Failed to list users" });
  }
}

async function listThreads(req, res) {
  try {
    const meId = Number(req.user.id);
    const memberships = await prisma.chat_thread_members.findMany({
      where: { user_id: meId },
      include: {
        chat_threads: {
          include: {
            chat_thread_members: {
              include: {
                users: {
                  select: { id: true, first_name: true, last_name: true, email: true, profile_image: true },
                },
              },
            },
            chat_thread_messages: {
              orderBy: { created_at: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    const threads = memberships
      .map((m) => {
        const t = m.chat_threads;
        if (!t) return null;
        const other = (t.chat_thread_members || []).find((x) => x.user_id !== meId)?.users;
        const last = t.chat_thread_messages?.[0];
        return {
          id: t.id,
          thread_type: t.thread_type,
          title: t.title,
          created_by: t.created_by,
          created_at: t.created_at,
          updated_at: t.updated_at,
          participant_id: other?.id || null,
          full_name: displayName(other) || t.title || "Chat",
          avatar_url: other?.profile_image || null,
          last_message: last?.body || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    res.json({ threads });
  } catch (err) {
    console.error("listThreads error:", err);
    res.status(500).json({ error: "Failed to list threads" });
  }
}

async function getThreadDetails(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const meId = Number(req.user.id);
    const member = await prisma.chat_thread_members.findFirst({
      where: { thread_id: threadId, user_id: meId },
    });
    if (!member) return res.status(404).json({ error: "Thread not found" });

    const t = await prisma.chat_threads.findUnique({
      where: { id: threadId },
      include: {
        chat_thread_members: {
          include: {
            users: {
              select: { id: true, first_name: true, last_name: true, email: true, profile_image: true },
            },
          },
        },
      },
    });
    if (!t) return res.status(404).json({ error: "Thread not found" });

    const other = (t.chat_thread_members || []).find((x) => x.user_id !== meId)?.users;
    res.json({
      thread: {
        id: t.id,
        thread_type: t.thread_type,
        title: t.title,
        created_by: t.created_by,
        created_at: t.created_at,
        updated_at: t.updated_at,
        participant_id: other?.id || null,
        full_name: displayName(other) || t.title || "Chat",
        avatar_url: other?.profile_image || null,
      },
    });
  } catch (err) {
    console.error("getThreadDetails error:", err);
    res.status(500).json({ error: "Failed to get thread" });
  }
}

async function createThread(req, res) {
  try {
    const participantId = Number(req.body.participantId);
    if (!participantId) return res.status(400).json({ error: "Participant required" });
    const meId = Number(req.user.id);
    const key = pairKey(meId, participantId);

    const existingPair = await prisma.chat_direct_pairs.findUnique({ where: { pair_key: key } });
    if (existingPair) {
      return res.json({
        thread: {
          id: existingPair.thread_id,
          user_id: meId,
          participant_id: participantId,
        },
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const thread = await tx.chat_threads.create({
        data: {
          thread_type: "direct",
          created_by: meId,
        },
      });
      await tx.chat_thread_members.createMany({
        data: [
          { thread_id: thread.id, user_id: meId, member_role: "member" },
          { thread_id: thread.id, user_id: participantId, member_role: "member" },
        ],
      });
      await tx.chat_direct_pairs.create({
        data: { pair_key: key, thread_id: thread.id },
      });
      return thread;
    });

    res.status(201).json({
      thread: { id: created.id, user_id: meId, participant_id: participantId },
    });
  } catch (err) {
    console.error("createThread error:", err);
    res.status(500).json({ error: "Failed to create thread" });
  }
}

async function listMessages(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const messages = await prisma.chat_thread_messages.findMany({
      where: { thread_id: threadId },
      include: {
        users: {
          select: { id: true, first_name: true, last_name: true, email: true, profile_image: true },
        },
      },
      orderBy: { created_at: "asc" },
      take: 100,
    });
    res.json({
      messages: messages.map((m) => ({
        ...m,
        content: m.body,
        full_name: displayName(m.users),
        avatar_url: m.users?.profile_image || null,
        users: undefined,
      })),
    });
  } catch (err) {
    console.error("listMessages error:", err);
    res.status(500).json({ error: "Failed to list messages" });
  }
}

async function sendMessageToThread(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Content required" });

    const created = await prisma.chat_thread_messages.create({
      data: {
        thread_id: threadId,
        sender_id: req.user.id,
        body: content,
      },
    });
    await prisma.chat_threads.update({
      where: { id: threadId },
      data: { updated_at: new Date() },
    });
    res.status(201).json({ id: created.id, content, sender_id: req.user.id });
  } catch (err) {
    console.error("sendMessageToThread error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

async function markThreadRead(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const meId = Number(req.user.id);
    const last = await prisma.chat_thread_messages.findFirst({
      where: { thread_id: threadId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    await prisma.chat_thread_members.updateMany({
      where: { thread_id: threadId, user_id: meId },
      data: {
        last_read_message_id: last?.id || null,
        last_read_at: new Date(),
      },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("markThreadRead error:", err);
    res.status(500).json({ error: "Failed to mark thread read" });
  }
}

async function deleteThread(req, res) {
  try {
    const threadId = Number(req.params.threadId);
    const meId = Number(req.user.id);
    const member = await prisma.chat_thread_members.findFirst({
      where: { thread_id: threadId, user_id: meId },
    });
    if (!member) return res.status(404).json({ error: "Thread not found" });
    await prisma.chat_threads.delete({ where: { id: threadId } });
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
