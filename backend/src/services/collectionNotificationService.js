const prisma = require("../config/prisma");
const { createUserNotification } = require("./notificationService");

async function getAdminUserIds() {
  const users = await prisma.users.findMany({
    where: {
      role: "admin"
    },
    select: { id: true }
  });
  return users.map((u) => Number(u.id)).filter((id) => id > 0);
}

async function notifyUsers(userIds, payload) {
  const unique = [...new Set(userIds.filter((id) => id > 0))];
  for (const uid of unique) {
    await createUserNotification({ userId: uid, ...payload });
  }
}

async function notifyCollectionCreated({ collection, actorUserId }) {
  const name =
    collection.client_name ||
    collection.external_buyer_name ||
    collection.client_id ||
    "Client";
  const pending = Number(collection.pending_inr || 0);
  const title = `Payment due: ${name}`;
  const body = `₹${pending.toLocaleString("en-IN")} pending for "${collection.title}". Follow-up ${collection.next_followup_date || "—"}.`;

  const recipients = new Set();
  if (collection.assigned_to) recipients.add(Number(collection.assigned_to));
  const admins = await getAdminUserIds();
  admins.forEach((id) => recipients.add(id));

  await notifyUsers([...recipients], {
    actorUserId,
    entityType: "collection_created",
    entityId: collection.id,
    title,
    body,
  });
}

async function notifyCollectionPaid({ collection, actorUserId }) {
  const name =
    collection.client_name ||
    collection.external_buyer_name ||
    collection.client_id ||
    "Client";
  const title = `Payment received: ${name}`;
  const body = `"${collection.title}" is fully paid.`;

  const recipients = new Set();
  if (collection.assigned_to) recipients.add(Number(collection.assigned_to));

  await notifyUsers([...recipients], {
    actorUserId,
    entityType: "collection_paid",
    entityId: collection.id,
    title,
    body,
  });
}

async function sweepCollectionFollowupNotifications(userId) {
  const uid = Number(userId);
  if (!uid) return;

  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today);

  const collections = await prisma.fitness_collections.findMany({
    where: {
      status: { in: ["open", "partial"] },
      pending_inr: { gt: 0 },
      next_followup_date: { not: null, lte: todayDate },
      OR: [{ assigned_to: uid }, { created_by: uid }],
    },
    select: {
      id: true,
      title: true,
      pending_inr: true,
      next_followup_date: true,
      assigned_to: true,
      client_id: true,
      external_buyer_id: true,
    },
  });
  const clientIds = [...new Set(collections.map((c) => c.client_id).filter(Boolean))];
  const buyerIds = [...new Set(collections.map((c) => c.external_buyer_id).filter(Boolean))];
  const [clients, buyers] = await Promise.all([
    clientIds.length
      ? prisma.fitness_clients.findMany({
          where: { client_id: { in: clientIds } },
          select: { client_id: true, full_name: true },
        })
      : [],
    buyerIds.length
      ? prisma.fitness_external_buyers.findMany({
          where: { id: { in: buyerIds } },
          select: { id: true, full_name: true },
        })
      : [],
  ]);
  const clientNameById = new Map(clients.map((c) => [c.client_id, c.full_name]));
  const buyerNameById = new Map(buyers.map((b) => [b.id, b.full_name]));
  const rows = collections.map((c) => ({
    ...c,
    client_name:
      (c.client_id && clientNameById.get(c.client_id)) ||
      (c.external_buyer_id && buyerNameById.get(c.external_buyer_id)) ||
      null,
  }));
  const admins = await getAdminUserIds();
  const isAdmin = admins.includes(uid);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  for (const row of rows) {
    const nextFollowup = row.next_followup_date ? new Date(row.next_followup_date) : null;
    const isOverdue = nextFollowup && nextFollowup < todayDate;
    const title = isOverdue
      ? `Overdue payment: ${row.client_name || "Client"}`
      : `Payment follow-up today: ${row.client_name || "Client"}`;
    const body = `₹${Number(row.pending_inr).toLocaleString("en-IN")} pending — ${row.title}`;

    const notifyIds = new Set([Number(row.assigned_to) || uid]);
    if (isAdmin) notifyIds.add(uid);
    admins.forEach((id) => notifyIds.add(id));

    for (const nid of notifyIds) {
      const exists = await prisma.notifications.findFirst({
        where: {
          user_id: nid,
          entity_type: "collection_followup",
          entity_id: BigInt(row.id),
          is_read: false,
          created_at: {
            gte: todayStart,
            lte: todayEnd
          }
        },
        select: { id: true }
      });
      if (exists) continue;

      await createUserNotification({
        userId: nid,
        entityType: "collection_followup",
        entityId: row.id,
        title,
        body,
      });
    }
  }
}

module.exports = {
  notifyCollectionCreated,
  notifyCollectionPaid,
  sweepCollectionFollowupNotifications,
};
