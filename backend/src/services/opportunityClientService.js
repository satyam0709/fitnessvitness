const { pool } = require("../config/database");
const { generateClientId } = require("./fitnessComputedFields");

const PRODUCT_TO_PLAN = {
  membership_or_program: "3 Month Plan",
  personal_training: "1 Month Plan",
  nutrition_or_supplements: "1 Month Plan",
  initial_consultation: "1 Month Plan",
  follow_up: "1 Month Plan",
};

const LEAD_SOURCE_TO_CLIENT_SOURCE = {
  walk_in: "Walk-in",
  referral: "Referral - Existing Client",
  social_media: "Instagram",
  website: "Online / Website",
  partner: "Corporate / Company",
};

async function fitnessTableExists() {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fitness_clients' LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * Create an Active fitness client from a won opportunity.
 * @returns {{ client_id: string, row: object } | null}
 */
async function createClientFromOpportunity(executor, opportunity, userId) {
  if (!(await fitnessTableExists())) return null;

  const db = executor || pool;
  const title = String(opportunity.title || "").trim() || "New client";
  const phone = opportunity.phone ? String(opportunity.phone).trim().slice(0, 20) : null;
  const visitPurpose = opportunity.visit_purpose ? String(opportunity.visit_purpose).trim() : null;
  const productKey = String(opportunity.product_category || "").toLowerCase();
  const planType = PRODUCT_TO_PLAN[productKey] || "1 Month Plan";
  const leadSource = String(opportunity.lead_source || "walk_in").toLowerCase();
  const source = LEAD_SOURCE_TO_CLIENT_SOURCE[leadSource] || "Walk-in";
  const healthGoal = visitPurpose || opportunity.notes || null;

  const [[{ count }]] = await db.execute("SELECT COUNT(*) AS count FROM fitness_clients");
  const clientId = generateClientId(Number(count) || 0);
  const today = new Date().toISOString().slice(0, 10);

  const [result] = await db.execute(
    `INSERT INTO fitness_clients (
      client_id, full_name, phone, email, status, source, health_goal, plan_type,
      plan_start_date, follow_up_freq_days, coach_notes
    ) VALUES (?, ?, ?, NULL, 'Active', ?, ?, ?, ?, 14, ?)`,
    [
      clientId,
      title,
      phone,
      source,
      healthGoal,
      planType,
      today,
      opportunity.notes ? `From opportunity #${opportunity.id}: ${String(opportunity.notes).slice(0, 500)}` : `From opportunity #${opportunity.id}`,
    ]
  );

  const [rows] = await db.execute("SELECT * FROM fitness_clients WHERE id = ?", [result.insertId]);
  return { client_id: clientId, row: rows[0] || null };
}

async function linkExistingClient(executor, opportunityId, clientId) {
  const db = executor || pool;
  const cid = String(clientId || "").trim();
  if (!cid) return { ok: false, message: "client_id is required" };

  const [rows] = await db.execute(
    "SELECT client_id, full_name FROM fitness_clients WHERE client_id = ? AND status = 'Active' LIMIT 1",
    [cid]
  );
  if (!rows[0]) return { ok: false, message: "Active client not found" };

  await db.execute(
    "UPDATE opportunities SET client_id = ?, updated_at = NOW() WHERE id = ?",
    [cid, opportunityId]
  );
  return { ok: true, client: rows[0] };
}

module.exports = {
  createClientFromOpportunity,
  linkExistingClient,
  fitnessTableExists,
};
