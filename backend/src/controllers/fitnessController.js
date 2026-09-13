const prisma = require("../config/prisma");
const {
  emitCalendarChanged,
  emitFitnessChanged,
  emitTasksChanged,
} = require("../realtime/meetingsRealtime");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const {
  generateClientId,
  computeClientFields,
  sortClientRows,
} = require("../services/fitnessComputedFields");
const { body, validationResult } = require("express-validator");
const {
  toPrismaDate,
  toYmd,
  numOrNull,
  serializeFitnessRow,
  serializeFitnessRows,
  toPrismaSource,
  toPrismaPlan,
  toPrismaProgress,
  toPrismaConsult,
  toPrismaTaskStatus,
  toPrismaPayMode,
} = require("../utils/fitnessPrismaMaps");

// ─────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────
const VALID_ENUMS = {
  status: ['Active', 'Hold', 'Inactive'],
  progress: ['Very Good', 'Good', 'Neutral', 'Poor', 'Very Poor'],
  source: ['BNI', 'Instagram', 'Facebook', 'Referral - Existing Client', 'Friend / Family', 'Walk-in', 'Online / Website', 'Corporate / Company'],
  plan_type: ['1 Month Plan', '3 Month Plan', '6 Month Plan', '1 Year Plan'],
  consult_type: ['Onboarding', 'Diet Review', 'Check-in', 'Follow-up', 'Other'],
  task_priority: ['High', 'Medium', 'Low'],
  task_status: ['Open', 'In Progress', 'Done', 'Carried Forward', 'Overdue'],
  transaction_type: ['Membership', 'Supplement', 'Other'],
  pay_mode: ['GPay', 'Cash', 'Online Transfer', 'Cheque', 'UPI', 'NEFT'],
};

function validateRequired(obj, fields) {
  const missing = fields.filter(f => !obj[f] && obj[f] !== 0);
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  return null;
}

function validateEnum(value, allowed, fieldName) {
  if (value && !allowed.includes(value)) {
    return `Invalid ${fieldName}. Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

function validateNumber(value, fieldName, min = null, max = null) {
  if (value !== undefined && value !== null && value !== '') {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number`;
    if (min !== null && num < min) return `${fieldName} must be at least ${min}`;
    if (max !== null && num > max) return `${fieldName} must be at most ${max}`;
  }
  return null;
}

function validateDate(value, fieldName) {
  if (value && isNaN(Date.parse(value))) return `${fieldName} must be a valid date`;
  return null;
}

function validateStringLength(value, fieldName, maxLen) {
  if (value && typeof value === 'string' && value.length > maxLen) {
    return `${fieldName} must be at most ${maxLen} characters`;
  }
  return null;
}

function validatePositiveInt(value, fieldName) {
  if (value !== undefined && value !== null && value !== '') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return `${fieldName} must be a positive integer`;
  }
  return null;
}

/** Digits-only phone for dedup and storage. */
function normalizePhoneDigits(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).replace(/\D/g, "");
  return s.length ? s : null;
}

function sendValidationError(res, message) {
  return res.status(400).json({ success: false, message });
}

