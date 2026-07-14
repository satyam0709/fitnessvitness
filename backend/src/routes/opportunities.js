const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { requireFeature } = require("../middleware/requireFeature");
const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const {
  emitAdminChanged,
  emitCalendarChanged,
  emitOpportunitiesChanged,
  emitRemindersChanged,
  emitFitnessChanged,
} = require("../realtime/meetingsRealtime");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const {
  createClientFromOpportunity,
  linkExistingClient,
} = require("../services/opportunityClientService");

function tenantId(req) {
  return req.user?.tenantId ?? req.tenantId ?? null;
}

function emitOppChanges(req, action, extra = {}) {
  const tid = tenantId(req);
  emitAdminChanged(tid);
  emitCalendarChanged({ reason: "opportunities", tenantId: tid || undefined });
  emitOpportunitiesChanged({ action, tenantId: tid || undefined, ...extra });
}

const router = express.Router();
router.use(verifyToken);
router.use(requireFeature("opportunities"));

const STAGE_ALIAS = {
  open: "qualification_done",
  proposal: "quotation_given",
  negotiation: "negotiation_review",
  qualification_done: "qualification_done",
  consultation_done: "consultation_done",
  quotation_given: "quotation_given",
  negotiation_review: "negotiation_review",
  on_hold: "on_hold",
  closed_won: "closed_won",
  closed_lost: "closed_lost",
};
const VALID_STAGE = new Set(Object.keys(STAGE_ALIAS));
const FOLLOWUP_TYPES = new Set(["call", "email", "meeting", "whatsapp", "demo", "other"]);
const OPPORTUNITY_TYPES = new Set(["new_business", "upsell", "renewal", "cross_sell", "other"]);
const LEAD_SOURCES = new Set([
  "website",
  "referral",
  "social_media",
  "email_campaign",
  "cold_call",
  "walk_in",
  "partner",
  "other",
]);
/** Allowed `product_category` values — intake / service detail (column name kept for API compatibility). */
const PRODUCT_CATEGORIES = new Set([
  "initial_consultation",
  "follow_up",
  "membership_or_program",
  "personal_training",
  "nutrition_or_supplements",
  "general_inquiry",
  "other",
]);

function normalizeStage(raw, fallback = "qualification_done") {
  const key = String(raw || "").trim().toLowerCase();
  return STAGE_ALIAS[key] || fallback;
}

function normalizeDatetime(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.replace("T", " ");
}

function normalizeEnum(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function applyScope(req) {
  const where = {
    is_deleted: false,
    tenant_id: tenantId(req),
  };
  if (!canSeeAllTeamRecords(req)) {
    where.OR = [
      { created_by: req.user.id },
      { owner_user_id: req.user.id }
    ];
  }
  return where;
}

function formatOpp(opp) {
  if (!opp) return null;
  return {
    ...opp,
    amount: opp.amount ? opp.amount.toString() : "0.00",
    final_amount: opp.final_amount ? opp.final_amount.toString() : null,
  };
}

/** Resolve owner emails without a Prisma relation (schema has no opportunities↔users relation). */
async function attachOwnerEmails(opps) {
  const list = Array.isArray(opps) ? opps : opps ? [opps] : [];
  const ids = [...new Set(list.map((o) => o.owner_user_id).filter((id) => id != null))];
  const emailById = new Map();
  if (ids.length) {
    const users = await prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });
    for (const u of users) emailById.set(u.id, u.email || null);
  }
  return list.map((opp) =>
    formatOpp({
      ...opp,
      owner_email: opp.owner_user_id != null ? emailById.get(opp.owner_user_id) || null : null,
    })
  );
}

async function loadOpportunityScoped(req, id) {
  const scope = applyScope(req);
  const where = {
    id: Number(id),
    ...scope
  };
  
  const opp = await prisma.opportunities.findFirst({ where });
  if (!opp) return null;
  const [formatted] = await attachOwnerEmails(opp);
  return formatted;
}

