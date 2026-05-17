const { pool } = require("../config/database");
const { createUserNotification } = require("./notificationService");

async function getAdminUserIds() {
  const [rows] = await pool.execute(
    `SELECT id FROM users WHERE LOWER(role) = 'admin' AND id IS NOT NULL`
  );
  return rows.map((r) => Number(r.id)).filter((id) => id > 0);
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

  const [rows] = await pool.execute(
    `SELECT c.id, c.title, c.pending_inr, c.next_followup_date,
            COALESCE(fc.full_name, eb.full_name) AS client_name,
            c.assigned_to
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE c.status IN ('open','partial')
       AND c.pending_inr > 0
       AND c.next_followup_date IS NOT NULL
       AND c.next_followup_date <= ?
       AND (c.assigned_to = ? OR c.created_by = ?)`,
    [today, uid, uid]
  );

  const admins = await getAdminUserIds();
  const isAdmin = admins.includes(uid);

  for (const row of rows) {
    const isOverdue = String(row.next_followup_date) < today;
    const title = isOverdue
      ? `Overdue payment: ${row.client_name || "Client"}`
      : `Payment follow-up today: ${row.client_name || "Client"}`;
    const body = `₹${Number(row.pending_inr).toLocaleString("en-IN")} pending — ${row.title}`;

    const notifyIds = new Set([Number(row.assigned_to) || uid]);
    if (isAdmin) notifyIds.add(uid);
    admins.forEach((id) => notifyIds.add(id));

    for (const nid of notifyIds) {
      const [existsRows] = await pool.execute(
        `SELECT id FROM notifications
         WHERE user_id = ? AND entity_type = 'collection_followup' AND entity_id = ?
           AND DATE(created_at) = CURDATE() AND is_read = 0
         LIMIT 1`,
        [nid, row.id]
      );
      const exists = existsRows[0];
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
