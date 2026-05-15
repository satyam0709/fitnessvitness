const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { emitAdminChanged, emitCalendarChanged, emitOpportunitiesChanged } = require("../realtime/meetingsRealtime");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");

const router = express.Router();
router.use(verifyToken);

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

function applyScope(req, alias = "o") {
  const params = [];
  const clauses = [`${alias}.is_deleted = 0`, `${alias}.tenant_id = ?`];
  params.push(req.user?.tenantId || null);
  if (!canSeeAllTeamRecords(req)) {
    clauses.push(`(${alias}.created_by = ? OR ${alias}.owner_user_id = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: clauses.join(" AND "), params };
}

async function insertOpportunityActivity(executor, { opportunityId, tenantId, activityType, notes, metadata, userId }) {
  const metaJson = metadata != null ? JSON.stringify(metadata) : null;
  await executor.execute(
    `INSERT INTO opportunity_activities (opportunity_id, tenant_id, activity_type, notes, metadata, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [opportunityId, tenantId ?? null, activityType, notes ?? null, metaJson, userId ?? null]
  );
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
    const scope = applyScope(req, "o");
    const where = [scope.where];
    const params = [...scope.params];

    const viewNorm = String(view || "").trim().toLowerCase();
    if (viewNorm === "pipeline") {
      where.push("o.stage NOT IN ('closed_won','closed_lost')");
    } else if (viewNorm === "won") {
      where.push("o.stage = 'closed_won'");
    } else if (viewNorm === "lost") {
      where.push("o.stage = 'closed_lost'");
    } else if (viewNorm && viewNorm !== "all") {
      return res.status(400).json({ success: false, message: "view must be pipeline, won, lost, or all" });
    }

    if (stage) {
      if (!VALID_STAGE.has(String(stage).trim().toLowerCase())) {
        return res.status(400).json({ success: false, message: "Invalid stage" });
      }
      const normalizedStage = normalizeStage(stage);
      where.push("o.stage = ?");
      params.push(normalizedStage);
    }
    if (q && String(q).trim()) {
      where.push("(o.title LIKE ? OR o.company_name LIKE ?)");
      const like = `%${String(q).trim()}%`;
      params.push(like, like);
    }
    if (owner_user_id && Number.isInteger(Number(owner_user_id))) {
      where.push("o.owner_user_id = ?");
      params.push(Number(owner_user_id));
    }
    if (expected_close_from) {
      where.push("o.expected_close_date >= ?");
      params.push(String(expected_close_from).slice(0, 10));
    }
    if (expected_close_to) {
      where.push("o.expected_close_date <= ?");
      params.push(String(expected_close_to).slice(0, 10));
    }
    if (String(starred || "") === "1") {
      where.push("o.is_starred = 1");
    }

    let orderSql = "ORDER BY o.created_at DESC";
    if (viewNorm === "won") {
      orderSql = "ORDER BY o.closed_won_at IS NULL, o.closed_won_at DESC, o.id DESC";
    } else if (viewNorm === "lost") {
      orderSql = "ORDER BY o.closed_lost_at IS NULL, o.closed_lost_at DESC, o.id DESC";
    }

    const [rows] = await pool.execute(
      `SELECT o.*, u.email AS owner_email
       FROM opportunities o
       LEFT JOIN users u ON u.id = o.owner_user_id
       WHERE ${where.join(" AND ")}
       ${orderSql}`,
      params
    );

    let stageBreakdown = null;
    if (String(include_breakdown || "") === "1") {
      const [buckets] = await pool.execute(
        `SELECT o.stage AS bucket, COUNT(*) AS count
         FROM opportunities o
         WHERE ${where.join(" AND ")}
         GROUP BY o.stage
         ORDER BY count DESC`,
        params
      );
      stageBreakdown = buckets.map((b) => ({ key: String(b.bucket), count: Number(b.count) || 0 }));
    }
    res.json({ success: true, total: rows.length, data: rows, stageBreakdown });
  } catch (err) {
    console.error("GET /api/opportunities", err);
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

    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.* FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Cannot log consultation on a closed opportunity" });
    }

    let nextStage = existing.stage;
    if (shouldAdvanceToConsultationDone(existing.stage)) {
      nextStage = "consultation_done";
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE opportunities SET consultation_at = COALESCE(?, NOW()), consultation_notes = ?, stage = ?, updated_at = NOW() WHERE id = ?`,
        [atParam, notes, nextStage, id]
      );
      await insertOpportunityActivity(conn, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "consultation",
        notes,
        metadata: { consultation_at: atParam || null, stage_after: nextStage },
        userId: req.user.id,
      });
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      conn.release();
    }

    const [[row]] = await pool.execute("SELECT o.*, u.email AS owner_email FROM opportunities o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.id = ?", [id]);
    emitAdminChanged({ scope: "opportunities", action: "consultation", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "consultation", id, tenantId: req.user?.tenantId || null });
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

    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.* FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Opportunity is already closed" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE opportunities SET stage = 'closed_won', closed_won_at = NOW(), final_amount = ?, updated_at = NOW() WHERE id = ?`,
        [finalAmount, id]
      );
      await insertOpportunityActivity(conn, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "close_won",
        notes: closeNotes,
        metadata: {
          from_stage: existing.stage,
          final_amount: finalAmount,
          forecast_amount: Number(existing.amount) || 0,
        },
        userId: req.user.id,
      });
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      conn.release();
    }

    const [[row]] = await pool.execute("SELECT o.*, u.email AS owner_email FROM opportunities o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.id = ?", [id]);
    emitAdminChanged({ scope: "opportunities", action: "close_won", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "close_won", id, tenantId: req.user?.tenantId || null });
    res.json({ success: true, data: row });
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

    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.* FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage === "closed_won" || existing.stage === "closed_lost") {
      return res.status(400).json({ success: false, message: "Opportunity is already closed" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE opportunities SET stage = 'closed_lost', closed_lost_at = NOW(), loss_reason = ?, updated_at = NOW() WHERE id = ?`,
        [lossReason, id]
      );
      await insertOpportunityActivity(conn, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "close_lost",
        notes: lossReason,
        metadata: { from_stage: existing.stage },
        userId: req.user.id,
      });
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      conn.release();
    }

    const [[row]] = await pool.execute("SELECT o.*, u.email AS owner_email FROM opportunities o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.id = ?", [id]);
    emitAdminChanged({ scope: "opportunities", action: "close_lost", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "close_lost", id, tenantId: req.user?.tenantId || null });
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
    const [r] = await pool.execute(
      `INSERT INTO opportunities
       (tenant_id, title, lead_id, contact_id, company_name, amount, currency, stage, expected_close_date, owner_user_id, created_by, notes,
        product_category, quantity, external_quotation_url, followup_at, followup_type, opportunity_type, lead_source, team, comments_history)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.tenantId || null,
        title,
        Number(req.body?.lead_id) || null,
        Number(req.body?.contact_id) || null,
        req.body?.company_name ? String(req.body.company_name) : null,
        Number(req.body?.amount) || 0,
        String(req.body?.currency || "INR").toUpperCase(),
        stage,
        req.body?.expected_close_date || null,
        ownerId || null,
        req.user.id,
        req.body?.notes ? String(req.body.notes) : null,
        productCategory ? productCategory : null,
        Number(req.body?.quantity) || 0,
        req.body?.external_quotation_url ? String(req.body.external_quotation_url).slice(0, 500) : null,
        normalizeDatetime(req.body?.followup_at),
        followupType ? followupType : null,
        opportunityType ? opportunityType : null,
        leadSource ? leadSource : null,
        req.body?.team ? String(req.body.team).slice(0, 160) : null,
        req.body?.comments_history ? String(req.body.comments_history) : null,
      ]
    );

    const [[row]] = await pool.execute("SELECT * FROM opportunities WHERE id = ?", [r.insertId]);
    emitAdminChanged({ scope: "opportunities", action: "create", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "create", tenantId: req.user?.tenantId || null });
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
    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.* FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
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

    await pool.execute(
      `UPDATE opportunities
       SET title = ?, company_name = ?, amount = ?, currency = ?, stage = ?, expected_close_date = ?,
           owner_user_id = ?, notes = ?, product_category = ?, quantity = ?, external_quotation_url = ?,
           followup_at = ?, followup_type = ?, opportunity_type = ?, lead_source = ?, team = ?, comments_history = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        req.body?.title != null ? String(req.body.title).trim() : existing.title,
        req.body?.company_name != null ? String(req.body.company_name) : existing.company_name,
        req.body?.amount != null ? Number(req.body.amount) || 0 : Number(existing.amount) || 0,
        req.body?.currency != null ? String(req.body.currency).toUpperCase() : existing.currency,
        stage,
        req.body?.expected_close_date != null ? req.body.expected_close_date : existing.expected_close_date,
        req.body?.owner_user_id != null ? Number(req.body.owner_user_id) || null : existing.owner_user_id,
        req.body?.notes != null ? String(req.body.notes || "") : existing.notes,
        req.body?.product_category != null
          ? (nextProductCategory || null)
          : existing.product_category,
        req.body?.quantity != null ? Number(req.body.quantity) || 0 : Number(existing.quantity) || 0,
        req.body?.external_quotation_url != null
          ? String(req.body.external_quotation_url || "").slice(0, 500) || null
          : existing.external_quotation_url,
        req.body?.followup_at != null ? normalizeDatetime(req.body.followup_at) : existing.followup_at,
        req.body?.followup_type != null ? (nextFollowupType || null) : existing.followup_type,
        req.body?.opportunity_type != null ? (nextOpportunityType || null) : existing.opportunity_type,
        req.body?.lead_source != null ? (nextLeadSource || null) : existing.lead_source,
        req.body?.team != null ? String(req.body.team || "").slice(0, 160) || null : existing.team,
        req.body?.comments_history != null ? String(req.body.comments_history || "") : existing.comments_history,
        id,
      ]
    );
    const [[row]] = await pool.execute("SELECT * FROM opportunities WHERE id = ?", [id]);
    emitAdminChanged({ scope: "opportunities", action: "update", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "update", id, tenantId: req.user?.tenantId || null });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PUT /api/opportunities/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/stage", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!VALID_STAGE.has(stage)) return res.status(400).json({ success: false, message: "Invalid stage" });
    const normalizedStage = normalizeStage(stage);
    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.stage FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    const [r] = await pool.execute(
      `UPDATE opportunities o SET o.stage = ?, o.updated_at = NOW() WHERE o.id = ? AND ${scope.where}`,
      [normalizedStage, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage !== normalizedStage) {
      await insertOpportunityActivity(pool, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "stage_change",
        notes: null,
        metadata: { from: existing.stage, to: normalizedStage },
        userId: req.user.id,
      });
    }
    emitAdminChanged({ scope: "opportunities", action: "stage", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "stage", id, stage: normalizedStage, tenantId: req.user?.tenantId || null });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/opportunities/:id/stage", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id/stage", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!VALID_STAGE.has(stage)) return res.status(400).json({ success: false, message: "Invalid stage" });
    const normalizedStage = normalizeStage(stage);
    const scope = applyScope(req, "o");
    const [[existing]] = await pool.execute(
      `SELECT o.stage FROM opportunities o WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Opportunity not found" });
    const [r] = await pool.execute(
      `UPDATE opportunities o SET o.stage = ?, o.updated_at = NOW() WHERE o.id = ? AND ${scope.where}`,
      [normalizedStage, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (existing.stage !== normalizedStage) {
      await insertOpportunityActivity(pool, {
        opportunityId: id,
        tenantId: req.user?.tenantId ?? null,
        activityType: "stage_change",
        notes: null,
        metadata: { from: existing.stage, to: normalizedStage },
        userId: req.user.id,
      });
    }
    emitAdminChanged({ scope: "opportunities", action: "stage", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "stage", id, stage: normalizedStage, tenantId: req.user?.tenantId || null });
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/opportunities/:id/stage", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/star", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const scope = applyScope(req, "o");
    const starred = req.body?.starred ? 1 : 0;
    const [r] = await pool.execute(
      `UPDATE opportunities o SET o.is_starred = ?, o.updated_at = NOW() WHERE o.id = ? AND ${scope.where}`,
      [starred, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Opportunity not found" });
    emitAdminChanged({ scope: "opportunities", action: "star", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "star", id, starred, tenantId: req.user?.tenantId || null });
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
    const scope = applyScope(req, "o");
    const starred = req.body?.starred ? 1 : 0;
    const [r] = await pool.execute(
      `UPDATE opportunities o SET o.is_starred = ?, o.updated_at = NOW() WHERE o.id = ? AND ${scope.where}`,
      [starred, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Opportunity not found" });
    emitAdminChanged({ scope: "opportunities", action: "star", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "star", id, starred, tenantId: req.user?.tenantId || null });
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
    const scope = applyScope(req, "o");
    const [r] = await pool.execute(
      `UPDATE opportunities o
       SET o.is_deleted = 1, o.deleted_at = NOW(), o.updated_at = NOW()
       WHERE o.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Opportunity not found" });
    emitAdminChanged({ scope: "opportunities", action: "delete", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "opportunities", tenantId: req.user?.tenantId || null });
    emitOpportunitiesChanged({ action: "delete", id, tenantId: req.user?.tenantId || null });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/opportunities/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