async function syncFollowupReminder(txOrPrisma, opportunity, userId) {
  const client = txOrPrisma || prisma;
  const followAt = opportunity.followup_at;

  if (!followAt) {
    if (opportunity.linked_reminder_id) {
      await client.reminders.update({
        where: { id: opportunity.linked_reminder_id },
        data: { is_done: true }
      });
    }
    return null;
  }

  const title = `Follow-up: ${String(opportunity.title || "Prospect").slice(0, 180)}`;
  const note = opportunity.visit_purpose || opportunity.notes || null;
  const ownerId = Number(opportunity.owner_user_id) || userId;
  const remindType = FOLLOWUP_TYPES.has(String(opportunity.followup_type || "").toLowerCase())
    ? String(opportunity.followup_type).toLowerCase()
    : "call";

  if (opportunity.linked_reminder_id) {
    await client.reminders.update({
      where: { id: opportunity.linked_reminder_id },
      data: {
        title,
        note,
        remind_at: new Date(followAt),
        assigned_to_user_id: ownerId,
        reminder_type: remindType,
        is_done: false
      }
    });
    return opportunity.linked_reminder_id;
  }

  const createdReminder = await client.reminders.create({
    data: {
      user_id: userId,
      title,
      note,
      remind_at: new Date(followAt),
      lead_id: opportunity.lead_id || null,
      assigned_to_user_id: ownerId,
      reminder_type: remindType,
      tenant_id: opportunity.tenant_id
    }
  });

  await client.opportunities.update({
    where: { id: opportunity.id },
    data: { linked_reminder_id: createdReminder.id }
  });

  return createdReminder.id;
}

async function insertOpportunityActivity(txOrPrisma, { opportunityId, tenantId, activityType, notes, metadata, userId }) {
  const client = txOrPrisma || prisma;
  await client.opportunity_activities.create({
    data: {
      opportunity_id: opportunityId,
      tenant_id: tenantId ?? null,
      activity_type: activityType,
      notes: notes ?? null,
      metadata: metadata || null,
      created_by: userId ?? null
    }
  });
}

/** Stages that should advance to consultation_done when a consultation is logged. */
function shouldAdvanceToConsultationDone(stage) {
  const s = normalizeStage(stage);
  return ["qualification_done", "open", "proposal", "negotiation"].includes(s);
}