/** Coerce empty form strings to null for optional DB columns. */
function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function optionalNumber(value) {
  const v = emptyToNull(value);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateOnly(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function emitFitnessAndDueTaskChanged(reason = "client_due") {
  emitFitnessChanged();
  emitTasksChanged({ reason });
  emitCalendarChanged({ reason });
}

function addDaysYmd(ymd, days) {
  const d = toPrismaDate(ymd);
  if (!d) return null;
  d.setDate(d.getDate() + Number(days) || 0);
  return d;
}

/** Set or clear next_due_date from task completion + follow_up_freq_days. */
async function syncClientNextDueFromCompleted(clientId, completedOn) {
  if (!clientId) return;
  const completedDate = normalizeDateOnly(completedOn);
  if (completedDate) {
    const client = await prisma.fitness_clients.findUnique({
      where: { client_id: clientId },
      select: { follow_up_freq_days: true },
    });
    if (!client) return;
    const days = Number(client.follow_up_freq_days) || 14;
    await prisma.fitness_clients.update({
      where: { client_id: clientId },
      data: {
        next_due_date: addDaysYmd(completedDate, days),
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.fitness_clients.update({
      where: { client_id: clientId },
      data: { next_due_date: null, updated_at: new Date() },
    });
  }
}

async function syncClientDueTask(clientRow, actorUserId) {
  if (!clientRow?.id) return false;
  try {
    const clientDbId = Number(clientRow.id);
    const dueDate = normalizeDateOnly(clientRow.next_due_date);
    const isActive = String(clientRow.status || "Active") === "Active";

    const existing = await prisma.tasks.findFirst({
      where: {
        client_id: clientDbId,
        task_category: "client_due",
        task_type: "client_due",
      },
      orderBy: { id: "desc" },
      select: { id: true, assigned_to: true },
    });
    const taskId = existing?.id;

    if (!dueDate || !isActive) {
      if (!taskId) return false;
      await prisma.tasks.update({
        where: { id: taskId },
        data: { status: "done", updated_at: new Date() },
      });
      return true;
    }

    const title = `Follow-up due: ${clientRow.full_name || clientRow.client_id}`;
    const description = `Client ${clientRow.client_id} needs attention on ${dueDate}.`;
    const due = toPrismaDate(dueDate);

    if (taskId) {
      const data = {
        title,
        due_date: due,
        status: "new",
        description,
        priority: "medium",
        updated_at: new Date(),
      };
      if (actorUserId && !existing.assigned_to) {
        data.assigned_to = Number(actorUserId);
      }
      await prisma.tasks.update({ where: { id: taskId }, data });
      return true;
    }

    const createdBy = Number(actorUserId);
    if (!Number.isFinite(createdBy)) return false;

    await prisma.tasks.create({
      data: {
        title,
        client_id: clientDbId,
        created_by: createdBy,
        due_date: due,
        status: "new",
        description,
        assigned_to: createdBy,
        priority: "medium",
        task_category: "client_due",
        task_type: "client_due",
        frequency: "once",
      },
    });
    return true;
  } catch {
    return false;
  }
}

// Helper to extract field-level errors from express-validator
function extractValidationErrors(req) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const fieldErrors = {};
  for (const err of errors.array()) {
    fieldErrors[err.path] = err.msg;
  }
  return fieldErrors;
}

// ─────────────────────────────────────────────────────────────────
// VALIDATION RULES
// ─────────────────────────────────────────────────────────────────
const createClientValidation = [
  body("full_name").trim().notEmpty().withMessage("Full name is required"),
  body("phone").trim().notEmpty().withMessage("Phone is required"),
  body("plan_type").trim().notEmpty().withMessage("Plan type is required"),
  body("plan_start_date").notEmpty().withMessage("Plan start date is required").isISO8601().withMessage("Plan start date must be a valid date"),
];

const createConsultationValidation = [
  body("consult_date").notEmpty().withMessage("Consultation date is required").isISO8601().withMessage("Consultation date must be a valid date"),
  body("consult_type").trim().notEmpty().withMessage("Consultation type is required"),
];

// ─────────────────────────────────────────────────────────────────
// FITNESSSETTINGS
// ─────────────────────────────────────────────────────────────────
async function getFitnessSettings(_req, res) {
  try {
    const rows = await prisma.fitness_settings.findMany();
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] =
        typeof row.setting_value === "string"
          ? JSON.parse(row.setting_value)
          : row.setting_value;
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function upsertFitnessSetting(key, value) {
  await prisma.fitness_settings.upsert({
    where: { setting_key: key },
    create: { setting_key: key, setting_value: value },
    update: { setting_value: value, updated_at: new Date() },
  });
}

async function updateFitnessSettings(req, res) {
  try {
    const settings = req.body;
    if (typeof settings !== "object" || settings === null) {
      return res.status(400).json({ success: false, message: "Invalid settings object" });
    }

    if (settings.key && settings.value !== undefined) {
      await upsertFitnessSetting(settings.key, settings.value);
    } else {
      for (const [key, value] of Object.entries(settings)) {
        await upsertFitnessSetting(key, value);
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// CLIENTS — list filters / sort
// ─────────────────────────────────────────────────────────────────

const CLIENT_LIST_SORTS = new Set([
  "next_due",
  "next_due_desc",
  "plan_expiry",
  "plan_expiry_desc",
  "name",
  "name_desc",
  "tier",
  "tier_desc",
  "created",
  "created_asc",
  "id_asc",
  "id_desc",
  "risk_asc",
  "risk_desc",
  "status_asc",
  "status_desc",
  "progress_asc",
  "progress_desc",
  "follow_up_asc",
  "follow_up_desc",
  "days_asc",
  "days_desc",
]);

function parseClientListYmd(raw) {
  const s = String(raw || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildClientListWhere(q) {
  const statusRaw = String(q.status || "").trim();
  const isOverdueView = statusRaw === "Overdue";
  const isHighRiskView = statusRaw === "High Risk";
  const isLowRiskView = statusRaw === "Low Risk";
  const isNextDueView = statusRaw === "Next Due";
  const isSpecialView =
    isOverdueView || isHighRiskView || isLowRiskView || isNextDueView;

  const where = {};
  const computed = { overdue: false, highRisk: false, lowRisk: false, priority: null };
  const and = [];

  if (statusRaw && !isSpecialView && VALID_ENUMS.status.includes(statusRaw)) {
    where.status = statusRaw;
  }

  if (isOverdueView) {
    where.status = "Active";
    computed.overdue = true;
  } else if (isHighRiskView) {
    where.status = { not: "Inactive" };
    computed.highRisk = true;
  } else if (isLowRiskView) {
    where.status = { not: "Inactive" };
    computed.lowRisk = true;
  } else if (isNextDueView) {
    where.status = { not: "Inactive" };
    where.next_due_date = { not: null };
  }

  if (q.progress && VALID_ENUMS.progress.includes(String(q.progress))) {
    where.progress = toPrismaProgress(q.progress);
  }

  if (q.source && VALID_ENUMS.source.includes(String(q.source))) {
    where.source = toPrismaSource(q.source);
  }

  if (q.plan_type && VALID_ENUMS.plan_type.includes(String(q.plan_type))) {
    where.plan_type = toPrismaPlan(q.plan_type);
  }

  const tierMin = q.tier_min != null && q.tier_min !== "" ? Number(q.tier_min) : null;
  const tierMax = q.tier_max != null && q.tier_max !== "" ? Number(q.tier_max) : null;
  if (tierMin != null && !Number.isNaN(tierMin) && tierMax != null && !Number.isNaN(tierMax)) {
    where.tier = { gte: Math.min(tierMin, tierMax), lte: Math.max(tierMin, tierMax) };
  } else if (tierMin != null && !Number.isNaN(tierMin)) {
    where.tier = { gte: tierMin };
  } else if (tierMax != null && !Number.isNaN(tierMax)) {
    where.tier = { lte: tierMax };
  }

  if (q.city && String(q.city).trim()) {
    where.city = { contains: String(q.city).trim() };
  }

  const nextDueFrom = parseClientListYmd(q.next_due_from);
  const nextDueTo = parseClientListYmd(q.next_due_to);
  if (nextDueFrom || nextDueTo) {
    where.next_due_date = { ...(where.next_due_date || {}) };
    if (where.next_due_date.not === null) {
      /* keep not null + range */
    }
    const range = {};
    if (nextDueFrom) range.gte = toPrismaDate(nextDueFrom);
    if (nextDueTo) range.lte = toPrismaDate(nextDueTo);
    if (where.next_due_date.not === null) {
      and.push({ next_due_date: { not: null } }, { next_due_date: range });
      delete where.next_due_date;
    } else {
      where.next_due_date = range;
    }
  }

  const planExpiryFrom = parseClientListYmd(q.plan_expiry_from);
  const planExpiryTo = parseClientListYmd(q.plan_expiry_to);
  if (planExpiryFrom || planExpiryTo) {
    where.plan_expiry_date = {};
    if (planExpiryFrom) where.plan_expiry_date.gte = toPrismaDate(planExpiryFrom);
    if (planExpiryTo) where.plan_expiry_date.lte = toPrismaDate(planExpiryTo);
  }

  if (q.has_next_due === "1") {
    where.next_due_date = { ...(typeof where.next_due_date === "object" ? where.next_due_date : {}), not: null };
  } else if (q.has_next_due === "0") {
    where.next_due_date = null;
  }

  const expiringWithin = Number(q.expiring_within);
  if ([7, 14, 30].includes(expiringWithin)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const until = new Date(today);
    until.setDate(until.getDate() + expiringWithin);
    where.plan_expiry_date = { gte: today, lte: until };
  }

  if (q.search && String(q.search).trim()) {
    const searchTerm = String(q.search).trim();
    and.push({
      OR: [
        { full_name: { contains: searchTerm } },
        { client_id: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
        { email: { contains: searchTerm } },
      ],
    });
  }

  const priority = String(q.priority || "").toLowerCase();
  if (priority === "overdue") computed.overdue = true;
  else if (priority === "due_soon") computed.priority = "due_soon";
  else if (priority === "ok") computed.priority = "ok";

  if (q.high_risk === "1" || q.high_risk === "true") {
    computed.highRisk = true;
    computed.lowRisk = false;
  }
  if (q.low_risk === "1" || q.low_risk === "true") {
    computed.lowRisk = true;
    computed.highRisk = false;
  }

  if (and.length) where.AND = and;

  return {
    where,
    computed,
    isNextDueView,
    isSpecialView,
  };
}

const CLIENT_SORT_LABELS = {
  next_due: "Next due — earliest first",
  next_due_desc: "Next due — latest first",
  plan_expiry: "Plan expiry — soonest first",
  plan_expiry_desc: "Plan expiry — latest first",
  name: "Name A–Z",
  name_desc: "Name Z–A",
  tier: "Tier low → high",
  tier_desc: "Tier high → low",
  created: "Joined — newest",
  created_asc: "Joined — oldest",
  id_asc: "ID lowest first",
  id_desc: "ID highest first",
  risk_asc: "High risk first",
  risk_desc: "Low risk first",
  status_asc: "Status: Active first",
  status_desc: "Status: Inactive/Hold first",
  progress_asc: "Progress: Best first",
  progress_desc: "Progress: Poor first",
  follow_up_asc: "Follow-up: Overdue first",
  follow_up_desc: "Follow-up: OK first",
  days_asc: "Days remaining: Least first",
  days_desc: "Days remaining: Most first",
};

function applyComputedClientFilters(rows, computed) {
  let out = rows;
  if (computed.overdue) {
    out = out.filter((c) => c.follow_up_priority === "🔴 OVERDUE");
  }
  if (computed.highRisk) {
    out = out.filter((c) => c.is_high_risk);
  }
  if (computed.lowRisk) {
    out = out.filter((c) => !c.is_high_risk);
  }
  if (computed.priority === "due_soon") {
    out = out.filter((c) => c.follow_up_priority === "🟡 DUE SOON");
  } else if (computed.priority === "ok") {
    out = out.filter((c) => c.follow_up_priority === "✅ OK");
  }
  return out;
}

function resolveClientListSort(sortRaw, isNextDueView) {
  let sort = String(sortRaw || "").toLowerCase().trim();
  if (!CLIENT_LIST_SORTS.has(sort)) {
    sort = isNextDueView ? "next_due" : "created";
  }
  return sort;
}

async function getAllClients(req, res) {
  try {
    const { sort: sortQuery } = req.query;
    const { where, computed, isNextDueView } = buildClientListWhere(req.query);
    const sort = resolveClientListSort(sortQuery, isNextDueView);

    const rows = await prisma.fitness_clients.findMany({ where });
    let result = serializeFitnessRows(rows).map(computeClientFields);
    result = applyComputedClientFilters(result, computed);
    result = sortClientRows(result, sort);

    res.json({
      success: true,
      data: result,
      meta: {
        sort,
        sortLabel: CLIENT_SORT_LABELS[sort] || sort,
        total: result.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function searchClients(req, res) {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) {
      return res.json({ success: true, data: [] });
    }
    const searchTerm = String(q);
    const rows = await prisma.fitness_clients.findMany({
      where: {
        status: { not: "Inactive" },
        OR: [
          { client_id: { contains: searchTerm } },
          { full_name: { contains: searchTerm } },
          { phone: { contains: searchTerm } },
          { email: { contains: searchTerm } },
        ],
      },
      select: {
        client_id: true,
        full_name: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        status: true,
        tier: true,
      },
      take: 20,
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientSummary(req, res) {
  try {
    const { clientId } = req.params;
    const row = await prisma.fitness_clients.findUnique({
      where: { client_id: clientId },
      select: {
        client_id: true,
        full_name: true,
        status: true,
        progress: true,
        plan_type: true,
        plan_start_date: true,
        plan_expiry_date: true,
        last_consultation_date: true,
        next_due_date: true,
        tier: true,
        source: true,
      },
    });
    if (!row) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: computeClientFields(serializeFitnessRow(row)) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientById(req, res) {
  try {
    const { clientId } = req.params;
    const row = await prisma.fitness_clients.findUnique({ where: { client_id: clientId } });
    if (!row) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const client = computeClientFields(serializeFitnessRow(row));

    const [consultations, bodyStats, supplements, transactions, tasks, referralsGiven, referralsReceived] =
      await Promise.all([
        prisma.fitness_consultations.findMany({
          where: { client_id: clientId },
          orderBy: { consult_date: "desc" },
        }),
        prisma.fitness_body_stats.findMany({
          where: { client_id: clientId },
          orderBy: { recorded_date: "desc" },
        }),
        prisma.fitness_supplements.findMany({
          where: { client_id: clientId },
          orderBy: { prescribed_date: "desc" },
        }),
        prisma.fitness_transactions.findMany({
          where: { client_id: clientId },
          orderBy: { transaction_date: "desc" },
        }),
        prisma.fitness_client_tasks.findMany({
          where: { client_id: clientId },
          orderBy: { due_date: "asc" },
        }),
        prisma.fitness_referrals.findMany({ where: { referrer_client_id: clientId } }),
        prisma.fitness_referrals.findMany({ where: { referred_client_id: clientId } }),
      ]);

    const referredIds = referralsGiven.map((r) => r.referred_client_id);
    const referrerIds = referralsReceived.map((r) => r.referrer_client_id);
    const nameIds = [...new Set([...referredIds, ...referrerIds])];
    const nameRows = nameIds.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: nameIds } },
          select: { client_id: true, full_name: true },
        })
      : [];
    const nameMap = Object.fromEntries(nameRows.map((c) => [c.client_id, c.full_name]));

    res.json({
      success: true,
      data: {
        ...client,
        consultations: serializeFitnessRows(consultations),
        body_stats: serializeFitnessRows(bodyStats),
        supplements: serializeFitnessRows(supplements),
        transactions: serializeFitnessRows(transactions),
        tasks: serializeFitnessRows(tasks),
        referrals_given: serializeFitnessRows(referralsGiven).map((r) => ({
          ...r,
          referred_name: nameMap[r.referred_client_id] || null,
        })),
        referrals_received: serializeFitnessRows(referralsReceived).map((r) => ({
          ...r,
          referrer_name: nameMap[r.referrer_client_id] || null,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createClient(req, res) {
  try {
    const raw = req.body || {};
    const full_name = String(raw.full_name || "").trim();
    const phone = emptyToNull(raw.phone);
    const email = emptyToNull(raw.email);
    const age = optionalNumber(raw.age);
    const city = emptyToNull(raw.city);
    const address = emptyToNull(raw.address);
    const occupation = emptyToNull(raw.occupation);
    const emergency_contact = emptyToNull(raw.emergency_contact);
    const referred_by_client_id = emptyToNull(raw.referred_by_client_id);
    const referred_by_name = emptyToNull(raw.referred_by_name);
    const source = emptyToNull(raw.source);
    const tier = optionalNumber(raw.tier) ?? 3;
    const health_goal = emptyToNull(raw.health_goal);
    const plan_type = emptyToNull(raw.plan_type);
    const plan_start_date = emptyToNull(raw.plan_start_date);
    const next_due_date = emptyToNull(raw.next_due_date);
    const follow_up_freq_days = optionalNumber(raw.follow_up_freq_days) ?? 14;
    const medical_conditions = emptyToNull(raw.medical_conditions);
    const allergies = emptyToNull(raw.allergies);
    const activity_level = emptyToNull(raw.activity_level);
    const current_medications = emptyToNull(raw.current_medications);
    const height_cm = optionalNumber(raw.height_cm);
    const start_weight_kg = optionalNumber(raw.start_weight_kg);
    const current_weight_kg = optionalNumber(raw.current_weight_kg ?? raw.start_weight_kg);
    const target_weight_kg = optionalNumber(raw.target_weight_kg);
    const status = emptyToNull(raw.status);
    const progress = emptyToNull(raw.progress);

    // Express-validator validation
    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    // Existing validation
    if (!full_name) return sendValidationError(res, "Full name is required");

    const nameError = validateStringLength(full_name, 'full_name', 255);
    if (nameError) return sendValidationError(res, nameError);

    if (status) {
      const statusError = validateEnum(status, VALID_ENUMS.status, 'status');
      if (statusError) return sendValidationError(res, statusError);
    }
    if (progress) {
      const progressError = validateEnum(progress, VALID_ENUMS.progress, 'progress');
      if (progressError) return sendValidationError(res, progressError);
    }
    if (source) {
      const sourceError = validateEnum(source, VALID_ENUMS.source, 'source');
      if (sourceError) return sendValidationError(res, sourceError);
    }
    if (plan_type) {
      const planError = validateEnum(plan_type, VALID_ENUMS.plan_type, 'plan_type');
      if (planError) return sendValidationError(res, planError);
    }
    if (tier != null) {
      const tierError = validateNumber(tier, 'tier', 1, 5);
      if (tierError) return sendValidationError(res, tierError);
    }
    if (age != null) {
      const ageError = validateNumber(age, 'age', 1, 150);
      if (ageError) return sendValidationError(res, ageError);
    }
    if (height_cm != null) {
      const heightError = validateNumber(height_cm, 'height_cm', 50, 300);
      if (heightError) return sendValidationError(res, heightError);
    }
    if (start_weight_kg != null) {
      const weightError = validateNumber(start_weight_kg, 'start_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (current_weight_kg != null) {
      const weightError = validateNumber(current_weight_kg, 'current_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (target_weight_kg != null) {
      const weightError = validateNumber(target_weight_kg, 'target_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (follow_up_freq_days != null) {
      const freqError = validatePositiveInt(follow_up_freq_days, 'follow_up_freq_days');
      if (freqError) return sendValidationError(res, freqError);
    }
    if (plan_start_date) {
      const dateError = validateDate(plan_start_date, 'plan_start_date');
      if (dateError) return sendValidationError(res, dateError);
    }
    if (next_due_date) {
      const dateError = validateDate(next_due_date, "next_due_date");
      if (dateError) return sendValidationError(res, dateError);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendValidationError(res, 'Invalid email format');
    }

    const count = await prisma.fitness_clients.count();
    const clientId = generateClientId(count);

    let plan_expiry_date = null;
    if (plan_start_date && plan_type) {
      const { calculatePlanExpiryDate } = require("../services/fitnessComputedFields");
      plan_expiry_date = calculatePlanExpiryDate(plan_start_date, plan_type);
    }

    let bmi = null;
    if (height_cm && current_weight_kg) {
      const { calculateBMI } = require("../services/fitnessComputedFields");
      bmi = calculateBMI(height_cm, current_weight_kg);
    }

    const created = await prisma.fitness_clients.create({
      data: {
        client_id: clientId,
        full_name,
        phone,
        email,
        age: age != null ? Math.round(age) : null,
        city,
        address,
        occupation,
        emergency_contact,
        referred_by_client_id: referred_by_client_id || null,
        referred_by_name: referred_by_name || null,
        source: toPrismaSource(source || "Walk-in"),
        tier: tier || 3,
        health_goal,
        plan_type: plan_type ? toPrismaPlan(plan_type) : null,
        plan_start_date: toPrismaDate(plan_start_date),
        plan_expiry_date: toPrismaDate(plan_expiry_date),
        next_due_date: toPrismaDate(next_due_date),
        follow_up_freq_days: follow_up_freq_days || 14,
        medical_conditions,
        allergies,
        activity_level,
        current_medications,
        height_cm,
        start_weight_kg,
        current_weight_kg,
        target_weight_kg,
        bmi,
        status: status || "Active",
        progress: toPrismaProgress(progress || "Neutral"),
      },
    });

    const taskChanged = await syncClientDueTask(created, req.user?.id);
    if (taskChanged) emitFitnessAndDueTaskChanged("client_due_create");
    else emitFitnessChanged();
    res.status(201).json({
      success: true,
      data: computeClientFields(serializeFitnessRow(created)),
    });
  } catch (error) {
    console.error("POST /api/fitness/clients createClient:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateClient(req, res) {
  try {
    const { clientId } = req.params;
    const fields = req.body;

    // Validate clientId
    if (!clientId || typeof clientId !== 'string' || clientId.length > 20) {
      return sendValidationError(res, 'Invalid client ID');
    }

    // Validate each field
    if (fields.status) {
      const err = validateEnum(fields.status, VALID_ENUMS.status, 'status');
      if (err) return sendValidationError(res, err);
    }
    if (fields.progress) {
      const err = validateEnum(fields.progress, VALID_ENUMS.progress, 'progress');
      if (err) return sendValidationError(res, err);
    }
    if (fields.source) {
      const err = validateEnum(fields.source, VALID_ENUMS.source, 'source');
      if (err) return sendValidationError(res, err);
    }
    if (fields.plan_type) {
      const err = validateEnum(fields.plan_type, VALID_ENUMS.plan_type, 'plan_type');
      if (err) return sendValidationError(res, err);
    }
    if (fields.tier !== undefined) {
      const err = validateNumber(fields.tier, 'tier', 1, 5);
      if (err) return sendValidationError(res, err);
    }
    if (fields.age !== undefined) {
      const err = validateNumber(fields.age, 'age', 1, 150);
      if (err) return sendValidationError(res, err);
    }
    if (fields.height_cm !== undefined) {
      const err = validateNumber(fields.height_cm, 'height_cm', 50, 300);
      if (err) return sendValidationError(res, err);
    }
    if (fields.current_weight_kg !== undefined) {
      const err = validateNumber(fields.current_weight_kg, 'current_weight_kg', 1, 500);
      if (err) return sendValidationError(res, err);
    }
    if (fields.follow_up_freq_days !== undefined) {
      const err = validatePositiveInt(fields.follow_up_freq_days, 'follow_up_freq_days');
      if (err) return sendValidationError(res, err);
    }
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
      return sendValidationError(res, 'Invalid email format');
    }
    if (fields.plan_start_date) {
      const err = validateDate(fields.plan_start_date, 'plan_start_date');
      if (err) return sendValidationError(res, err);
    }
    if (fields.next_due_date) {
      const err = validateDate(fields.next_due_date, 'next_due_date');
      if (err) return sendValidationError(res, err);
    }

    const allowedFields = [
      "full_name", "status", "progress", "phone", "email", "age", "city", "address",
      "occupation", "emergency_contact", "referred_by_client_id", "source", "tier",
      "health_goal", "plan_type", "plan_start_date", "plan_expiry_date", "follow_up_freq_days",
      "last_consultation_date", "next_due_date", "medical_conditions", "allergies",
      "activity_level", "current_medications", "height_cm", "start_weight_kg",
      "current_weight_kg", "target_weight_kg", "coach_notes",
    ];

    const data = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!allowedFields.includes(key)) continue;
      let v = emptyToNull(value);
      if (key === "source") v = toPrismaSource(v);
      else if (key === "plan_type") v = toPrismaPlan(v);
      else if (key === "progress") v = toPrismaProgress(v);
      else if (
        [
          "plan_start_date",
          "plan_expiry_date",
          "last_consultation_date",
          "next_due_date",
        ].includes(key)
      ) {
        v = toPrismaDate(v);
      } else if (key === "age" || key === "tier" || key === "follow_up_freq_days") {
        v = v == null ? null : Number(v);
      }
      data[key] = v;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    if (fields.height_cm !== undefined || fields.current_weight_kg !== undefined) {
      const client = await prisma.fitness_clients.findUnique({
        where: { client_id: clientId },
        select: { height_cm: true, current_weight_kg: true },
      });
      const height = fields.height_cm ?? numOrNull(client?.height_cm);
      const weight = fields.current_weight_kg ?? numOrNull(client?.current_weight_kg);
      if (height && weight) {
        const { calculateBMI } = require("../services/fitnessComputedFields");
        data.bmi = calculateBMI(height, weight);
      }
    }

    data.updated_at = new Date();

    try {
      const updated = await prisma.fitness_clients.update({
        where: { client_id: clientId },
        data,
      });
      const taskChanged = await syncClientDueTask(updated, req.user?.id);
      if (taskChanged) emitFitnessAndDueTaskChanged("client_due_update");
      else emitFitnessChanged();
      res.json({
        success: true,
        data: computeClientFields(serializeFitnessRow(updated)),
      });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

function isValidFitnessClientId(clientId) {
  return (
    typeof clientId === "string" &&
    clientId.length >= 4 &&
    clientId.length <= 32 &&
    /^FV-[A-Za-z0-9_-]+$/.test(clientId)
  );
}

async function deleteClient(req, res) {
  const { clientId } = req.params;
  const soft =
    req.query.soft === "1" ||
    req.query.soft === "true" ||
    String(req.query.mode || "").toLowerCase() === "inactive";

  if (!isValidFitnessClientId(clientId)) {
    return res.status(400).json({ success: false, message: "Invalid client ID" });
  }

  if (soft) {
    try {
      const result = await prisma.fitness_clients.updateMany({
        where: { client_id: clientId },
        data: { status: "Inactive", updated_at: new Date() },
      });
      if (result.count === 0) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
      emitFitnessChanged();
      return res.json({ success: true, message: "Client marked as inactive" });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const client = await tx.fitness_clients.findUnique({
        where: { client_id: clientId },
        select: { id: true },
      });
      if (!client) throw new Error("Client not found");
      const internalId = BigInt(client.id);

      await tx.notifications.deleteMany({
        where: {
          entity_type: { in: ["fitness_expiry", "fitness_due"] },
          entity_id: internalId,
        },
      });
      await tx.fitness_referrals.deleteMany({
        where: {
          OR: [
            { referrer_client_id: clientId },
            { referred_client_id: clientId },
          ],
        },
      });
      await tx.fitness_meal_plans.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_client_tasks.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_supplements.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_transactions.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_body_stats.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_consultations.deleteMany({ where: { client_id: clientId } });
      await tx.fitness_clients.updateMany({
        where: { referred_by_client_id: clientId },
        data: { referred_by_client_id: null },
      });
      await tx.fitness_external_buyers.updateMany({
        where: { referred_by_client_id: clientId },
        data: { referred_by_client_id: null },
      });
      await tx.fitness_clients.delete({ where: { client_id: clientId } });
    });

    emitFitnessChanged();
    res.json({
      success: true,
      message: "Client and all related fitness records were removed from the database",
    });
  } catch (error) {
    if (error.message === "Client not found" || error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────
async function getAllConsultations(req, res) {
  try {
    const rows = await prisma.fitness_consultations.findMany({
      orderBy: { consult_date: "desc" },
      take: 500,
    });
    const clientIds = [...new Set(rows.map((r) => r.client_id))];
    const clients = clientIds.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: clientIds } },
          select: { client_id: true, full_name: true, status: true },
        })
      : [];
    const cmap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
    res.json({
      success: true,
      data: serializeFitnessRows(rows).map((c) => ({
        ...c,
        full_name: cmap[c.client_id]?.full_name || null,
        client_status: cmap[c.client_id]?.status || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getConsultations(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_consultations.findMany({
      where: { client_id: clientId },
      orderBy: { consult_date: "desc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createConsultation(req, res) {
  try {
    const { clientId } = req.params;
    const { consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment } = req.body;

    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    if (!clientId || typeof clientId !== "string") {
      return sendValidationError(res, "Invalid client ID");
    }
    const reqError = validateRequired({ consult_date, consult_type }, ["consult_date", "consult_type"]);
    if (reqError) return sendValidationError(res, reqError);

    const dateErr = validateDate(consult_date, "consult_date");
    if (dateErr) return sendValidationError(res, dateErr);

    const typeErr = validateEnum(consult_type, VALID_ENUMS.consult_type, "consult_type");
    if (typeErr) return sendValidationError(res, typeErr);

    if (weight_kg !== undefined) {
      const weightErr = validateNumber(weight_kg, "weight_kg", 1, 500);
      if (weightErr) return sendValidationError(res, weightErr);
    }

    const created = await prisma.fitness_consultations.create({
      data: {
        client_id: clientId,
        consult_date: toPrismaDate(consult_date),
        consult_type: toPrismaConsult(consult_type),
        weight_kg: weight_kg != null ? weight_kg : null,
        key_observations: key_observations ?? null,
        diet_changes: diet_changes ?? null,
        next_steps: next_steps ?? null,
        next_appointment: next_appointment ?? null,
      },
    });

    const client = await prisma.fitness_clients.findUnique({
      where: { client_id: clientId },
    });
    if (client) {
      const clientData = {
        last_consultation_date: toPrismaDate(consult_date),
        updated_at: new Date(),
      };
      if (client.follow_up_freq_days) {
        const { calculateNextDueDate } = require("../services/fitnessComputedFields");
        const nextDue = calculateNextDueDate(consult_date, client.follow_up_freq_days);
        if (nextDue) clientData.next_due_date = toPrismaDate(nextDue);
      }
      const updatedClient = await prisma.fitness_clients.update({
        where: { client_id: clientId },
        data: clientData,
      });
      const taskChanged = await syncClientDueTask(updatedClient, req.user?.id);
      if (taskChanged) emitFitnessAndDueTaskChanged("client_due_consultation");
      else emitFitnessChanged();
    } else {
      emitFitnessChanged();
    }

    res.status(201).json({ success: true, data: serializeFitnessRow(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateConsultation(req, res) {
  try {
    const { id } = req.params;
    const { consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment } = req.body;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, "Invalid consultation ID");

    if (consult_date) {
      const err = validateDate(consult_date, "consult_date");
      if (err) return sendValidationError(res, err);
    }
    if (consult_type) {
      const err = validateEnum(consult_type, VALID_ENUMS.consult_type, "consult_type");
      if (err) return sendValidationError(res, err);
    }
    if (weight_kg !== undefined) {
      const err = validateNumber(weight_kg, "weight_kg", 1, 500);
      if (err) return sendValidationError(res, err);
    }

    try {
      const updated = await prisma.fitness_consultations.update({
        where: { id: idNum },
        data: {
          consult_date: toPrismaDate(consult_date),
          consult_type: consult_type != null ? toPrismaConsult(consult_type) : undefined,
          weight_kg: weight_kg ?? null,
          key_observations: key_observations ?? null,
          diet_changes: diet_changes ?? null,
          next_steps: next_steps ?? null,
          next_appointment: next_appointment ?? null,
        },
      });
      emitFitnessChanged();
      res.json({ success: true, data: serializeFitnessRow(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Consultation not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteConsultation(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_consultations.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Consultation not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// BODYSTATS
// ─────────────────────────────────────────────────────────────────
async function getBodyStats(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_body_stats.findMany({
      where: { client_id: clientId },
      orderBy: { recorded_date: "desc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createBodyStat(req, res) {
  try {
    const { clientId } = req.params;
    const { recorded_date, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, notes } = req.body;

    if (!clientId || typeof clientId !== "string") {
      return sendValidationError(res, "Invalid client ID");
    }
    const reqError = validateRequired({ recorded_date }, ["recorded_date"]);
    if (reqError) return sendValidationError(res, reqError);

    const dateErr = validateDate(recorded_date, "recorded_date");
    if (dateErr) return sendValidationError(res, dateErr);

    if (weight_kg !== undefined) {
      const err = validateNumber(weight_kg, "weight_kg", 1, 500);
      if (err) return sendValidationError(res, err);
    }
    if (body_fat_pct !== undefined) {
      const err = validateNumber(body_fat_pct, "body_fat_pct", 0, 100);
      if (err) return sendValidationError(res, err);
    }
    if (waist_cm !== undefined) {
      const err = validateNumber(waist_cm, "waist_cm", 1, 300);
      if (err) return sendValidationError(res, err);
    }

    const created = await prisma.fitness_body_stats.create({
      data: {
        client_id: clientId,
        recorded_date: toPrismaDate(recorded_date),
        weight_kg: weight_kg ?? null,
        body_fat_pct: body_fat_pct ?? null,
        muscle_mass_kg: muscle_mass_kg ?? null,
        waist_cm: waist_cm ?? null,
        notes: notes ?? null,
      },
    });

    if (weight_kg) {
      const { calculateBMI } = require("../services/fitnessComputedFields");
      const client = await prisma.fitness_clients.findUnique({
        where: { client_id: clientId },
        select: { height_cm: true },
      });
      let bmi = null;
      if (client?.height_cm) {
        bmi = calculateBMI(numOrNull(client.height_cm), weight_kg);
      }
      await prisma.fitness_clients.update({
        where: { client_id: clientId },
        data: { current_weight_kg: weight_kg, bmi, updated_at: new Date() },
      });
    }

    emitFitnessChanged();
    res.status(201).json({ success: true, data: serializeFitnessRow(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteBodyStat(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_body_stats.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Body stat not found" });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// SUPPLEMENTS
// ─────────────────────────────────────────────────────────────────
async function getSupplements(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_supplements.findMany({
      where: { client_id: clientId },
      orderBy: { prescribed_date: "desc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createSupplement(req, res) {
  try {
    const { clientId } = req.params;
    const { product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes } = req.body;

    if (!clientId || typeof clientId !== "string") {
      return sendValidationError(res, "Invalid client ID");
    }
    const reqError = validateRequired({ product_name }, ["product_name"]);
    if (reqError) return sendValidationError(res, reqError);

    if (prescribed_date) {
      const err = validateDate(prescribed_date, "prescribed_date");
      if (err) return sendValidationError(res, err);
    }
    if (quantity !== undefined) {
      const err = validatePositiveInt(quantity, "quantity");
      if (err) return sendValidationError(res, err);
    }
    if (mrp_inr !== undefined) {
      const err = validateNumber(mrp_inr, "mrp_inr", 0);
      if (err) return sendValidationError(res, err);
    }
    if (rate_inr !== undefined) {
      const err = validateNumber(rate_inr, "rate_inr", 0);
      if (err) return sendValidationError(res, err);
    }

    const created = await prisma.fitness_supplements.create({
      data: {
        client_id: clientId,
        product_name,
        prescribed_date: toPrismaDate(prescribed_date),
        quantity: quantity != null ? Number(quantity) : null,
        mrp_inr: mrp_inr ?? null,
        rate_inr: rate_inr ?? null,
        notes: notes ?? null,
      },
    });
    emitFitnessChanged();
    res.status(201).json({ success: true, data: serializeFitnessRow(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateSupplement(req, res) {
  try {
    const { id } = req.params;
    const { product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes } = req.body;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, "Invalid supplement ID");

    if (prescribed_date) {
      const err = validateDate(prescribed_date, "prescribed_date");
      if (err) return sendValidationError(res, err);
    }
    if (quantity !== undefined) {
      const err = validatePositiveInt(quantity, "quantity");
      if (err) return sendValidationError(res, err);
    }
    if (mrp_inr !== undefined) {
      const err = validateNumber(mrp_inr, "mrp_inr", 0);
      if (err) return sendValidationError(res, err);
    }
    if (rate_inr !== undefined) {
      const err = validateNumber(rate_inr, "rate_inr", 0);
      if (err) return sendValidationError(res, err);
    }

    try {
      const updated = await prisma.fitness_supplements.update({
        where: { id: idNum },
        data: {
          product_name,
          prescribed_date: toPrismaDate(prescribed_date),
          quantity: quantity != null ? Number(quantity) : null,
          mrp_inr: mrp_inr ?? null,
          rate_inr: rate_inr ?? null,
          notes: notes ?? null,
        },
      });
      emitFitnessChanged();
      res.json({ success: true, data: serializeFitnessRow(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Supplement not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteSupplement(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_supplements.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Supplement not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────────
async function enrichFitnessTransactions(rows) {
  if (!rows.length) return [];
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  const extIds = [...new Set(rows.map((r) => r.external_buyer_id).filter(Boolean))];

  const [clients, buyers] = await Promise.all([
    clientIds.length
      ? prisma.fitness_clients.findMany({
          where: { client_id: { in: clientIds } },
          select: { client_id: true, full_name: true },
        })
      : [],
    extIds.length
      ? prisma.fitness_external_buyers.findMany({
          where: { id: { in: extIds } },
          select: {
            id: true,
            full_name: true,
            phone: true,
            referred_by_client_id: true,
          },
        })
      : [],
  ]);
  const clientMap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
  const buyerMap = Object.fromEntries(buyers.map((b) => [b.id, b]));

  const refClientIds = [
    ...new Set(buyers.map((b) => b.referred_by_client_id).filter(Boolean)),
  ];
  const refClients = refClientIds.length
    ? await prisma.fitness_clients.findMany({
        where: { client_id: { in: refClientIds } },
        select: { client_id: true, full_name: true },
      })
    : [];
  const refMap = Object.fromEntries(refClients.map((c) => [c.client_id, c.full_name]));

  const visitCounts = {};
  const byBuyer = {};
  for (const r of rows) {
    if (!r.external_buyer_id) continue;
    if (!byBuyer[r.external_buyer_id]) byBuyer[r.external_buyer_id] = [];
    byBuyer[r.external_buyer_id].push(r);
  }
  for (const list of Object.values(byBuyer)) {
    list.sort((a, b) => {
      const da = toYmd(a.transaction_date) || "";
      const db = toYmd(b.transaction_date) || "";
      if (da !== db) return da < db ? -1 : 1;
      return a.id - b.id;
    });
    list.forEach((r, i) => {
      visitCounts[r.id] = i + 1;
    });
  }

  // For visit_index accuracy across all buyer txs (not just filtered set), count prior txs
  const missingBuyerIds = extIds.filter((id) => {
    const present = (byBuyer[id] || []).length;
    return present > 0;
  });
  if (missingBuyerIds.length) {
    const allBuyerTxs = await prisma.fitness_transactions.findMany({
      where: { external_buyer_id: { in: missingBuyerIds } },
      select: { id: true, external_buyer_id: true, transaction_date: true },
      orderBy: [{ transaction_date: "asc" }, { id: "asc" }],
    });
    const idx = {};
    const counters = {};
    for (const t of allBuyerTxs) {
      counters[t.external_buyer_id] = (counters[t.external_buyer_id] || 0) + 1;
      idx[t.id] = counters[t.external_buyer_id];
    }
    Object.assign(visitCounts, idx);
  }

  return serializeFitnessRows(rows).map((r) => {
    const buyer = r.external_buyer_id ? buyerMap[r.external_buyer_id] : null;
    return {
      ...r,
      client_name: r.client_id ? clientMap[r.client_id]?.full_name || null : null,
      external_buyer_name: buyer?.full_name || null,
      external_buyer_phone: buyer?.phone || null,
      referred_by_client_name: buyer?.referred_by_client_id
        ? refMap[buyer.referred_by_client_id] || null
        : null,
      visit_index: r.external_buyer_id ? visitCounts[r.id] ?? null : null,
    };
  });
}

async function getAllTransactions(req, res) {
  try {
    const { client_id, month, type, scope } = req.query;
    const scopeNorm = String(scope || "client").toLowerCase();
    if (!["client", "external", "all"].includes(scopeNorm)) {
      return res.status(400).json({ success: false, message: "scope must be client, external, or all" });
    }

    const where = {};
    if (scopeNorm === "client") where.client_id = { not: null };
    else if (scopeNorm === "external") where.external_buyer_id = { not: null };
    if (client_id) where.client_id = String(client_id);
    if (type) where.type = type;
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [y, m] = String(month).split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      where.transaction_date = { gte: start, lte: end };
    }

    const rows = await prisma.fitness_transactions.findMany({
      where,
      orderBy: { transaction_date: "desc" },
    });
    res.json({ success: true, data: await enrichFitnessTransactions(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientTransactions(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_transactions.findMany({
      where: { client_id: clientId },
      orderBy: { transaction_date: "desc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createTransaction(req, res) {
  try {
    const body = req.body || {};
    const {
      client_id,
      external_buyer_id: extIdBody,
      external_buyer,
      transaction_date,
      payment_due_date,
      product_plan,
      type,
      mrp_inr,
      rate_inr,
      received_inr,
      pending_inr,
      cost_inr,
      pay_mode,
      notes,
    } = body;

    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    const reqError = validateRequired(
      { transaction_date, product_plan, type },
      ["transaction_date", "product_plan", "type"]
    );
    if (reqError) return sendValidationError(res, reqError);

    const dateErr = validateDate(transaction_date, "transaction_date");
    if (dateErr) return sendValidationError(res, dateErr);
    const paymentDueDateErr = validateDate(payment_due_date, "payment_due_date");
    if (paymentDueDateErr) return sendValidationError(res, paymentDueDateErr);

    const typeErr = validateEnum(type, VALID_ENUMS.transaction_type, "type");
    if (typeErr) return sendValidationError(res, typeErr);

    if (pay_mode) {
      const modeErr = validateEnum(pay_mode, VALID_ENUMS.pay_mode, "pay_mode");
      if (modeErr) return sendValidationError(res, modeErr);
    }
    if (mrp_inr !== undefined) {
      const err = validateNumber(mrp_inr, "mrp_inr", 0);
      if (err) return sendValidationError(res, err);
    }
    if (rate_inr !== undefined) {
      const err = validateNumber(rate_inr, "rate_inr", 0);
      if (err) return sendValidationError(res, err);
    }
    if (received_inr !== undefined) {
      const err = validateNumber(received_inr, "received_inr", 0);
      if (err) return sendValidationError(res, err);
    }
    if (cost_inr !== undefined) {
      const err = validateNumber(cost_inr, "cost_inr", 0);
      if (err) return sendValidationError(res, err);
    }

    const cid = client_id && String(client_id).trim() ? String(client_id).trim() : null;
    const extIdRaw = extIdBody;
    const extIdParsed =
      extIdRaw !== undefined && extIdRaw !== null && extIdRaw !== ""
        ? parseInt(extIdRaw, 10)
        : null;
    const hasExplicitExtId = extIdParsed !== null && !Number.isNaN(extIdParsed);
    const hasExtObj =
      external_buyer &&
      typeof external_buyer === "object" &&
      !Array.isArray(external_buyer);

    const pathCount = (cid ? 1 : 0) + (hasExplicitExtId ? 1 : 0) + (hasExtObj ? 1 : 0);
    if (pathCount !== 1) {
      return sendValidationError(
        res,
        "Provide exactly one of: client_id, external_buyer_id, or external_buyer"
      );
    }

    let finalClientId = null;
    let finalExtBuyerId = null;

    if (cid) {
      if (cid.length > 20) {
        return sendValidationError(res, "Invalid client_id");
      }
      finalClientId = cid;
    } else if (hasExplicitExtId) {
      const buyer = await prisma.fitness_external_buyers.findUnique({
        where: { id: extIdParsed },
        select: { id: true },
      });
      if (!buyer) {
        return res.status(400).json({ success: false, message: "external_buyer_id not found" });
      }
      finalExtBuyerId = extIdParsed;
    } else if (hasExtObj) {
      const eb = external_buyer;
      const name = eb.full_name != null ? String(eb.full_name).trim() : "";
      if (!name) {
        return sendValidationError(res, "external_buyer.full_name is required");
      }
      const phoneNorm = normalizePhoneDigits(eb.phone);
      const refId =
        eb.referred_by_client_id && String(eb.referred_by_client_id).trim()
          ? String(eb.referred_by_client_id).trim()
          : null;
      if (refId) {
        const cref = await prisma.fitness_clients.findUnique({
          where: { client_id: refId },
          select: { client_id: true },
        });
        if (!cref) {
          return sendValidationError(res, "external_buyer.referred_by_client_id not found");
        }
      }
      let buyerId;
      if (phoneNorm) {
        const found = await prisma.fitness_external_buyers.findUnique({
          where: { phone: phoneNorm },
          select: { id: true },
        });
        if (found) buyerId = found.id;
      }
      if (!buyerId) {
        const noteVal = eb.notes != null ? String(eb.notes) : null;
        try {
          const createdBuyer = await prisma.fitness_external_buyers.create({
            data: {
              full_name: name,
              phone: phoneNorm,
              referred_by_client_id: refId,
              notes: noteVal,
            },
          });
          buyerId = createdBuyer.id;
        } catch (insErr) {
          if (phoneNorm) {
            const found2 = await prisma.fitness_external_buyers.findUnique({
              where: { phone: phoneNorm },
              select: { id: true },
            });
            if (!found2) {
              return res.status(500).json({ success: false, message: insErr.message });
            }
            buyerId = found2.id;
          } else {
            return res.status(500).json({ success: false, message: insErr.message });
          }
        }
      }
      finalExtBuyerId = buyerId;
    }

    try {
      const created = await prisma.fitness_transactions.create({
        data: {
          client_id: finalClientId,
          external_buyer_id: finalExtBuyerId,
          transaction_date: toPrismaDate(transaction_date),
          payment_due_date: toPrismaDate(payment_due_date),
          product_plan,
          type,
          mrp_inr: mrp_inr ?? null,
          rate_inr: rate_inr ?? null,
          received_inr: received_inr || 0,
          pending_inr: pending_inr || 0,
          cost_inr: cost_inr || 0,
          pay_mode: toPrismaPayMode(pay_mode || "GPay"),
          notes: notes ?? null,
        },
      });
      const enriched = await enrichFitnessTransactions([created]);
      emitFitnessChanged();

      let receipt_invoice_id = null;
      if (Number(received_inr) > 0) {
        try {
          const { createReceiptForFitnessTransaction } = require("../services/paymentReceiptService");
          const receipt = await createReceiptForFitnessTransaction(
            created.id,
            Number(req.user?.id)
          );
          receipt_invoice_id = receipt?.id || null;
        } catch (receiptErr) {
          console.warn("payment receipt (transaction):", receiptErr.message);
        }
      }

      res.status(201).json({
        success: true,
        data: { ...enriched[0], receipt_invoice_id },
      });
    } catch (err) {
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateTransaction(req, res) {
  try {
    const { id } = req.params;
    const { transaction_date, payment_due_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid transaction ID');

    if (transaction_date) {
      const err = validateDate(transaction_date, 'transaction_date');
      if (err) return sendValidationError(res, err);
    }
    if (payment_due_date) {
      const err = validateDate(payment_due_date, 'payment_due_date');
      if (err) return sendValidationError(res, err);
    }
    if (type) {
      const err = validateEnum(type, VALID_ENUMS.transaction_type, 'type');
      if (err) return sendValidationError(res, err);
    }
    if (pay_mode) {
      const err = validateEnum(pay_mode, VALID_ENUMS.pay_mode, 'pay_mode');
      if (err) return sendValidationError(res, err);
    }
    if (mrp_inr !== undefined) {
      const err = validateNumber(mrp_inr, 'mrp_inr', 0);
      if (err) return sendValidationError(res, err);
    }
    if (rate_inr !== undefined) {
      const err = validateNumber(rate_inr, 'rate_inr', 0);
      if (err) return sendValidationError(res, err);
    }
    if (received_inr !== undefined) {
      const err = validateNumber(received_inr, 'received_inr', 0);
      if (err) return sendValidationError(res, err);
    }
    if (cost_inr !== undefined) {
      const err = validateNumber(cost_inr, 'cost_inr', 0);
      if (err) return sendValidationError(res, err);
    }

    try {
      const updated = await prisma.fitness_transactions.update({
        where: { id: idNum },
        data: {
          transaction_date: toPrismaDate(transaction_date),
          payment_due_date: toPrismaDate(payment_due_date),
          product_plan,
          type,
          mrp_inr: mrp_inr ?? null,
          rate_inr: rate_inr ?? null,
          received_inr: received_inr ?? null,
          pending_inr: pending_inr ?? null,
          cost_inr: cost_inr ?? null,
          pay_mode: pay_mode != null ? toPrismaPayMode(pay_mode) : null,
          notes: notes ?? null,
        },
      });
      const enriched = await enrichFitnessTransactions([updated]);
      emitFitnessChanged();
      res.json({ success: true, data: enriched[0] });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Transaction not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteTransaction(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_transactions.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getExternalBuyers(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const buyers = await prisma.fitness_external_buyers.findMany({
      orderBy: { id: "desc" },
    });
    const txs = await prisma.fitness_transactions.findMany({
      where: { external_buyer_id: { not: null } },
      select: {
        external_buyer_id: true,
        received_inr: true,
        transaction_date: true,
      },
    });
    const refIds = [...new Set(buyers.map((b) => b.referred_by_client_id).filter(Boolean))];
    const refs = refIds.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: refIds } },
          select: { client_id: true, full_name: true },
        })
      : [];
    const refMap = Object.fromEntries(refs.map((c) => [c.client_id, c.full_name]));
    const agg = {};
    for (const t of txs) {
      const id = t.external_buyer_id;
      if (!agg[id]) agg[id] = { lifetime_received: 0, visit_count: 0, last_visit: null };
      agg[id].lifetime_received += Number(t.received_inr || 0);
      agg[id].visit_count += 1;
      const d = toYmd(t.transaction_date);
      if (d && (!agg[id].last_visit || d > agg[id].last_visit)) agg[id].last_visit = d;
    }
    let rows = buyers.map((b) => {
      const a = agg[b.id] || { lifetime_received: 0, visit_count: 0, last_visit: null };
      return {
        id: b.id,
        full_name: b.full_name,
        phone: b.phone,
        referred_by_client_id: b.referred_by_client_id,
        notes: b.notes,
        created_at: b.created_at,
        updated_at: b.updated_at,
        lifetime_received: a.lifetime_received,
        visit_count: a.visit_count,
        last_visit: a.last_visit,
        referred_by_client_name: b.referred_by_client_id
          ? refMap[b.referred_by_client_id] || null
          : null,
      };
    });
    rows.sort((a, b) => {
      if (!a.last_visit && b.last_visit) return 1;
      if (a.last_visit && !b.last_visit) return -1;
      if (a.last_visit !== b.last_visit) return a.last_visit < b.last_visit ? 1 : -1;
      return b.id - a.id;
    });
    rows = rows.slice(offset, offset + limit);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getExternalStats(req, res) {
  try {
    const fromStr = parseYmdQuery(req.query.date_from);
    const toStr = parseYmdQuery(req.query.date_to);
    const where = { external_buyer_id: { not: null } };
    if (fromStr || toStr) {
      where.transaction_date = {};
      if (fromStr) where.transaction_date.gte = toPrismaDate(fromStr);
      if (toStr) where.transaction_date.lte = toPrismaDate(toStr);
    }
    const txs = await prisma.fitness_transactions.findMany({
      where,
      select: {
        external_buyer_id: true,
        received_inr: true,
        cost_inr: true,
      },
    });
    const buyerCounts = {};
    let total_received = 0;
    let total_profit = 0;
    for (const t of txs) {
      total_received += Number(t.received_inr || 0);
      total_profit += Number(t.received_inr || 0) - Number(t.cost_inr || 0);
      if (t.external_buyer_id) {
        buyerCounts[t.external_buyer_id] = (buyerCounts[t.external_buyer_id] || 0) + 1;
      }
    }
    res.json({
      success: true,
      data: {
        transaction_count: txs.length,
        total_received,
        total_profit,
        distinct_buyers: Object.keys(buyerCounts).length,
        repeat_buyers: Object.values(buyerCounts).filter((n) => n > 1).length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function searchExternalBuyers(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const qDigits = normalizePhoneDigits(q);
    const or = [{ full_name: { contains: q } }];
    if (qDigits && qDigits.length >= 2) {
      or.push({ phone: { contains: qDigits } });
    }
    const rows = await prisma.fitness_external_buyers.findMany({
      where: { OR: or },
      orderBy: { id: "desc" },
      take: 30,
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getTransactionSummary(req, res) {
  try {
    const { period } = req.query;
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31);
    const txs = await prisma.fitness_transactions.findMany({
      where: { transaction_date: { gte: yearStart, lte: yearEnd } },
      select: {
        transaction_date: true,
        type: true,
        received_inr: true,
        pending_inr: true,
        cost_inr: true,
      },
    });

    if (period === "yearly") {
      let total_received = 0;
      let total_pending = 0;
      let total_cost = 0;
      let membership_rev = 0;
      let supplement_rev = 0;
      for (const t of txs) {
        const rec = Number(t.received_inr || 0);
        total_received += rec;
        total_pending += Number(t.pending_inr || 0);
        total_cost += Number(t.cost_inr || 0);
        if (t.type === "Membership") membership_rev += rec;
        if (t.type === "Supplement") supplement_rev += rec;
      }
      return res.json({
        success: true,
        data: {
          total_received,
          total_pending,
          total_cost,
          total_profit: total_received - total_cost,
          membership_rev,
          supplement_rev,
          total_transactions: txs.length,
        },
      });
    }

    const byMonth = {};
    for (const t of txs) {
      const month = toYmd(t.transaction_date)?.slice(0, 7);
      if (!month) continue;
      if (!byMonth[month]) {
        byMonth[month] = {
          month,
          received: 0,
          pending: 0,
          cost: 0,
          profit: 0,
          membership: 0,
          supplement: 0,
          transactions: 0,
        };
      }
      const rec = Number(t.received_inr || 0);
      const cost = Number(t.cost_inr || 0);
      byMonth[month].received += rec;
      byMonth[month].pending += Number(t.pending_inr || 0);
      byMonth[month].cost += cost;
      byMonth[month].profit += rec - cost;
      byMonth[month].transactions += 1;
      if (t.type === "Membership") byMonth[month].membership += rec;
      if (t.type === "Supplement") byMonth[month].supplement += rec;
    }

    const months = [];
    for (let i = 1; i <= 12; i++) {
      const monthStr = `${currentYear}-${String(i).padStart(2, "0")}`;
      months.push(
        byMonth[monthStr] || {
          month: monthStr,
          received: 0,
          pending: 0,
          cost: 0,
          profit: 0,
          membership: 0,
          supplement: 0,
          transactions: 0,
        }
      );
    }

    const totals = months.reduce(
      (acc, m) => ({
        received: acc.received + Number(m.received || 0),
        pending: acc.pending + Number(m.pending || 0),
        cost: acc.cost + Number(m.cost || 0),
        profit: acc.profit + Number(m.profit || 0),
        membership: acc.membership + Number(m.membership || 0),
        supplement: acc.supplement + Number(m.supplement || 0),
        transactions: acc.transactions + Number(m.transactions || 0),
      }),
      {
        received: 0,
        pending: 0,
        cost: 0,
        profit: 0,
        membership: 0,
        supplement: 0,
        transactions: 0,
      }
    );

    res.json({ success: true, data: { months, totals } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

function parseYmdQuery(value) {
  if (value == null) return null;
  const t = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

async function getFitnessTransactionCharts(req, res) {
  try {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const y = today.getFullYear();
    const mo = today.getMonth() + 1;
    const defaultTo = `${y}-${pad(mo)}-${pad(today.getDate())}`;
    const defaultFrom = `${y}-${pad(mo)}-01`;

    let fromStr = parseYmdQuery(req.query.date_from);
    let toStr = parseYmdQuery(req.query.date_to);
    if (!fromStr && !toStr) {
      fromStr = defaultFrom;
      toStr = defaultTo;
    } else if (fromStr && !toStr) {
      toStr = fromStr;
    } else if (!fromStr && toStr) {
      fromStr = toStr;
    }
    if (fromStr > toStr) {
      return res
        .status(400)
        .json({ success: false, message: "date_from must be on or before date_to" });
    }

    const txs = await prisma.fitness_transactions.findMany({
      where: {
        transaction_date: {
          gte: toPrismaDate(fromStr),
          lte: toPrismaDate(toStr),
        },
      },
      select: {
        type: true,
        pay_mode: true,
        received_inr: true,
        pending_inr: true,
        cost_inr: true,
      },
    });

    const typeMap = {};
    const payMap = {};
    const totals = { received: 0, pending: 0, profit: 0, cnt: 0 };
    for (const t of txs) {
      const rec = Number(t.received_inr || 0);
      const pend = Number(t.pending_inr || 0);
      const profit = rec - Number(t.cost_inr || 0);
      const typeKey = t.type || "Other";
      const payKey = serializeFitnessRow({ pay_mode: t.pay_mode }).pay_mode || "Unknown";
      if (!typeMap[typeKey]) {
        typeMap[typeKey] = { key_label: typeKey, received: 0, pending: 0, profit: 0, cnt: 0 };
      }
      typeMap[typeKey].received += rec;
      typeMap[typeKey].pending += pend;
      typeMap[typeKey].profit += profit;
      typeMap[typeKey].cnt += 1;
      if (!payMap[payKey]) {
        payMap[payKey] = { key_label: payKey, received: 0, pending: 0, cnt: 0 };
      }
      payMap[payKey].received += rec;
      payMap[payKey].pending += pend;
      payMap[payKey].cnt += 1;
      totals.received += rec;
      totals.pending += pend;
      totals.profit += profit;
      totals.cnt += 1;
    }

    res.json({
      success: true,
      data: {
        range: { from: fromStr, to: toStr },
        byType: Object.values(typeMap).sort((a, b) => b.received - a.received),
        byPayMode: Object.values(payMap).sort((a, b) => b.received - a.received),
        totals,
      },
    });
  } catch (error) {
    console.error("getFitnessTransactionCharts", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getRevenueSplit(req, res) {
  try {
    const window = String(req.query.window || "month").toLowerCase();
    if (!["day", "month", "year"].includes(window)) {
      return res
        .status(400)
        .json({ success: false, message: "window must be day, month, or year" });
    }
    const refRaw =
      req.query.date != null && String(req.query.date).trim() !== ""
        ? String(req.query.date).trim()
        : null;
    const today = new Date();
    const defaultRef = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const ref =
      refRaw && /^\d{4}-\d{2}-\d{2}$/.test(refRaw.slice(0, 10))
        ? refRaw.slice(0, 10)
        : defaultRef;
    const [yStr, mStr] = ref.split("-");
    const y = Number(yStr);
    const mo = Number(mStr);
    const da = Number(ref.split("-")[2]);
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || da < 1 || da > 31) {
      return res
        .status(400)
        .json({ success: false, message: "date must be a valid YYYY-MM-DD" });
    }

    let fromStr;
    let toStr;
    let periodLabel;
    if (window === "day") {
      fromStr = ref;
      toStr = ref;
      const d = new Date(y, mo - 1, da);
      periodLabel = d.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } else if (window === "month") {
      const lastDay = new Date(y, mo, 0).getDate();
      fromStr = `${yStr}-${mStr}-01`;
      toStr = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
      periodLabel = new Date(y, mo - 1, 1).toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      });
    } else {
      fromStr = `${y}-01-01`;
      toStr = `${y}-12-31`;
      periodLabel = `Year ${y}`;
    }

    const periodTxs = await prisma.fitness_transactions.findMany({
      where: {
        transaction_date: {
          gte: toPrismaDate(fromStr),
          lte: toPrismaDate(toStr),
        },
      },
      select: { type: true, received_inr: true, pending_inr: true, cost_inr: true },
    });

    const periodAgg = {
      diet_received: 0,
      diet_pending: 0,
      diet_cost: 0,
      diet_profit: 0,
      diet_count: 0,
      sup_received: 0,
      sup_pending: 0,
      sup_cost: 0,
      sup_profit: 0,
      sup_count: 0,
    };
    for (const t of periodTxs) {
      const rec = Number(t.received_inr || 0);
      const pend = Number(t.pending_inr || 0);
      const cost = Number(t.cost_inr || 0);
      if (t.type === "Supplement") {
        periodAgg.sup_received += rec;
        periodAgg.sup_pending += pend;
        periodAgg.sup_cost += cost;
        periodAgg.sup_profit += rec - cost;
        periodAgg.sup_count += 1;
      } else {
        periodAgg.diet_received += rec;
        periodAgg.diet_pending += pend;
        periodAgg.diet_cost += cost;
        periodAgg.diet_profit += rec - cost;
        periodAgg.diet_count += 1;
      }
    }

    const endYear = today.getFullYear();
    const startYear = endYear - 9;
    const yearTxs = await prisma.fitness_transactions.findMany({
      where: {
        transaction_date: {
          gte: new Date(startYear, 0, 1),
          lte: new Date(endYear, 11, 31),
        },
      },
      select: {
        transaction_date: true,
        type: true,
        received_inr: true,
        pending_inr: true,
        cost_inr: true,
      },
    });
    const byYear = new Map();
    for (const t of yearTxs) {
      const yr = t.transaction_date ? new Date(t.transaction_date).getFullYear() : null;
      if (!yr) continue;
      if (!byYear.has(yr)) {
        byYear.set(yr, {
          diet_received: 0,
          diet_pending: 0,
          diet_profit: 0,
          diet_count: 0,
          sup_received: 0,
          sup_pending: 0,
          sup_profit: 0,
          sup_count: 0,
        });
      }
      const r = byYear.get(yr);
      const rec = Number(t.received_inr || 0);
      const pend = Number(t.pending_inr || 0);
      const cost = Number(t.cost_inr || 0);
      if (t.type === "Supplement") {
        r.sup_received += rec;
        r.sup_pending += pend;
        r.sup_profit += rec - cost;
        r.sup_count += 1;
      } else {
        r.diet_received += rec;
        r.diet_pending += pend;
        r.diet_profit += rec - cost;
        r.diet_count += 1;
      }
    }

    const years = [];
    for (let yy = startYear; yy <= endYear; yy += 1) {
      const r = byYear.get(yy);
      years.push({
        year: yy,
        diet_course: {
          received: Number(r?.diet_received || 0),
          pending: Number(r?.diet_pending || 0),
          profit: Number(r?.diet_profit || 0),
          transactions: Number(r?.diet_count || 0),
        },
        supplements: {
          received: Number(r?.sup_received || 0),
          pending: Number(r?.sup_pending || 0),
          profit: Number(r?.sup_profit || 0),
          transactions: Number(r?.sup_count || 0),
        },
      });
    }

    const num = (v) => Number(v || 0);
    const {
      getClosedWonLostInRange,
      getClosedWonLostLifetime,
    } = require("../services/opportunityRevenueStats");
    const fromDateObj = new Date(`${fromStr}T00:00:00`);
    const toDateObj = new Date(`${toStr}T23:59:59`);
    const [windowClosed, lifetimeClosed] = await Promise.all([
      getClosedWonLostInRange(req, fromDateObj, toDateObj),
      getClosedWonLostLifetime(req),
    ]);

    res.json({
      success: true,
      data: {
        window,
        refDate: ref,
        range: { from: fromStr, to: toStr },
        periodLabel,
        diet_course: {
          sectionTitle: "Plans & diet programs",
          received: num(periodAgg.diet_received),
          pending: num(periodAgg.diet_pending),
          cost: num(periodAgg.diet_cost),
          profit: num(periodAgg.diet_profit),
          transactions: num(periodAgg.diet_count),
        },
        supplements: {
          sectionTitle: "Supplement sales",
          received: num(periodAgg.sup_received),
          pending: num(periodAgg.sup_pending),
          cost: num(periodAgg.sup_cost),
          profit: num(periodAgg.sup_profit),
          transactions: num(periodAgg.sup_count),
        },
        booked_closed_won: {
          count: windowClosed.closed_won_count,
          value: windowClosed.closed_won_value,
          value_this_window: windowClosed.closed_won_value,
          lifetime_count: lifetimeClosed.closed_won_count,
          lifetime_value: lifetimeClosed.closed_won_value,
        },
        closed_lost: {
          count: windowClosed.closed_lost_count,
          value: windowClosed.closed_lost_value,
          value_this_window: windowClosed.closed_lost_value,
          lifetime_count: lifetimeClosed.closed_lost_count,
          lifetime_value: lifetimeClosed.closed_lost_value,
        },
        years,
        yearRange: { from: startYear, to: endYear },
        classification: {
          diet_course:
            "Transaction types Membership and Other (plans, coaching, diet programs, misc services).",
          supplements: "Transaction type Supplement (product sales).",
          booked_closed_won:
            "Opportunity Closed Won final_amount for this window (booked, not cash).",
          closed_lost: "Opportunity Closed Lost forecast amounts for this window.",
        },
      },
    });
  } catch (error) {
    console.error("getRevenueSplit", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getAllReferrals(req, res) {
  try {
    const rows = await prisma.fitness_referrals.findMany({
      orderBy: { referral_date: "desc" },
    });
    const ids = [
      ...new Set([
        ...rows.map((r) => r.referrer_client_id),
        ...rows.map((r) => r.referred_client_id),
      ]),
    ];
    const clients = ids.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: ids } },
          select: { client_id: true, full_name: true, tier: true },
        })
      : [];
    const cmap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
    res.json({
      success: true,
      data: serializeFitnessRows(rows).map((fr) => ({
        ...fr,
        referrer_name: cmap[fr.referrer_client_id]?.full_name || null,
        referrer_client_id: fr.referrer_client_id,
        referrer_tier: cmap[fr.referrer_client_id]?.tier ?? null,
        referred_name: cmap[fr.referred_client_id]?.full_name || null,
        referred_client_id: fr.referred_client_id,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientReferrals(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_referrals.findMany({
      where: { referrer_client_id: clientId },
    });
    const ids = rows.map((r) => r.referred_client_id);
    const clients = ids.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: ids } },
          select: { client_id: true, full_name: true },
        })
      : [];
    const cmap = Object.fromEntries(clients.map((c) => [c.client_id, c.full_name]));
    res.json({
      success: true,
      data: serializeFitnessRows(rows).map((fr) => ({
        ...fr,
        referred_name: cmap[fr.referred_client_id] || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getReferralsReceived(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_clients.findMany({
      where: { referred_by_client_id: clientId },
      select: {
        client_id: true,
        full_name: true,
        tier: true,
        status: true,
        plan_start_date: true,
      },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createReferral(req, res) {
  try {
    const { referrer_client_id, referred_client_id, referral_date, notes } = req.body;

    const reqError = validateRequired(
      { referrer_client_id, referred_client_id },
      ["referrer_client_id", "referred_client_id"]
    );
    if (reqError) return sendValidationError(res, reqError);

    if (
      referrer_client_id &&
      (typeof referrer_client_id !== "string" || referrer_client_id.length > 20)
    ) {
      return sendValidationError(res, "Invalid referrer_client_id");
    }
    if (
      referred_client_id &&
      (typeof referred_client_id !== "string" || referred_client_id.length > 20)
    ) {
      return sendValidationError(res, "Invalid referred_client_id");
    }
    if (referral_date) {
      const err = validateDate(referral_date, "referral_date");
      if (err) return sendValidationError(res, err);
    }
    if (referrer_client_id === referred_client_id) {
      return sendValidationError(res, "Referrer and referred cannot be the same client");
    }

    const created = await prisma.fitness_referrals.create({
      data: {
        referrer_client_id,
        referred_client_id,
        referral_date: toPrismaDate(referral_date) || new Date(),
        notes: notes ?? null,
      },
    });

    const [rc, nc] = await Promise.all([
      prisma.fitness_clients.findUnique({
        where: { client_id: referrer_client_id },
        select: { full_name: true },
      }),
      prisma.fitness_clients.findUnique({
        where: { client_id: referred_client_id },
        select: { full_name: true },
      }),
    ]);

    emitFitnessChanged();
    res.status(201).json({
      success: true,
      data: {
        ...serializeFitnessRow(created),
        referrer_name: rc?.full_name || null,
        referred_name: nc?.full_name || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteReferral(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_referrals.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Referral not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientTasks(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_client_tasks.findMany({
      where: { client_id: clientId },
      orderBy: { due_date: "asc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createClientTask(req, res) {
  try {
    const { clientId } = req.params;
    const { task_description, due_date, priority, status, period, notes } = req.body;

    if (!clientId || typeof clientId !== "string") {
      return sendValidationError(res, "Invalid client ID");
    }
    const reqError = validateRequired({ task_description }, ["task_description"]);
    if (reqError) return sendValidationError(res, reqError);

    if (due_date) {
      const err = validateDate(due_date, "due_date");
      if (err) return sendValidationError(res, err);
    }
    if (priority) {
      const err = validateEnum(priority, VALID_ENUMS.task_priority, "priority");
      if (err) return sendValidationError(res, err);
    }
    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, "status");
      if (err) return sendValidationError(res, err);
    }

    const created = await prisma.fitness_client_tasks.create({
      data: {
        client_id: clientId,
        task_description,
        due_date: toPrismaDate(due_date),
        priority: priority || "Medium",
        status: toPrismaTaskStatus(status || "Open"),
        period: period ?? null,
        notes: notes ?? null,
      },
    });
    emitFitnessChanged();
    res.status(201).json({ success: true, data: serializeFitnessRow(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateClientTask(req, res) {
  try {
    const { id } = req.params;
    const { task_description, due_date, priority, status, period, completed_on, notes } =
      req.body;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, "Invalid task ID");

    if (due_date) {
      const err = validateDate(due_date, "due_date");
      if (err) return sendValidationError(res, err);
    }
    if (priority) {
      const err = validateEnum(priority, VALID_ENUMS.task_priority, "priority");
      if (err) return sendValidationError(res, err);
    }
    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, "status");
      if (err) return sendValidationError(res, err);
    }
    if (completed_on) {
      const err = validateDate(completed_on, "completed_on");
      if (err) return sendValidationError(res, err);
    }

    try {
      const updated = await prisma.fitness_client_tasks.update({
        where: { id: idNum },
        data: {
          task_description,
          due_date: toPrismaDate(due_date),
          priority: priority ?? null,
          status: status != null ? toPrismaTaskStatus(status) : null,
          period: period ?? null,
          completed_on: toPrismaDate(completed_on),
          notes: notes ?? null,
          updated_at: new Date(),
        },
      });
      emitFitnessChanged();
      res.json({ success: true, data: serializeFitnessRow(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function patchClientTaskStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, completed_on } = req.body;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, "Invalid task ID");

    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, "status");
      if (err) return sendValidationError(res, err);
    }
    if (completed_on) {
      const err = validateDate(completed_on, "completed_on");
      if (err) return sendValidationError(res, err);
    }

    try {
      const updated = await prisma.fitness_client_tasks.update({
        where: { id: idNum },
        data: {
          status: status != null ? toPrismaTaskStatus(status) : undefined,
          completed_on: toPrismaDate(completed_on),
          updated_at: new Date(),
        },
      });
      await syncClientNextDueFromCompleted(updated.client_id, updated.completed_on);
      emitFitnessChanged();
      res.json({ success: true, data: serializeFitnessRow(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteClientTask(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_client_tasks.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAllMealPlans(req, res) {
  try {
    const rows = await prisma.fitness_meal_plans.findMany({
      orderBy: { created_at: "desc" },
    });
    const ids = [...new Set(rows.map((r) => r.client_id))];
    const clients = ids.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: ids } },
          select: { client_id: true, full_name: true },
        })
      : [];
    const cmap = Object.fromEntries(clients.map((c) => [c.client_id, c.full_name]));
    res.json({
      success: true,
      data: serializeFitnessRows(rows).map((mp) => ({
        ...mp,
        full_name: cmap[mp.client_id] || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getMealPlans(req, res) {
  try {
    const { clientId } = req.params;
    const rows = await prisma.fitness_meal_plans.findMany({
      where: { client_id: clientId },
      orderBy: { created_at: "desc" },
    });
    res.json({ success: true, data: serializeFitnessRows(rows) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createMealPlan(req, res) {
  try {
    const { clientId } = req.params;
    const {
      plan_name,
      start_date,
      end_date,
      calories,
      protein_g,
      carbs_g,
      fats_g,
      plan_pdf_url,
      notes,
    } = req.body;

    if (!clientId) return sendValidationError(res, "Client ID required");
    if (!plan_name) return sendValidationError(res, "Plan name required");

    const created = await prisma.fitness_meal_plans.create({
      data: {
        client_id: clientId,
        plan_name,
        start_date: toPrismaDate(start_date),
        end_date: toPrismaDate(end_date),
        calories: calories != null ? Number(calories) : null,
        protein_g: protein_g != null ? Number(protein_g) : null,
        carbs_g: carbs_g != null ? Number(carbs_g) : null,
        fats_g: fats_g != null ? Number(fats_g) : null,
        plan_pdf_url: plan_pdf_url ?? null,
        notes: notes ?? null,
      },
    });
    emitFitnessChanged();
    res.status(201).json({ success: true, data: serializeFitnessRow(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteMealPlan(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.fitness_meal_plans.deleteMany({
      where: { id: Number(id) },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Meal plan not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getDashboardStats(req, res) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const todayMs = today.getTime();
    const nextWeekMs = nextWeek.getTime();

    const [clients, consultCount, notifs] = await Promise.all([
      prisma.fitness_clients.findMany({
        select: {
          status: true,
          progress: true,
          next_due_date: true,
          plan_expiry_date: true,
          tier: true,
        },
      }),
      prisma.fitness_consultations.count({
        where: { consult_date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.notifications.findMany({
        where: {
          user_id: Number(req.user.id),
          entity_type: { in: ["fitness_expiry", "fitness_due"] },
          is_read: false,
        },
        orderBy: { created_at: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          body: true,
          created_at: true,
          entity_type: true,
          entity_id: true,
        },
      }),
    ]);

    let active = 0;
    let onHold = 0;
    let needAttention = 0;
    let overdueFollowups = 0;
    let expiringSoon = 0;
    let fiveStar = 0;
    let highRisk = 0;
    for (const c of clients) {
      const status = String(c.status || "");
      const progress = String(c.progress || "");
      const dueMs = c.next_due_date ? new Date(c.next_due_date).getTime() : NaN;
      const expiryMs = c.plan_expiry_date ? new Date(c.plan_expiry_date).getTime() : NaN;
      if (status === "Active") active += 1;
      if (status === "Hold") onHold += 1;
      if (progress === "Poor" || progress === "Very_Poor") needAttention += 1;
      if (status === "Active" && Number.isFinite(dueMs) && dueMs < todayMs) overdueFollowups += 1;
      if (
        status === "Active" &&
        Number.isFinite(expiryMs) &&
        expiryMs >= todayMs &&
        expiryMs <= nextWeekMs
      ) {
        expiringSoon += 1;
      }
      if (Number(c.tier) === 5) fiveStar += 1;
      if (
        progress === "Poor" ||
        progress === "Very_Poor" ||
        (Number.isFinite(dueMs) && dueMs < todayMs) ||
        (Number.isFinite(expiryMs) && expiryMs <= nextWeekMs)
      ) {
        highRisk += 1;
      }
    }

    const seen = new Set();
    const notifRows = [];
    for (const n of notifs) {
      const key = `${n.entity_type}|${n.entity_id}|${n.title}|${n.body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notifRows.push({
        id: n.id,
        title: n.title,
        body: n.body,
        created_at: n.created_at,
        entity_type: n.entity_type,
      });
      if (notifRows.length >= 5) break;
    }

    res.json({
      success: true,
      data: {
        active_clients: active || 0,
        on_hold: onHold || 0,
        need_attention: needAttention || 0,
        overdue_followups: overdueFollowups || 0,
        expiring_soon: expiringSoon || 0,
        five_star_clients: fiveStar || 0,
        monthly_consultations: consultCount || 0,
        high_risk_clients: highRisk || 0,
        proactive_alerts: notifRows,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsSources(req, res) {
  try {
    const grouped = await prisma.fitness_clients.groupBy({
      by: ["source"],
      where: { source: { not: null } },
      _count: { _all: true },
      _avg: { tier: true },
    });
    const total = grouped.reduce((s, r) => s + r._count._all, 0);
    const data = grouped
      .map((r) => {
        const source = serializeFitnessRow({ source: r.source }).source;
        return {
          source,
          client_count: r._count._all,
          avg_tier:
            r._avg.tier != null ? Math.round(Number(r._avg.tier) * 10) / 10 : null,
          pct_of_total: total ? Math.round((r._count._all / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.client_count - a.client_count);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsTiers(req, res) {
  try {
    const grouped = await prisma.fitness_clients.groupBy({
      by: ["tier"],
      _count: { _all: true },
    });
    const total = await prisma.fitness_clients.count();
    const data = grouped
      .map((r) => ({
        tier: r.tier,
        client_count: r._count._all,
        pct_of_total: total ? Math.round((r._count._all / total) * 100) : 0,
      }))
      .sort((a, b) => (b.tier || 0) - (a.tier || 0));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsReferrers(req, res) {
  try {
    const refs = await prisma.fitness_referrals.groupBy({
      by: ["referrer_client_id"],
      _count: { _all: true },
      orderBy: { _count: { referrer_client_id: "desc" } },
      take: 10,
    });
    const ids = refs.map((r) => r.referrer_client_id);
    const clients = ids.length
      ? await prisma.fitness_clients.findMany({
          where: { client_id: { in: ids } },
          select: {
            client_id: true,
            full_name: true,
            tier: true,
            source: true,
          },
        })
      : [];
    const cmap = Object.fromEntries(clients.map((c) => [c.client_id, c]));
    const data = refs.map((r) => {
      const c = cmap[r.referrer_client_id] || {};
      return {
        client_id: r.referrer_client_id,
        full_name: c.full_name || null,
        tier: c.tier ?? null,
        source: serializeFitnessRow({ source: c.source }).source ?? null,
        referral_count: r._count._all,
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsFinancial(req, res) {
  try {
    const currentYear = new Date().getFullYear();
    const txs = await prisma.fitness_transactions.findMany({
      where: {
        transaction_date: {
          gte: new Date(currentYear, 0, 1),
          lte: new Date(currentYear, 11, 31),
        },
      },
      select: {
        transaction_date: true,
        received_inr: true,
        pending_inr: true,
        cost_inr: true,
      },
    });
    const byMonth = {};
    for (const t of txs) {
      const month = toYmd(t.transaction_date)?.slice(0, 7);
      if (!month) continue;
      if (!byMonth[month]) {
        byMonth[month] = { month, received: 0, pending: 0, cost: 0, profit: 0 };
      }
      const rec = Number(t.received_inr || 0);
      const cost = Number(t.cost_inr || 0);
      byMonth[month].received += rec;
      byMonth[month].pending += Number(t.pending_inr || 0);
      byMonth[month].cost += cost;
      byMonth[month].profit += rec - cost;
    }
    const rows = Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1));
    res.json({ success: true, data: rows.slice(-3) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

const importClientsExcel = async (req, res) => {
  if (!req.file) {
    console.log("[Import] No file uploaded");
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const tmpPath = req.file.path;
  try {
    console.log("[Import] Reading file:", tmpPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tmpPath);

    const masterSheet =
      workbook.worksheets.find((ws) => String(ws.name || "").includes("MASTER")) || null;

    if (!masterSheet) {
      console.log(
        "[Import] MASTER sheet not found. Available:",
        workbook.worksheets.map((ws) => ws.name)
      );
      return res.status(400).json({
        success: false,
        message: "Invalid file format: MASTER sheet not found",
      });
    }

    const sheetToAoA = (ws) => {
      const data = [];
      ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const arr = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          arr[colNumber - 1] = cell.value != null && typeof cell.value === "object" && cell.value.text != null
            ? cell.value.text
            : cell.value instanceof Date
              ? cell.value
              : cell.value;
        });
        data[rowNumber - 1] = arr;
      });
      return data;
    };

    const masterData = sheetToAoA(masterSheet);
    const clientIds = [];
    for (let i = 0; i < masterData.length; i++) {
      const row = masterData[i];
      if (row && row[0] && String(row[0]).startsWith("FV-")) {
        clientIds.push(row[0]);
      }
    }

    console.log(`[Import] Found ${clientIds.length} client IDs`);

    const importedClients = [];
    const errors = [];

    for (const clientId of clientIds) {
      const clientSheet = workbook.getWorksheet(clientId);
      if (!clientSheet) {
        errors.push(`Sheet for ${clientId} not found`);
        continue;
      }

      const sheetData = sheetToAoA(clientSheet);
      const getVal = (row, col) => {
        const v = sheetData[row] ? sheetData[row][col] : null;
        return v === undefined ? null : v;
      };

      const client = {
        client_id: clientId,
        full_name: getVal(9, 2),
        age: getVal(9, 5),
        phone: String(getVal(10, 5) || ""),
        email: getVal(11, 5),
        city: getVal(11, 2),
        address: getVal(12, 2),
        occupation: getVal(12, 5),
        health_goal: getVal(16, 2),
        plan_type: getVal(16, 5),
        plan_start_date: getVal(17, 2),
        plan_expiry_date: getVal(18, 2),
        height_cm: getVal(23, 2),
        start_weight_kg: getVal(23, 5),
        current_weight_kg: getVal(24, 2),
        target_weight_kg: getVal(24, 5),
        bmi: getVal(25, 2),
        referred_by_name: getVal(13, 2),
        status: getVal(5, 4) || "Active",
        progress: getVal(5, 3) || "Good",
        next_due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
      };

      try {
        const data = {
          full_name: client.full_name,
          age: client.age != null ? Number(client.age) : null,
          phone: client.phone,
          email: client.email,
          city: client.city,
          address: client.address,
          occupation: client.occupation,
          health_goal: client.health_goal,
          plan_type: client.plan_type ? toPrismaPlan(client.plan_type) : null,
          plan_start_date: toPrismaDate(client.plan_start_date),
          plan_expiry_date: toPrismaDate(client.plan_expiry_date),
          height_cm: client.height_cm != null ? Number(client.height_cm) : null,
          start_weight_kg:
            client.start_weight_kg != null ? Number(client.start_weight_kg) : null,
          current_weight_kg:
            client.current_weight_kg != null ? Number(client.current_weight_kg) : null,
          target_weight_kg:
            client.target_weight_kg != null ? Number(client.target_weight_kg) : null,
          bmi: client.bmi != null ? Number(client.bmi) : null,
          referred_by_name: client.referred_by_name,
          status: client.status || "Active",
          progress: toPrismaProgress(client.progress || "Good"),
          next_due_date: toPrismaDate(client.next_due_date),
          updated_at: new Date(),
        };

        const existing = await prisma.fitness_clients.findUnique({
          where: { client_id: clientId },
          select: { id: true },
        });

        let synced;
        if (existing) {
          synced = await prisma.fitness_clients.update({
            where: { client_id: clientId },
            data,
          });
        } else {
          synced = await prisma.fitness_clients.create({
            data: { client_id: clientId, ...data },
          });
        }
        await syncClientDueTask(synced, req.user?.id);
        importedClients.push(clientId);
      } catch (dbError) {
        console.error(`[Import] DB Error for ${clientId}:`, dbError.message);
        errors.push(`Error importing ${clientId}: ${dbError.message}`);
      }
    }

    emitFitnessAndDueTaskChanged("client_due_import");
    res.json({
      success: true,
      data: { importedCount: importedClients.length, errors },
    });
  } catch (err) {
    console.error("[Import] Fatal Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to import clients: " + err.message,
    });
  } finally {
    try {
      if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
};

const exportClientsExcel = async (req, res) => {
  try {
    const clients = await prisma.fitness_clients.findMany({
      orderBy: { created_at: "desc" },
    });
    const rows = serializeFitnessRows(clients);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Clients");
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      worksheet.columns = keys.map((key) => ({ header: key, key }));
      worksheet.addRows(rows);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    res.setHeader("Content-Disposition", "attachment; filename=fitness_clients.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: "Failed to export clients" });
  }
};


module.exports = {
  // Settings
  getFitnessSettings,
  updateFitnessSettings,
  // Clients
  getAllClients,
  searchClients,
  getClientSummary,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  // Consultations
  getAllConsultations,
  getConsultations,
  createConsultation,
  updateConsultation,
  deleteConsultation,
  // Body Stats
  getBodyStats,
  createBodyStat,
  deleteBodyStat,
  // Supplements
  getSupplements,
  createSupplement,
  updateSupplement,
  deleteSupplement,
  // Transactions
  getAllTransactions,
  getClientTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getTransactionSummary,
  getFitnessTransactionCharts,
  getRevenueSplit,
  getExternalBuyers,
  getExternalStats,
  searchExternalBuyers,
  // Referrals
  getAllReferrals,
  getClientReferrals,
  getReferralsReceived,
  createReferral,
  deleteReferral,
  // Client Tasks
  getClientTasks,
  createClientTask,
  updateClientTask,
  patchClientTaskStatus,
  deleteClientTask,
  // Dashboard / Analytics
  getDashboardStats,
  getAnalyticsSources,
  getAnalyticsTiers,
  getAnalyticsReferrers,
  getAnalyticsFinancial,
  // Meal Plans
  getAllMealPlans,
  getMealPlans,
  createMealPlan,
  deleteMealPlan,
  importClientsExcel,
  exportClientsExcel,
};