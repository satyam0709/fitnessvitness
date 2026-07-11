const prisma = require("../config/prisma");
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

    const rows = await prisma.notifications.findMany({
      where: {
        user_id: uid,
      },
      include: {
        users_notifications_actor_user_idTousers: {
          select: {
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: [
        { created_at: "desc" },
        { id: "desc" },
      ],
      take: limit,
    });

    const unread = await prisma.notifications.count({
      where: {
        user_id: uid,
        is_read: false,
      },
    });

    const total = await prisma.notifications.count({
      where: {
        user_id: uid,
      },
    });

    const notifications = rows.map((n) => {
      const actor = n.users_notifications_actor_user_idTousers;
      const formatted = {
        ...n,
        id: Number(n.id),
        entity_id: n.entity_id != null ? Number(n.entity_id) : null,
        actor_name: actor ? [actor.first_name, actor.last_name].filter(Boolean).join(" ").trim() : "",
      };
      delete formatted.users_notifications_actor_user_idTousers;
      return formatted;
    });

    res.json({
      success: true,
      notifications,
      unread,
      total,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { count } = await prisma.notifications.updateMany({
      where: {
        user_id: uid,
        is_read: false,
      },
      data: {
        is_read: true,
        read_at: new Date(),
      },
    });

    emitNotificationReadState(uid, { unread: 0, readAll: true, cleared: true });
    res.json({
      success: true,
      updated: count,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getNotifications,
  markAllNotificationsRead,
};