router.get("/", async (req, res) => {
  try {
    const { stage, q, owner_user_id, expected_close_from, expected_close_to, include_breakdown, starred, view } =
      req.query;
      
    const scope = applyScope(req);
    const where = { ...scope };

    const viewNorm = String(view || "").trim().toLowerCase();
    if (viewNorm === "pipeline") {
      where.stage = {
        notIn: ['closed_won', 'closed_lost']
      };
    } else if (viewNorm === "won") {
      where.stage = 'closed_won';
    } else if (viewNorm === "lost") {
      where.stage = 'closed_lost';
    } else if (viewNorm && viewNorm !== "all") {
      return res.status(400).json({ success: false, message: "view must be pipeline, won, lost, or all" });
    }

    // Stage chip filters open pipeline only — never overwrite won/lost view scope
    if (stage && viewNorm !== "won" && viewNorm !== "lost") {
      if (!VALID_STAGE.has(String(stage).trim().toLowerCase())) {
        return res.status(400).json({ success: false, message: "Invalid stage" });
      }
      where.stage = normalizeStage(stage);
    }
    
    if (q && String(q).trim()) {
      const qCondition = {
        OR: [
          { title: { contains: String(q).trim() } },
          { company_name: { contains: String(q).trim() } }
        ]
      };
      if (where.AND) {
        where.AND.push(qCondition);
      } else {
        where.AND = [qCondition];
      }
    }
    
    if (owner_user_id && Number.isInteger(Number(owner_user_id))) {
      where.owner_user_id = Number(owner_user_id);
    }
    
    if (expected_close_from || expected_close_to) {
      // Won/lost tabs: date range is closed date (expected_close is often null after close)
      const dateField =
        viewNorm === "won" ? "closed_won_at" : viewNorm === "lost" ? "closed_lost_at" : "expected_close_date";
      where[dateField] = {};
      if (expected_close_from) {
        where[dateField].gte = new Date(expected_close_from);
      }
      if (expected_close_to) {
        const end = new Date(expected_close_to);
        if (viewNorm === "won" || viewNorm === "lost") {
          end.setHours(23, 59, 59, 999);
        }
        where[dateField].lte = end;
      }
    }
    
    if (String(starred || "") === "1") {
      where.is_starred = true;
    }

    let orderBy = { created_at: 'desc' };
    if (viewNorm === "won") {
      orderBy = [
        { closed_won_at: 'desc' },
        { id: 'desc' }
      ];
    } else if (viewNorm === "lost") {
      orderBy = [
        { closed_lost_at: 'desc' },
        { id: 'desc' }
      ];
    }

    const rows = await prisma.opportunities.findMany({
      where,
      orderBy,
    });

    const formattedRows = await attachOwnerEmails(rows);

    let stageBreakdown = null;
    if (String(include_breakdown || "") === "1") {
      // Full pipeline counts (all stages) so Closed Won / Closed Lost strip cards stay accurate
      const breakdownWhere = { ...scope };
      if (String(starred || "") === "1") breakdownWhere.is_starred = true;
      const buckets = await prisma.opportunities.groupBy({
        by: ["stage"],
        where: breakdownWhere,
        _count: { _all: true },
      });
      stageBreakdown = buckets
        .map((b) => ({
          key: String(b.stage),
          count: Number(b._count._all),
        }))
        .sort((a, b) => b.count - a.count);
    }

    res.json({ success: true, total: formattedRows.length, data: formattedRows, stageBreakdown });
  } catch (err) {
    console.error("GET /api/opportunities", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/revenue-summary", async (req, res) => {
  try {
    const {
      getRevenueSummary,
      parseYmd,
    } = require("../services/opportunityRevenueStats");
    const from = parseYmd(req.query.from || req.query.date_from);
    const to = parseYmd(req.query.to || req.query.date_to);
    const data = await getRevenueSummary(req, { from, to });
    res.json({ success: true, data });
  } catch (err) {
    console.error("GET /api/opportunities/revenue-summary", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/activities", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await loadOpportunityScoped(req, id);
    if (!row) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const activities = await prisma.$queryRaw`
      SELECT a.*, u.email AS created_by_email
      FROM opportunity_activities a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.opportunity_id = ${id}
      ORDER BY a.created_at DESC
    `;

    res.json({ success: true, data: activities });
  } catch (err) {
    console.error("GET /api/opportunities/:id/activities", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await loadOpportunityScoped(req, id);
    if (!row) return res.status(404).json({ success: false, message: "Opportunity not found" });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("GET /api/opportunities/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/consultation", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const notes = String(req.body?.notes || "").trim();
    if (!notes) return res.status(400).json({ success: false, message: "notes is required" });
    const atParam = normalizeDatetime(req.body?.consultation_at);

    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Cannot log consultation on a closed opportunity" });
    }

    let nextStage = existing.stage;
    if (shouldAdvanceToConsultationDone(existing.stage)) {
      nextStage = "consultation_done";
    }

    await prisma.$transaction(async (tx) => {
      await tx.opportunities.update({
        where: { id },
        data: {
          consultation_at: atParam ? new Date(atParam) : new Date(),
          consultation_notes: notes,
          stage: nextStage,
          updated_at: new Date()
        }
      });
      await insertOpportunityActivity(tx, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "consultation",
        notes,
        metadata: { consultation_at: atParam || null, stage_after: nextStage },
        userId: req.user.id
      });
    });

    const row = await loadOpportunityScoped(req, id);
    emitOppChanges(req, "consultation", { id });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/opportunities/:id/consultation", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/close-won", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const finalAmount = Number(req.body?.final_amount);
    if (!Number.isFinite(finalAmount) || finalAmount < 0) {
      return res.status(400).json({ success: false, message: "final_amount is required and must be a non-negative number" });
    }
    const closeNotes = req.body?.notes != null ? String(req.body.notes) : null;
    const createClient = req.body?.create_client === true || req.body?.create_client === 1;
    const linkClientId = req.body?.client_id ? String(req.body.client_id).trim() : null;

    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Opportunity is already closed" });
    }

    let clientPayload = null;
    await prisma.$transaction(async (tx) => {
      await tx.opportunities.update({
        where: { id },
        data: {
          stage: 'closed_won',
          closed_won_at: new Date(),
          final_amount: new Prisma.Decimal(finalAmount),
          updated_at: new Date()
        }
      });

      if (linkClientId) {
        const link = await linkExistingClient(tx, id, linkClientId);
        if (!link.ok) {
          throw new Error(link.message);
        }
        clientPayload = link.client;
      } else if (createClient) {
        const created = await createClientFromOpportunity(tx, existing, req.user.id);
        if (created?.client_id) {
          await tx.opportunities.update({
            where: { id },
            data: { client_id: created.client_id }
          });
          clientPayload = created.row;
        }
      }

      await insertOpportunityActivity(tx, {
        opportunityId: id,
        tenantId: tenantId(req),
        activityType: "close_won",
        notes: closeNotes,
        metadata: {
          from_stage: existing.stage,
          final_amount: finalAmount,
          forecast_amount: Number(existing.amount) || 0,
          client_id: clientPayload?.client_id || linkClientId || null
        },
        userId: req.user.id
      });
    });

    const row = await loadOpportunityScoped(req, id);
    emitOppChanges(req, "close_won", { id });
    if (clientPayload) emitFitnessChanged();
    res.json({ success: true, data: row, client: clientPayload });
  } catch (err) {
    console.error("POST /api/opportunities/:id/close-won", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/close-lost", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const lossReason = req.body?.loss_reason != null ? String(req.body.loss_reason).slice(0, 255) : null;

    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Opportunity is already closed" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.opportunities.update({
        where: { id },
        data: {
          stage: 'closed_lost',
          closed_lost_at: new Date(),
          loss_reason: lossReason,
          updated_at: new Date()
        }
      });
      await insertOpportunityActivity(tx, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "close_lost",
        notes: lossReason,
        metadata: { from_stage: existing.stage },
        userId: req.user.id
      });
    });

    const row = await loadOpportunityScoped(req, id);
    emitOppChanges(req, "close_lost", { id });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/opportunities/:id/close-lost", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const stageRaw = String(req.body?.stage || "qualification_done").trim().toLowerCase();
    if (!VALID_STAGE.has(stageRaw)) {
      return res.status(400).json({ success: false, message: "Invalid stage" });
    }
    const stage = normalizeStage(stageRaw);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "title is required" });

    const productCategory = req.body?.product_category ? normalizeEnum(req.body.product_category) : null;
    if (productCategory && !PRODUCT_CATEGORIES.has(productCategory)) {
      return res.status(400).json({ success: false, message: "Invalid product_category" });
    }
    const followupType = req.body?.followup_type ? normalizeEnum(req.body.followup_type) : null;
    if (followupType && !FOLLOWUP_TYPES.has(followupType)) {
      return res.status(400).json({ success: false, message: "Invalid followup_type" });
    }
    const opportunityType = req.body?.opportunity_type ? normalizeEnum(req.body.opportunity_type) : null;
    if (opportunityType && !OPPORTUNITY_TYPES.has(opportunityType)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity_type" });
    }
    const leadSource = req.body?.lead_source ? normalizeEnum(req.body.lead_source) : null;
    if (leadSource && !LEAD_SOURCES.has(leadSource)) {
      return res.status(400).json({ success: false, message: "Invalid lead_source" });
    }

    const ownerId = Number(req.body?.owner_user_id) || req.user.id;
    const phone = req.body?.phone ? String(req.body.phone).trim().slice(0, 20) : null;
    const visitPurpose = req.body?.visit_purpose ? String(req.body.visit_purpose).trim() : null;
    const clientIdLink = req.body?.client_id ? String(req.body.client_id).trim().slice(0, 20) : null;
    const followupAt = normalizeDatetime(req.body?.followup_at);

    const createdOpp = await prisma.opportunities.create({
      data: {
        tenant_id: tenantId(req),
        title,
        lead_id: Number(req.body?.lead_id) || null,
        contact_id: Number(req.body?.contact_id) || null,
        client_id: clientIdLink || null,
        phone,
        visit_purpose: visitPurpose,
        company_name: req.body?.company_name ? String(req.body.company_name) : null,
        amount: new Prisma.Decimal(Number(req.body?.amount) || 0),
        currency: String(req.body?.currency || "INR").toUpperCase(),
        stage,
        expected_close_date: req.body?.expected_close_date ? new Date(req.body.expected_close_date) : null,
        owner_user_id: ownerId || null,
        created_by: req.user.id,
        notes: req.body?.notes ? String(req.body.notes) : null,
        product_category: productCategory ? productCategory : null,
        quantity: Number(req.body?.quantity) || 0,
        external_quotation_url: req.body?.external_quotation_url ? String(req.body.external_quotation_url).slice(0, 500) : null,
        followup_at: followupAt ? new Date(followupAt) : null,
        followup_type: followupType ? followupType : null,
        opportunity_type: opportunityType ? opportunityType : null,
        lead_source: leadSource ? leadSource : null,
        team: req.body?.team ? String(req.body.team).slice(0, 160) : null,
        comments_history: req.body?.comments_history ? String(req.body.comments_history) : null
      }
    });

    const oppId = createdOpp.id;
    let row = await loadOpportunityScoped(req, oppId);
    if (followupAt && row) {
      await syncFollowupReminder(prisma, row, req.user.id);
      row = await loadOpportunityScoped(req, oppId);
      emitRemindersChanged({ reason: "opportunities" });
    }
    emitOppChanges(req, "create", { id: oppId });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/opportunities", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const stageRaw = req.body?.stage != null ? String(req.body.stage).trim().toLowerCase() : existing.stage;
    if (!VALID_STAGE.has(stageRaw)) {
      return res.status(400).json({ success: false, message: "Invalid stage" });
    }
    const stage = normalizeStage(stageRaw, normalizeStage(existing.stage));

    const nextProductCategory = req.body?.product_category != null ? normalizeEnum(req.body.product_category) : null;
    if (req.body?.product_category != null && nextProductCategory && !PRODUCT_CATEGORIES.has(nextProductCategory)) {
      return res.status(400).json({ success: false, message: "Invalid product_category" });
    }
    const nextFollowupType = req.body?.followup_type != null ? normalizeEnum(req.body.followup_type) : null;
    if (req.body?.followup_type != null && nextFollowupType && !FOLLOWUP_TYPES.has(nextFollowupType)) {
      return res.status(400).json({ success: false, message: "Invalid followup_type" });
    }
    const nextOpportunityType = req.body?.opportunity_type != null ? normalizeEnum(req.body.opportunity_type) : null;
    if (req.body?.opportunity_type != null && nextOpportunityType && !OPPORTUNITY_TYPES.has(nextOpportunityType)) {
      return res.status(400).json({ success: false, message: "Invalid opportunity_type" });
    }
    const nextLeadSource = req.body?.lead_source != null ? normalizeEnum(req.body.lead_source) : null;
    if (req.body?.lead_source != null && nextLeadSource && !LEAD_SOURCES.has(nextLeadSource)) {
      return res.status(400).json({ success: false, message: "Invalid lead_source" });
    }

    const nextFollowupAt =
      req.body?.followup_at != null ? normalizeDatetime(req.body.followup_at) : existing.followup_at;

    await prisma.opportunities.update({
      where: { id },
      data: {
        title: req.body?.title != null ? String(req.body.title).trim() : undefined,
        company_name: req.body?.company_name !== undefined ? (req.body.company_name ? String(req.body.company_name) : null) : undefined,
        amount: req.body?.amount !== undefined ? new Prisma.Decimal(Number(req.body.amount) || 0) : undefined,
        currency: req.body?.currency !== undefined ? String(req.body.currency).toUpperCase() : undefined,
        stage,
        expected_close_date: req.body?.expected_close_date !== undefined ? (req.body.expected_close_date ? new Date(req.body.expected_close_date) : null) : undefined,
        owner_user_id: req.body?.owner_user_id !== undefined ? (Number(req.body.owner_user_id) || null) : undefined,
        notes: req.body?.notes !== undefined ? String(req.body.notes || "") : undefined,
        product_category: req.body?.product_category !== undefined ? (nextProductCategory || null) : undefined,
        quantity: req.body?.quantity !== undefined ? (Number(req.body.quantity) || 0) : undefined,
        external_quotation_url: req.body?.external_quotation_url !== undefined ? (req.body.external_quotation_url ? String(req.body.external_quotation_url).slice(0, 500) : null) : undefined,
        followup_at: nextFollowupAt !== undefined ? (nextFollowupAt ? new Date(nextFollowupAt) : null) : undefined,
        followup_type: req.body?.followup_type !== undefined ? (nextFollowupType || null) : undefined,
        opportunity_type: req.body?.opportunity_type !== undefined ? (nextOpportunityType || null) : undefined,
        lead_source: req.body?.lead_source !== undefined ? (nextLeadSource || null) : undefined,
        team: req.body?.team !== undefined ? (req.body.team ? String(req.body.team).slice(0, 160) : null) : undefined,
        comments_history: req.body?.comments_history !== undefined ? String(req.body.comments_history || "") : undefined,
        lead_id: req.body?.lead_id !== undefined ? (Number(req.body.lead_id) || null) : undefined,
        contact_id: req.body?.contact_id !== undefined ? (Number(req.body.contact_id) || null) : undefined,
        client_id: req.body?.client_id !== undefined ? (req.body.client_id ? String(req.body.client_id).trim().slice(0, 20) : null) : undefined,
        phone: req.body?.phone !== undefined ? (req.body.phone ? String(req.body.phone).trim().slice(0, 20) : null) : undefined,
        visit_purpose: req.body?.visit_purpose !== undefined ? (req.body.visit_purpose ? String(req.body.visit_purpose).trim() : null) : undefined,
        updated_at: new Date()
      }
    });

    let row = await loadOpportunityScoped(req, id);
    if (row && (req.body?.followup_at !== undefined || req.body?.followup_type !== undefined)) {
      await syncFollowupReminder(prisma, row, req.user.id);
      row = await loadOpportunityScoped(req, id);
      emitRemindersChanged({ reason: "opportunities" });
    }
    emitOppChanges(req, "update", { id });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PUT /api/opportunities/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

