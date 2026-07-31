const prisma = require("../config/prisma");
const { emitNotificationCreated } = require("../realtime/meetingsRealtime");

function clipText(v, max) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

function formatNotification(row) {
  if (!row) return null;
  const actor = row.users_notifications_actor_user_idTousers;
  const notification = {
    ...row,
    id: Number(row.id),
    entity_id: row.entity_id != null ? Number(row.entity_id) : null,
    actor_name: actor
      ? [actor.first_name, actor.last_name].filter(Boolean).join(" ").trim()
      : "",
  };
  delete notification.users_notifications_actor_user_idTousers;
  return notification;
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

  const created = await prisma.notifications.create({
    data: {
      user_id: uid,
      actor_user_id: aid,
      entity_type: et,
      entity_id: eid != null ? BigInt(eid) : null,
      title: t,
      body: b,
      is_read: false,
    },
  });

  const row = await prisma.notifications.findFirst({
    where: { id: created.id },
    include: {
      users_notifications_actor_user_idTousers: {
        select: { first_name: true, last_name: true },
      },
    },
  });

  const notification = formatNotification(row);
  if (notification) {
    try {
      emitNotificationCreated(uid, notification);
    } catch (e) {
      console.warn("emitNotificationCreated:", e?.message || e);
    }
  }
  return notification;
}

module.exports = {
  createUserNotification,
};
