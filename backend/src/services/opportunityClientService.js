const prisma = require("../config/prisma");
const { generateClientId } = require("./fitnessComputedFields");
const { tableExists } = require("../utils/schemaHelpers");

const PRODUCT_TO_PLAN = {
  membership_or_program: "Month_3_Plan",
  personal_training: "Month_1_Plan",
  nutrition_or_supplements: "Month_1_Plan",
  initial_consultation: "Month_1_Plan",
  follow_up: "Month_1_Plan",
};

const LEAD_SOURCE_TO_CLIENT_SOURCE = {
  walk_in: "Walk_in",
  referral: "Referral___Existing_Client",
  social_media: "Instagram",
  website: "Online___Website",
  partner: "Corporate___Company",
};

async function fitnessTableExists() {
  return await tableExists("fitness_clients");
}

/**
 * Create an Active fitness client from a won opportunity.
 * @returns {{ client_id: string, row: object } | null}
 */
async function createClientFromOpportunity(txOrPrisma, opportunity, userId) {
  if (!(await fitnessTableExists())) return null;

  const client = txOrPrisma || prisma;
  const title = String(opportunity.title || "").trim() || "New client";
  const phone = opportunity.phone ? String(opportunity.phone).trim().slice(0, 20) : null;
  const visitPurpose = opportunity.visit_purpose ? String(opportunity.visit_purpose).trim() : null;
  const productKey = String(opportunity.product_category || "").toLowerCase();
  const planType = PRODUCT_TO_PLAN[productKey] || "Month_1_Plan";
  const leadSource = String(opportunity.lead_source || "walk_in").toLowerCase();
  const source = LEAD_SOURCE_TO_CLIENT_SOURCE[leadSource] || "Walk_in";
  const healthGoal = visitPurpose || opportunity.notes || null;

  const count = await client.fitness_clients.count();
  const clientId = generateClientId(Number(count) || 0);
  const today = new Date();

  const newClient = await client.fitness_clients.create({
    data: {
      client_id: clientId,
      full_name: title,
      phone: phone || "",
      email: null,
      status: 'Active',
      source,
      health_goal: healthGoal,
      plan_type: planType,
      plan_start_date: today,
      follow_up_freq_days: 14,
      coach_notes: opportunity.notes ? `From opportunity #${opportunity.id}: ${String(opportunity.notes).slice(0, 500)}` : `From opportunity #${opportunity.id}`,
    }
  });

  return { client_id: clientId, row: newClient };
}

async function linkExistingClient(txOrPrisma, opportunityId, clientId) {
  const client = txOrPrisma || prisma;
  const cid = String(clientId || "").trim();
  if (!cid) return { ok: false, message: "client_id is required" };

  const existingClient = await client.fitness_clients.findFirst({
    where: {
      client_id: cid,
      status: 'Active'
    },
    select: {
      client_id: true,
      full_name: true
    }
  });

  if (!existingClient) return { ok: false, message: "Active client not found" };

  await client.opportunities.update({
    where: { id: Number(opportunityId) },
    data: {
      client_id: cid,
      updated_at: new Date()
    }
  });

  return { ok: true, client: existingClient };
}

module.exports = {
  createClientFromOpportunity,
  linkExistingClient,
  fitnessTableExists,
};
