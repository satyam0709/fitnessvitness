const prisma = require("../config/prisma");
const { createUserNotification } = require("./notificationService");

async function checkAndGenerateFitnessNotifications(userId) {
  const uid = Number(userId);
  if (!uid) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);

    const expiries = await prisma.fitness_clients.findMany({
      where: {
        status: "Active",
        plan_expiry_date: { gte: today, lte: in7 },
      },
      select: { id: true, client_id: true, full_name: true, plan_expiry_date: true },
    });

    for (const client of expiries) {
      const title = `Plan Expiring: ${client.full_name}`;
      const body = `Plan for ${client.full_name} will expire on ${new Date(client.plan_expiry_date).toLocaleDateString()}.`;
      const rowId = Number(client.id);
      if (!rowId) continue;

      const exists = await prisma.notifications.findFirst({
        where: {
          user_id: uid,
          entity_type: "fitness_expiry",
          entity_id: rowId,
          is_read: false,
        },
        select: { id: true },
      });

      if (!exists) {
        await createUserNotification({
          userId: uid,
          entityType: "fitness_expiry",
          entityId: rowId,
          title,
          body,
        });
      }
    }

    const dues = await prisma.fitness_clients.findMany({
      where: {
        status: "Active",
        next_due_date: { lte: today },
      },
      select: { id: true, client_id: true, full_name: true, next_due_date: true },
    });

    for (const client of dues) {
      const isOverdue = new Date(client.next_due_date) < new Date();
      const title = isOverdue
        ? `Overdue Consult: ${client.full_name}`
        : `Consult Due Today: ${client.full_name}`;
      const body = `Consultation for ${client.full_name} was due on ${new Date(client.next_due_date).toLocaleDateString()}.`;
      const rowId = Number(client.id);
      if (!rowId) continue;

      const exists = await prisma.notifications.findFirst({
        where: {
          user_id: uid,
          entity_type: "fitness_due",
          entity_id: rowId,
          is_read: false,
        },
        select: { id: true },
      });

      if (!exists) {
        await createUserNotification({
          userId: uid,
          entityType: "fitness_due",
          entityId: rowId,
          title,
          body,
        });
      }
    }
  } catch (err) {
    console.error("checkAndGenerateFitnessNotifications error:", err);
  }
}

module.exports = {
  checkAndGenerateFitnessNotifications,
};
