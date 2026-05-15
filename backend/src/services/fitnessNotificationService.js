const { pool } = require("../config/database");
const { createUserNotification } = require("./notificationService");

async function checkAndGenerateFitnessNotifications(userId) {
  const uid = Number(userId);
  if (!uid) return;

  try {
    // 1. Check for Plan Expiries (within next 7 days)
    const [expiries] = await pool.query(
      `SELECT id AS fitness_row_id, client_id, full_name, plan_expiry_date
       FROM fitness_clients
       WHERE status = 'Active'
         AND plan_expiry_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY)`
    );

    for (const client of expiries) {
      const title = `Plan Expiring: ${client.full_name}`;
      const body = `Plan for ${client.full_name} will expire on ${new Date(client.plan_expiry_date).toLocaleDateString()}.`;
      const rowId = Number(client.fitness_row_id);
      if (!rowId) continue;

      // Dedupe on numeric row id (client_id is VARCHAR — never use it as BIGINT entity_id)
      const [[exists]] = await pool.query(
        `SELECT id FROM notifications WHERE user_id = ? AND entity_type = 'fitness_expiry' AND entity_id = ? AND is_read = 0`,
        [uid, rowId]
      );

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

    // 2. Check for Consultation Dues (today or overdue)
    const [dues] = await pool.query(
      `SELECT id AS fitness_row_id, client_id, full_name, next_due_date
       FROM fitness_clients
       WHERE status = 'Active'
         AND next_due_date <= CURRENT_DATE`
    );

    for (const client of dues) {
      const isOverdue = new Date(client.next_due_date) < new Date();
      const title = isOverdue ? `Overdue Consult: ${client.full_name}` : `Consult Due Today: ${client.full_name}`;
      const body = `Consultation for ${client.full_name} was due on ${new Date(client.next_due_date).toLocaleDateString()}.`;
      const rowId = Number(client.fitness_row_id);
      if (!rowId) continue;

      const [[exists]] = await pool.query(
        `SELECT id FROM notifications WHERE user_id = ? AND entity_type = 'fitness_due' AND entity_id = ? AND is_read = 0`,
        [uid, rowId]
      );

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