function isClosedStageValue(stage) {
  const s = String(stage || "").toLowerCase();
  return s === "closed_won" || s === "closed_lost";
}

/** Prisma update data when moving stages — clears close metadata on reopen. */
function stageTransitionData(fromStage, toStage) {
  const data = {
    stage: toStage,
    updated_at: new Date(),
  };
  if (isClosedStageValue(fromStage) && !isClosedStageValue(toStage)) {
    data.closed_won_at = null;
    data.closed_lost_at = null;
    data.loss_reason = null;
    // Keep final_amount as historical; reopen sends deal back to open pipeline
  }
  if (toStage === "closed_won" || toStage === "closed_lost") {
    // Direct stage→closed without close-won/close-lost endpoints is allowed for reopen→reclose path
    // but prefer dedicated close endpoints from UI.
  }
  return data;
}

async function applyStageChange(req, id, normalizedStage) {
  const existing = await loadOpportunityScoped(req, id);
  if (!existing) {
    const err = new Error("Opportunity not found");
    err.status = 404;
    throw err;
  }

  // Closing must go through /close-won or /close-lost (amount / reason)
  if (
    !isClosedStageValue(existing.stage) &&
    isClosedStageValue(normalizedStage)
  ) {
    const err = new Error(
      normalizedStage === "closed_won"
        ? "Use Mark Won to close as Closed Won (booked amount required)"
        : "Use Mark Lost to close as Closed Lost"
    );
    err.status = 400;
    throw err;
  }

  const data = stageTransitionData(existing.stage, normalizedStage);
  await prisma.opportunities.update({
    where: { id },
    data,
  });

  if (existing.stage !== normalizedStage) {
    await insertOpportunityActivity(prisma, {
      opportunityId: id,
      tenantId: req.user?.tenantId ?? null,
      activityType: "stage_change",
      notes: isClosedStageValue(existing.stage) && !isClosedStageValue(normalizedStage)
        ? "Reopened to pipeline"
        : null,
      metadata: {
        from: existing.stage,
        to: normalizedStage,
        reopened: isClosedStageValue(existing.stage) && !isClosedStageValue(normalizedStage),
      },
      userId: req.user.id,
    });
  }

  emitOppChanges(req, "stage", { id, stage: normalizedStage });
  const [updated] = await attachOwnerEmails(
    await prisma.opportunities.findFirst({ where: { id } })
  );
  return updated;
}

router.patch("/:id/stage", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!VALID_STAGE.has(stage)) return res.status(400).json({ success: false, message: "Invalid stage" });
    const normalizedStage = normalizeStage(stage);
    const data = await applyStageChange(req, id, normalizedStage);
    res.json({ success: true, data });
  } catch (err) {
    console.error("PATCH /api/opportunities/:id/stage", err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put("/:id/stage", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!VALID_STAGE.has(stage)) return res.status(400).json({ success: false, message: "Invalid stage" });
    const normalizedStage = normalizeStage(stage);
    const data = await applyStageChange(req, id, normalizedStage);
    res.json({ success: true, data });
  } catch (err) {
    console.error("PUT /api/opportunities/:id/stage", err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/star", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const starred = req.body?.starred ? true : false;
    
    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });

    await prisma.opportunities.update({
      where: { id },
      data: {
        is_starred: starred,
        updated_at: new Date()
      }
    });

    emitOppChanges(req, "star", { id, starred });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/opportunities/:id/star", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id/star", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const starred = req.body?.starred ? true : false;
    
    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });

    await prisma.opportunities.update({
      where: { id },
      data: {
        is_starred: starred,
        updated_at: new Date()
      }
    });

    emitOppChanges(req, "star", { id, starred });
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/opportunities/:id/star", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    
    const existing = await loadOpportunityScoped(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });

    await prisma.opportunities.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date()
      }
    });

    emitOppChanges(req, "delete", { id });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/opportunities/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
