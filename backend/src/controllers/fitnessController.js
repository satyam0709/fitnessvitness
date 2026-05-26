const { mainPool } = require("../config/database");
const {
  emitCalendarChanged,
  emitFitnessChanged,
  emitTasksChanged,
} = require("../realtime/meetingsRealtime");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const { generateClientId, computeClientFields } = require("../services/fitnessComputedFields");
const { body, validationResult } = require("express-validator");

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

const tableExistsCache = new Map();
const tableColumnsCache = new Map();

async function tableExists(tableName) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const [rows] = await mainPool.execute(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName]
  );
  const exists = rows.length > 0;
  tableExistsCache.set(tableName, exists);
  return exists;
}

async function tableColumns(tableName) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  const [rows] = await mainPool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const cols = new Set(rows.map((r) => r.COLUMN_NAME));
  tableColumnsCache.set(tableName, cols);
  return cols;
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

async function syncClientDueTask(clientRow, actorUserId) {
  if (!clientRow?.id || !(await tableExists("tasks"))) return false;
  const cols = await tableColumns("tasks");
  const required = ["title", "created_by", "due_date", "status", "client_id", "task_category", "task_type"];
  if (!required.every((c) => cols.has(c))) return false;

  const hasDescription = cols.has("description");
  const hasAssignedTo = cols.has("assigned_to");
  const hasPriority = cols.has("priority");
  const hasUpdatedAt = cols.has("updated_at");
  const clientDbId = Number(clientRow.id);
  const dueDate = normalizeDateOnly(clientRow.next_due_date);
  const isActive = String(clientRow.status || "Active") === "Active";

  const [existing] = await mainPool.execute(
    `SELECT id FROM tasks
     WHERE client_id = ?
       AND task_category = 'client_due'
       AND task_type = 'client_due'
     ORDER BY id DESC
     LIMIT 1`,
    [clientDbId]
  );
  const taskId = existing[0]?.id;

  if (!dueDate || !isActive) {
    if (!taskId) return false;
    const updates = ["status = 'done'"];
    if (hasUpdatedAt) updates.push("updated_at = NOW()");
    await mainPool.execute(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, [taskId]);
    return true;
  }

  const title = `Follow-up due: ${clientRow.full_name || clientRow.client_id}`;
  const description = `Client ${clientRow.client_id} needs attention on ${dueDate}.`;

  if (taskId) {
    const updates = ["title = ?", "due_date = ?", "status = 'new'"];
    const params = [title, dueDate];
    if (hasDescription) {
      updates.push("description = ?");
      params.push(description);
    }
    if (hasAssignedTo && actorUserId) {
      updates.push("assigned_to = COALESCE(assigned_to, ?)");
      params.push(Number(actorUserId));
    }
    if (hasPriority) updates.push("priority = 'medium'");
    if (hasUpdatedAt) updates.push("updated_at = NOW()");
    params.push(taskId);
    await mainPool.execute(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, params);
    return true;
  }

  const fields = ["title", "client_id", "created_by", "due_date", "status"];
  const values = [title, clientDbId, Number(actorUserId) || null, dueDate, "new"];
  if (hasDescription) {
    fields.push("description");
    values.push(description);
  }
  if (hasAssignedTo) {
    fields.push("assigned_to");
    values.push(Number(actorUserId) || null);
  }
  if (hasPriority) {
    fields.push("priority");
    values.push("medium");
  }
  fields.push("task_category");
  values.push("client_due");
  fields.push("task_type");
  values.push("client_due");
  if (cols.has("frequency")) {
    fields.push("frequency");
    values.push("once");
  }

  const placeholders = fields.map(() => "?").join(", ");
  await mainPool.execute(
    `INSERT INTO tasks (${fields.map((f) => `\`${f}\``).join(", ")}) VALUES (${placeholders})`,
    values
  );
  return true;
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
    const [rows] = await mainPool.execute("SELECT * FROM fitness_settings");
    const settings = {};
    for (const row of rows) {
      settings[row.setting_key] = typeof row.setting_value === 'string'
        ? JSON.parse(row.setting_value)
        : row.setting_value;
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateFitnessSettings(req, res) {
  try {
    // Accept either full settings object or single key/value
    const settings = req.body;
    if (typeof settings !== "object" || settings === null) {
      return res.status(400).json({ success: false, message: "Invalid settings object" });
    }

    // If single key/value pair
    if (settings.key && settings.value !== undefined) {
      await mainPool.execute(
        "INSERT INTO fitness_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
        [settings.key, JSON.stringify(settings.value), JSON.stringify(settings.value)]
      );
    } else {
      // Update multiple settings at once
      for (const [key, value] of Object.entries(settings)) {
        await mainPool.execute(
          "INSERT INTO fitness_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?",
          [key, JSON.stringify(value), JSON.stringify(value)]
        );
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────
async function getAllClients(req, res) {
  try {
    const { status, search, sort } = req.query;
    const statusRaw = String(status || "").trim();
    const isOverdueView = statusRaw === "Overdue";
    const isHighRiskView = statusRaw === "High Risk";
    const isNextDueView =
      statusRaw === "Next Due" || String(sort || "").toLowerCase() === "next_due";
    const isSpecialView = isOverdueView || isHighRiskView || isNextDueView;

    let query = "SELECT * FROM fitness_clients WHERE 1=1";
    const params = [];

    if (statusRaw && !isSpecialView) {
      query += " AND status = ?";
      params.push(statusRaw);
    }

    // Narrow SQL for virtual tabs (same rules as dashboard list stats)
    if (isOverdueView) {
      query += " AND status = 'Active'";
    } else if (isHighRiskView) {
      query += " AND status != 'Inactive'";
    } else if (isNextDueView) {
      query += " AND status != 'Inactive' AND next_due_date IS NOT NULL";
    }

    if (search) {
      query += " AND (full_name LIKE ? OR client_id LIKE ? OR phone LIKE ? OR email LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (isNextDueView) {
      query += " ORDER BY next_due_date ASC, full_name ASC";
    } else {
      query += " ORDER BY created_at DESC";
    }
    const [rows] = await mainPool.execute(query, params);
    let computed = rows.map(computeClientFields);

    if (isOverdueView) {
      computed = computed.filter((c) => c.follow_up_priority === "🔴 OVERDUE");
    } else if (isHighRiskView) {
      computed = computed.filter((c) => c.is_high_risk);
    }

    res.json({ success: true, data: computed });
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
    const searchTerm = `%${q}%`;
    const [rows] = await mainPool.execute(
      `SELECT client_id, full_name, phone, status, tier
       FROM fitness_clients
       WHERE status != 'Inactive' AND (client_id LIKE ? OR full_name LIKE ? OR phone LIKE ? OR email LIKE ?)
       LIMIT 20`,
      [searchTerm, searchTerm, searchTerm, searchTerm]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientSummary(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(`
      SELECT client_id, full_name, status, progress, plan_type, plan_start_date,
             plan_expiry_date, last_consultation_date, next_due_date, tier, source
      FROM fitness_clients WHERE client_id = ?`, [clientId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: computeClientFields(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientById(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(`
      SELECT * FROM fitness_clients WHERE client_id = ?`, [clientId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const client = computeClientFields(rows[0]);

    // Fetch related data
    const [consultations] = await mainPool.execute(
      "SELECT * FROM fitness_consultations WHERE client_id = ? ORDER BY consult_date DESC",
      [clientId]
    );
    const [bodyStats] = await mainPool.execute(
      "SELECT * FROM fitness_body_stats WHERE client_id = ? ORDER BY recorded_date DESC",
      [clientId]
    );
    const [supplements] = await mainPool.execute(
      "SELECT * FROM fitness_supplements WHERE client_id = ? ORDER BY prescribed_date DESC",
      [clientId]
    );
    const [transactions] = await mainPool.execute(
      "SELECT * FROM fitness_transactions WHERE client_id = ? ORDER BY transaction_date DESC",
      [clientId]
    );
    const [tasks] = await mainPool.execute(
      "SELECT * FROM fitness_client_tasks WHERE client_id = ? ORDER BY due_date ASC",
      [clientId]
    );
    const [referralsGiven] = await mainPool.execute(`
      SELECT fr.*, fc.full_name as referred_name
      FROM fitness_referrals fr
      JOIN fitness_clients fc ON fr.referred_client_id = fc.client_id
      WHERE fr.referrer_client_id = ?`, [clientId]);
    const [referralsReceived] = await mainPool.execute(`
      SELECT fr.*, fc.full_name as referrer_name
      FROM fitness_referrals fr
      JOIN fitness_clients fc ON fr.referrer_client_id = fc.client_id
      WHERE fr.referred_client_id = ?`, [clientId]);

    res.json({
      success: true,
      data: {
        ...client,
        consultations,
        body_stats: bodyStats,
        supplements,
        transactions,
        tasks,
        referrals_given: referralsGiven,
        referrals_received: referralsReceived,
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

    // Get next client ID
    const [[{ count }]] = await mainPool.execute(
      "SELECT COUNT(*) as count FROM fitness_clients"
    );
    const clientId = generateClientId(count);

    // Calculate derived fields
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

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_clients (
        client_id, full_name, phone, email, age, city, address, occupation, emergency_contact,
        referred_by_client_id, referred_by_name, source, tier, health_goal, plan_type, plan_start_date,
        plan_expiry_date, next_due_date, follow_up_freq_days, medical_conditions, allergies, activity_level,
        current_medications, height_cm, start_weight_kg, current_weight_kg, target_weight_kg, bmi,
        status, progress
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId, full_name, phone, email, age, city, address, occupation, emergency_contact,
        referred_by_client_id || null, referred_by_name || null, source || "Walk-in", tier || 3,
        health_goal, plan_type, plan_start_date, plan_expiry_date, next_due_date, follow_up_freq_days || 14,
        medical_conditions, allergies, activity_level, current_medications,
        height_cm, start_weight_kg, current_weight_kg, target_weight_kg, bmi,
        status || "Active", progress || "Neutral",
      ]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_clients WHERE id = ?", [result.insertId]
    );

    const taskChanged = await syncClientDueTask(rows[0], req.user?.id);
    if (taskChanged) emitFitnessAndDueTaskChanged("client_due_create");
    else emitFitnessChanged();
    res.status(201).json({ success: true, data: computeClientFields(rows[0]) });
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

    // Build dynamic update
    const allowedFields = [
      'full_name', 'status', 'progress', 'phone', 'email', 'age', 'city', 'address',
      'occupation', 'emergency_contact', 'referred_by_client_id', 'source', 'tier',
      'health_goal', 'plan_type', 'plan_start_date', 'plan_expiry_date', 'follow_up_freq_days',
      'last_consultation_date', 'next_due_date', 'medical_conditions', 'allergies',
      'activity_level', 'current_medications', 'height_cm', 'start_weight_kg',
      'current_weight_kg', 'target_weight_kg', 'coach_notes'
    ];

    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowedFields.includes(key)) {
        updates.push(`\`${key}\` = ?`);
        values.push(emptyToNull(value));
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    // Recalculate BMI if height or weight changed
    if (fields.height_cm || fields.current_weight_kg) {
      const [client] = await mainPool.execute(
        "SELECT height_cm, current_weight_kg FROM fitness_clients WHERE client_id = ?",
        [clientId]
      );
      const height = fields.height_cm ?? client[0]?.height_cm;
      const weight = fields.current_weight_kg ?? client[0]?.current_weight_kg;
      if (height && weight) {
        const { calculateBMI } = require("../services/fitnessComputedFields");
        const bmi = calculateBMI(height, weight);
        updates.push('bmi = ?');
        values.push(bmi);
      }
    }

    values.push(clientId);
    await mainPool.execute(
      `UPDATE fitness_clients SET ${updates.join(', ')} WHERE client_id = ?`,
      values
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_clients WHERE client_id = ?", [clientId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const taskChanged = await syncClientDueTask(rows[0], req.user?.id);
    if (taskChanged) emitFitnessAndDueTaskChanged("client_due_update");
    else emitFitnessChanged();
    res.json({ success: true, data: computeClientFields(rows[0]) });
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
      const [result] = await mainPool.execute(
        "UPDATE fitness_clients SET status = 'Inactive' WHERE client_id = ?",
        [clientId]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
      emitFitnessChanged();
      return res.json({ success: true, message: "Client marked as inactive" });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  const conn = await mainPool.getConnection();
  try {
    await conn.beginTransaction();
    const [clients] = await conn.execute(
      "SELECT id FROM fitness_clients WHERE client_id = ? FOR UPDATE",
      [clientId]
    );
    if (!clients.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    const internalId = clients[0].id;

    await conn.execute(
      `DELETE FROM notifications WHERE entity_type IN ('fitness_expiry', 'fitness_due') AND entity_id = ?`,
      [internalId]
    );
    await conn.execute(
      `DELETE FROM fitness_referrals WHERE referrer_client_id = ? OR referred_client_id = ?`,
      [clientId, clientId]
    );
    await conn.execute(`DELETE FROM fitness_meal_plans WHERE client_id = ?`, [clientId]);
    await conn.execute(`DELETE FROM fitness_client_tasks WHERE client_id = ?`, [clientId]);
    await conn.execute(`DELETE FROM fitness_supplements WHERE client_id = ?`, [clientId]);
    await conn.execute(`DELETE FROM fitness_transactions WHERE client_id = ?`, [clientId]);
    await conn.execute(`DELETE FROM fitness_body_stats WHERE client_id = ?`, [clientId]);
    await conn.execute(`DELETE FROM fitness_consultations WHERE client_id = ?`, [clientId]);
    await conn.execute(
      `UPDATE fitness_clients SET referred_by_client_id = NULL WHERE referred_by_client_id = ?`,
      [clientId]
    );
    const [delResult] = await conn.execute(
      `DELETE FROM fitness_clients WHERE client_id = ?`,
      [clientId]
    );
    if (delResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    await conn.commit();
    emitFitnessChanged();
    res.json({
      success: true,
      message: "Client and all related fitness records were removed from the database",
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────
async function getAllConsultations(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT c.*, fc.full_name, fc.status as client_status
      FROM fitness_consultations c
      JOIN fitness_clients fc ON c.client_id = fc.client_id
      ORDER BY c.consult_date DESC
      LIMIT 500
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getConsultations(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_consultations WHERE client_id = ? ORDER BY consult_date DESC",
      [clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createConsultation(req, res) {
  try {
    const { clientId } = req.params;
    const { consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment } = req.body;

    // Express-validator validation
    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    // Existing validation
    if (!clientId || typeof clientId !== 'string') {
      return sendValidationError(res, 'Invalid client ID');
    }
    const reqError = validateRequired({ consult_date, consult_type }, ['consult_date', 'consult_type']);
    if (reqError) return sendValidationError(res, reqError);

    const dateErr = validateDate(consult_date, 'consult_date');
    if (dateErr) return sendValidationError(res, dateErr);

    const typeErr = validateEnum(consult_type, VALID_ENUMS.consult_type, 'consult_type');
    if (typeErr) return sendValidationError(res, typeErr);

    if (weight_kg !== undefined) {
      const weightErr = validateNumber(weight_kg, 'weight_kg', 1, 500);
      if (weightErr) return sendValidationError(res, weightErr);
    }

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_consultations (client_id, consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment]
    );

    // Update client's last_consultation_date and recalculate next_due_date
    await mainPool.execute(
      "UPDATE fitness_clients SET last_consultation_date = ? WHERE client_id = ?",
      [consult_date, clientId]
    );

    // Recalculate next_due_date
    const [client] = await mainPool.execute(
      "SELECT follow_up_freq_days FROM fitness_clients WHERE client_id = ?", [clientId]
    );
    if (client.length && client[0].follow_up_freq_days) {
      const { calculateNextDueDate } = require("../services/fitnessComputedFields");
      const nextDue = calculateNextDueDate(consult_date, client[0].follow_up_freq_days);
      if (nextDue) {
        await mainPool.execute(
          "UPDATE fitness_clients SET next_due_date = ? WHERE client_id = ?",
          [nextDue, clientId]
        );
      }
    }

    const [clientRows] = await mainPool.execute(
      "SELECT * FROM fitness_clients WHERE client_id = ?",
      [clientId]
    );
    const taskChanged = clientRows[0]
      ? await syncClientDueTask(clientRows[0], req.user?.id)
      : false;

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_consultations WHERE id = ?", [result.insertId]
    );
    if (taskChanged) emitFitnessAndDueTaskChanged("client_due_consultation");
    else emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateConsultation(req, res) {
  try {
    const { id } = req.params;
    const { consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid consultation ID');

    if (consult_date) {
      const err = validateDate(consult_date, 'consult_date');
      if (err) return sendValidationError(res, err);
    }
    if (consult_type) {
      const err = validateEnum(consult_type, VALID_ENUMS.consult_type, 'consult_type');
      if (err) return sendValidationError(res, err);
    }
    if (weight_kg !== undefined) {
      const err = validateNumber(weight_kg, 'weight_kg', 1, 500);
      if (err) return sendValidationError(res, err);
    }

    await mainPool.execute(
      `UPDATE fitness_consultations
       SET consult_date = ?, consult_type = ?, weight_kg = ?, key_observations = ?, diet_changes = ?, next_steps = ?, next_appointment = ?
       WHERE id = ?`,
      [consult_date, consult_type, weight_kg, key_observations, diet_changes, next_steps, next_appointment, id]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_consultations WHERE id = ?", [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Consultation not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteConsultation(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_consultations WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
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
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_body_stats WHERE client_id = ? ORDER BY recorded_date DESC",
      [clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createBodyStat(req, res) {
  try {
    const { clientId } = req.params;
    const { recorded_date, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, notes } = req.body;

    // Validation
    if (!clientId || typeof clientId !== 'string') {
      return sendValidationError(res, 'Invalid client ID');
    }
    const reqError = validateRequired({ recorded_date }, ['recorded_date']);
    if (reqError) return sendValidationError(res, reqError);

    const dateErr = validateDate(recorded_date, 'recorded_date');
    if (dateErr) return sendValidationError(res, dateErr);

    if (weight_kg !== undefined) {
      const err = validateNumber(weight_kg, 'weight_kg', 1, 500);
      if (err) return sendValidationError(res, err);
    }
    if (body_fat_pct !== undefined) {
      const err = validateNumber(body_fat_pct, 'body_fat_pct', 0, 100);
      if (err) return sendValidationError(res, err);
    }
    if (waist_cm !== undefined) {
      const err = validateNumber(waist_cm, 'waist_cm', 1, 300);
      if (err) return sendValidationError(res, err);
    }

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_body_stats (client_id, recorded_date, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clientId, recorded_date, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, notes]
    );

    // Update current_weight_kg on client
    if (weight_kg) {
      const { calculateBMI } = require("../services/fitnessComputedFields");
      const [client] = await mainPool.execute(
        "SELECT height_cm FROM fitness_clients WHERE client_id = ?", [clientId]
      );
      let bmi = null;
      if (client.length && client[0].height_cm) {
        bmi = calculateBMI(client[0].height_cm, weight_kg);
      }
      await mainPool.execute(
        "UPDATE fitness_clients SET current_weight_kg = ?, bmi = ? WHERE client_id = ?",
        [weight_kg, bmi, clientId]
      );
    }

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_body_stats WHERE id = ?", [result.insertId]
    );
    emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteBodyStat(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_body_stats WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
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
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_supplements WHERE client_id = ? ORDER BY prescribed_date DESC",
      [clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createSupplement(req, res) {
  try {
    const { clientId } = req.params;
    const { product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes } = req.body;

    // Validation
    if (!clientId || typeof clientId !== 'string') {
      return sendValidationError(res, 'Invalid client ID');
    }
    const reqError = validateRequired({ product_name }, ['product_name']);
    if (reqError) return sendValidationError(res, reqError);

    if (prescribed_date) {
      const err = validateDate(prescribed_date, 'prescribed_date');
      if (err) return sendValidationError(res, err);
    }
    if (quantity !== undefined) {
      const err = validatePositiveInt(quantity, 'quantity');
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

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_supplements (client_id, product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clientId, product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_supplements WHERE id = ?", [result.insertId]
    );
    emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateSupplement(req, res) {
  try {
    const { id } = req.params;
    const { product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid supplement ID');

    if (prescribed_date) {
      const err = validateDate(prescribed_date, 'prescribed_date');
      if (err) return sendValidationError(res, err);
    }
    if (quantity !== undefined) {
      const err = validatePositiveInt(quantity, 'quantity');
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

    await mainPool.execute(
      `UPDATE fitness_supplements
       SET product_name = ?, prescribed_date = ?, quantity = ?, mrp_inr = ?, rate_inr = ?, notes = ?
       WHERE id = ?`,
      [product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes, id]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_supplements WHERE id = ?", [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Supplement not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteSupplement(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_supplements WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
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
async function getAllTransactions(req, res) {
  try {
    const { client_id, month, type, scope } = req.query;
    const scopeNorm = String(scope || "client").toLowerCase();
    if (!["client", "external", "all"].includes(scopeNorm)) {
      return res.status(400).json({ success: false, message: "scope must be client, external, or all" });
    }

    let query = `${sqlFitnessTransactionsJoined()} WHERE 1=1`;
    const params = [];

    if (scopeNorm === "client") {
      query += " AND ft.client_id IS NOT NULL";
    } else if (scopeNorm === "external") {
      query += " AND ft.external_buyer_id IS NOT NULL";
    }

    if (client_id) {
      query += " AND ft.client_id = ?";
      params.push(client_id);
    }
    if (month) {
      query += " AND DATE_FORMAT(ft.transaction_date, '%Y-%m') = ?";
      params.push(month);
    }
    if (type) {
      query += " AND ft.type = ?";
      params.push(type);
    }

    query += " ORDER BY ft.transaction_date DESC";
    const [rows] = await mainPool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientTransactions(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_transactions WHERE client_id = ? ORDER BY transaction_date DESC",
      [clientId]
    );
    res.json({ success: true, data: rows });
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
      const [buyers] = await mainPool.execute(
        "SELECT id FROM fitness_external_buyers WHERE id = ?",
        [extIdParsed]
      );
      if (!buyers.length) {
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
        const [cref] = await mainPool.execute(
          "SELECT client_id FROM fitness_clients WHERE client_id = ?",
          [refId]
        );
        if (!cref.length) {
          return sendValidationError(res, "external_buyer.referred_by_client_id not found");
        }
      }
      let buyerId;
      if (phoneNorm) {
        const [found] = await mainPool.execute(
          "SELECT id FROM fitness_external_buyers WHERE phone = ? LIMIT 1",
          [phoneNorm]
        );
        if (found.length) {
          buyerId = found[0].id;
        }
      }
      if (!buyerId) {
        const noteVal = eb.notes != null ? String(eb.notes) : null;
        try {
          const [ins] = await mainPool.execute(
            `INSERT INTO fitness_external_buyers (full_name, phone, referred_by_client_id, notes)
             VALUES (?, ?, ?, ?)`,
            [name, phoneNorm, refId, noteVal]
          );
          buyerId = ins.insertId;
        } catch (insErr) {
          if (insErr.code === "ER_DUP_ENTRY" && phoneNorm) {
            const [found2] = await mainPool.execute(
              "SELECT id FROM fitness_external_buyers WHERE phone = ? LIMIT 1",
              [phoneNorm]
            );
            if (!found2.length) {
              return res.status(500).json({ success: false, message: insErr.message });
            }
            buyerId = found2[0].id;
          } else {
            return res.status(500).json({ success: false, message: insErr.message });
          }
        }
      }
      finalExtBuyerId = buyerId;
    }

    const conn = await mainPool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO fitness_transactions (client_id, external_buyer_id, transaction_date, payment_due_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalClientId,
          finalExtBuyerId,
          transaction_date,
          payment_due_date || null,
          product_plan,
          type,
          mrp_inr,
          rate_inr,
          received_inr || 0,
          pending_inr || 0,
          cost_inr || 0,
          pay_mode || "GPay",
          notes,
        ]
      );
      const insertId = result.insertId;
      const [rows] = await conn.execute(`${sqlFitnessTransactionsJoined()} WHERE ft.id = ?`, [
        insertId,
      ]);
      await conn.commit();
      emitFitnessChanged();
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      conn.release();
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

    await mainPool.execute(
      `UPDATE fitness_transactions
       SET transaction_date = ?, payment_due_date = ?, product_plan = ?, type = ?, mrp_inr = ?, rate_inr = ?, received_inr = ?, pending_inr = ?, cost_inr = ?, pay_mode = ?, notes = ?
       WHERE id = ?`,
      [transaction_date, payment_due_date || null, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes, id]
    );

    const [rows] = await mainPool.execute(`${sqlFitnessTransactionsJoined()} WHERE ft.id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteTransaction(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_transactions WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

function sqlFitnessTransactionsJoined() {
  return `SELECT ft.*,
    fc.full_name AS client_name,
    feb.full_name AS external_buyer_name,
    feb.phone AS external_buyer_phone,
    fr.full_name AS referred_by_client_name,
    (CASE WHEN ft.external_buyer_id IS NULL THEN NULL ELSE (
      SELECT COUNT(*) FROM fitness_transactions tx2
      WHERE tx2.external_buyer_id = ft.external_buyer_id
      AND (tx2.transaction_date < ft.transaction_date OR (tx2.transaction_date = ft.transaction_date AND tx2.id <= ft.id))
    ) END) AS visit_index
    FROM fitness_transactions ft
    LEFT JOIN fitness_clients fc ON ft.client_id = fc.client_id
    LEFT JOIN fitness_external_buyers feb ON ft.external_buyer_id = feb.id
    LEFT JOIN fitness_clients fr ON feb.referred_by_client_id = fr.client_id`;
}

async function getExternalBuyers(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const [rows] = await mainPool.execute(
      `SELECT feb.id, feb.full_name, feb.phone, feb.referred_by_client_id, feb.notes, feb.created_at, feb.updated_at,
        COALESCE(SUM(ft.received_inr), 0) AS lifetime_received,
        COUNT(ft.id) AS visit_count,
        MAX(ft.transaction_date) AS last_visit,
        MAX(fc.full_name) AS referred_by_client_name
       FROM fitness_external_buyers feb
       LEFT JOIN fitness_transactions ft ON ft.external_buyer_id = feb.id
       LEFT JOIN fitness_clients fc ON feb.referred_by_client_id = fc.client_id
       GROUP BY feb.id
       ORDER BY last_visit IS NULL, last_visit DESC, feb.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getExternalStats(req, res) {
  try {
    const fromStr = parseYmdQuery(req.query.date_from);
    const toStr = parseYmdQuery(req.query.date_to);
    let dateCond = "";
    const params = [];
    if (fromStr && toStr) {
      dateCond = " AND ft.transaction_date >= ? AND ft.transaction_date <= ?";
      params.push(fromStr, toStr);
    } else if (fromStr) {
      dateCond = " AND ft.transaction_date >= ?";
      params.push(fromStr);
    } else if (toStr) {
      dateCond = " AND ft.transaction_date <= ?";
      params.push(toStr);
    }
    const [[agg]] = await mainPool.execute(
      `SELECT COUNT(*) AS transaction_count,
        COALESCE(SUM(ft.received_inr), 0) AS total_received,
        COALESCE(SUM(ft.received_inr - ft.cost_inr), 0) AS total_profit,
        COUNT(DISTINCT ft.external_buyer_id) AS distinct_buyers
       FROM fitness_transactions ft
       WHERE ft.external_buyer_id IS NOT NULL ${dateCond}`,
      params
    );
    const [[repeatRow]] = await mainPool.execute(
      `SELECT COUNT(*) AS repeat_buyers FROM (
         SELECT ft.external_buyer_id FROM fitness_transactions ft
         WHERE ft.external_buyer_id IS NOT NULL ${dateCond}
         GROUP BY ft.external_buyer_id HAVING COUNT(*) > 1
       ) t`,
      params
    );
    res.json({
      success: true,
      data: {
        transaction_count: Number(agg.transaction_count || 0),
        total_received: Number(agg.total_received || 0),
        total_profit: Number(agg.total_profit || 0),
        distinct_buyers: Number(agg.distinct_buyers || 0),
        repeat_buyers: Number(repeatRow.repeat_buyers || 0),
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
    const namePat = `%${q}%`;
    const qDigits = normalizePhoneDigits(q);
    const params = [namePat];
    let sql = `SELECT id, full_name, phone, referred_by_client_id, notes, created_at, updated_at
      FROM fitness_external_buyers
      WHERE full_name LIKE ?`;
    if (qDigits && qDigits.length >= 2) {
      sql += " OR (phone IS NOT NULL AND phone LIKE ?)";
      params.push(`%${qDigits}%`);
    }
    sql += " ORDER BY id DESC LIMIT 30";
    const [rows] = await mainPool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getTransactionSummary(req, res) {
  try {
    const { period } = req.query; // 'monthly' or 'yearly'
    const currentYear = new Date().getFullYear();

    if (period === 'yearly') {
      const [rows] = await mainPool.execute(`
        SELECT
          SUM(received_inr) as total_received,
          SUM(pending_inr) as total_pending,
          SUM(cost_inr) as total_cost,
          SUM(received_inr - cost_inr) as total_profit,
          SUM(CASE WHEN type = 'Membership' THEN received_inr ELSE 0 END) as membership_rev,
          SUM(CASE WHEN type = 'Supplement' THEN received_inr ELSE 0 END) as supplement_rev,
          COUNT(*) as total_transactions
        FROM fitness_transactions
        WHERE YEAR(transaction_date) = ?
      `, [currentYear]);
      return res.json({ success: true, data: rows[0] });
    }

    // Monthly summary for current year
    const [rows] = await mainPool.execute(`
      SELECT
        DATE_FORMAT(transaction_date, '%Y-%m') as month,
        SUM(received_inr) as received,
        SUM(pending_inr) as pending,
        SUM(cost_inr) as cost,
        SUM(received_inr - cost_inr) as profit,
        SUM(CASE WHEN type = 'Membership' THEN received_inr ELSE 0 END) as membership,
        SUM(CASE WHEN type = 'Supplement' THEN received_inr ELSE 0 END) as supplement,
        COUNT(*) as transactions
      FROM fitness_transactions
      WHERE YEAR(transaction_date) = ?
      GROUP BY DATE_FORMAT(transaction_date, '%Y-%m')
      ORDER BY month
    `, [currentYear]);

    // Fill missing months with zeros
    const months = [];
    for (let i = 1; i <= 12; i++) {
      const monthStr = `${currentYear}-${String(i).padStart(2, '0')}`;
      const found = rows.find(r => r.month === monthStr);
      months.push(found || {
        month: monthStr, received: 0, pending: 0, cost: 0, profit: 0, membership: 0, supplement: 0, transactions: 0
      });
    }

    // Calculate totals
    const totals = months.reduce((acc, m) => ({
      received: acc.received + Number(m.received || 0),
      pending: acc.pending + Number(m.pending || 0),
      cost: acc.cost + Number(m.cost || 0),
      profit: acc.profit + Number(m.profit || 0),
      membership: acc.membership + Number(m.membership || 0),
      supplement: acc.supplement + Number(m.supplement || 0),
      transactions: acc.transactions + Number(m.transactions || 0),
    }), { received: 0, pending: 0, cost: 0, profit: 0, membership: 0, supplement: 0, transactions: 0 });

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

/** Aggregates for pie charts: by transaction type and pay mode in a date range. */
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
      return res.status(400).json({ success: false, message: "date_from must be on or before date_to" });
    }

    const [byType] = await mainPool.execute(
      `SELECT COALESCE(type, 'Other') AS key_label,
              SUM(received_inr) AS received,
              SUM(pending_inr) AS pending,
              SUM(received_inr - cost_inr) AS profit,
              COUNT(*) AS cnt
       FROM fitness_transactions
       WHERE transaction_date >= ? AND transaction_date <= ?
       GROUP BY COALESCE(type, 'Other')
       ORDER BY received DESC`,
      [fromStr, toStr]
    );
    const [byPayMode] = await mainPool.execute(
      `SELECT COALESCE(pay_mode, 'Unknown') AS key_label,
              SUM(received_inr) AS received,
              SUM(pending_inr) AS pending,
              COUNT(*) AS cnt
       FROM fitness_transactions
       WHERE transaction_date >= ? AND transaction_date <= ?
       GROUP BY COALESCE(pay_mode, 'Unknown')
       ORDER BY received DESC`,
      [fromStr, toStr]
    );
    const [[totals]] = await mainPool.execute(
      `SELECT SUM(received_inr) AS received,
              SUM(pending_inr) AS pending,
              SUM(received_inr - cost_inr) AS profit,
              COUNT(*) AS cnt
       FROM fitness_transactions
       WHERE transaction_date >= ? AND transaction_date <= ?`,
      [fromStr, toStr]
    );

    const num = (v) => Number(v) || 0;
    res.json({
      success: true,
      data: {
        range: { from: fromStr, to: toStr },
        byType: byType.map((r) => ({
          key_label: r.key_label,
          received: num(r.received),
          pending: num(r.pending),
          profit: num(r.profit),
          cnt: num(r.cnt),
        })),
        byPayMode: byPayMode.map((r) => ({
          key_label: r.key_label,
          received: num(r.received),
          pending: num(r.pending),
          cnt: num(r.cnt),
        })),
        totals: {
          received: num(totals.received),
          pending: num(totals.pending),
          profit: num(totals.profit),
          cnt: num(totals.cnt),
        },
      },
    });
  } catch (error) {
    console.error("getFitnessTransactionCharts", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/** Revenue split: plans/diet (Membership + Other) vs Supplement sales. */
async function getRevenueSplit(req, res) {
  try {
    const window = String(req.query.window || "month").toLowerCase();
    if (!["day", "month", "year"].includes(window)) {
      return res.status(400).json({ success: false, message: "window must be day, month, or year" });
    }
    const refRaw = req.query.date != null && String(req.query.date).trim() !== "" ? String(req.query.date).trim() : null;
    const today = new Date();
    const defaultRef = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const ref = refRaw && /^\d{4}-\d{2}-\d{2}$/.test(refRaw.slice(0, 10)) ? refRaw.slice(0, 10) : defaultRef;
    const [yStr, mStr] = ref.split("-");
    const y = Number(yStr);
    const mo = Number(mStr);
    const da = Number(ref.split("-")[2]);
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || da < 1 || da > 31) {
      return res.status(400).json({ success: false, message: "date must be a valid YYYY-MM-DD" });
    }

    let fromStr;
    let toStr;
    let periodLabel;
    if (window === "day") {
      fromStr = ref;
      toStr = ref;
      const d = new Date(y, mo - 1, da);
      periodLabel = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    } else if (window === "month") {
      const lastDay = new Date(y, mo, 0).getDate();
      fromStr = `${yStr}-${mStr}-01`;
      toStr = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
      periodLabel = new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    } else {
      fromStr = `${y}-01-01`;
      toStr = `${y}-12-31`;
      periodLabel = `Year ${y}`;
    }

    const dietCond = `type IN ('Membership','Other')`;
    const supCond = `type = 'Supplement'`;

    const [[periodAgg]] = await mainPool.execute(
      `SELECT
         SUM(CASE WHEN ${dietCond} THEN received_inr ELSE 0 END) AS diet_received,
         SUM(CASE WHEN ${dietCond} THEN pending_inr ELSE 0 END) AS diet_pending,
         SUM(CASE WHEN ${dietCond} THEN cost_inr ELSE 0 END) AS diet_cost,
         SUM(CASE WHEN ${dietCond} THEN (received_inr - cost_inr) ELSE 0 END) AS diet_profit,
         SUM(CASE WHEN ${dietCond} THEN 1 ELSE 0 END) AS diet_count,
         SUM(CASE WHEN ${supCond} THEN received_inr ELSE 0 END) AS sup_received,
         SUM(CASE WHEN ${supCond} THEN pending_inr ELSE 0 END) AS sup_pending,
         SUM(CASE WHEN ${supCond} THEN cost_inr ELSE 0 END) AS sup_cost,
         SUM(CASE WHEN ${supCond} THEN (received_inr - cost_inr) ELSE 0 END) AS sup_profit,
         SUM(CASE WHEN ${supCond} THEN 1 ELSE 0 END) AS sup_count
       FROM fitness_transactions
       WHERE transaction_date >= ? AND transaction_date <= ?`,
      [fromStr, toStr]
    );

    const endYear = today.getFullYear();
    const startYear = endYear - 9;
    const [yearRows] = await mainPool.execute(
      `SELECT
         YEAR(transaction_date) AS yr,
         SUM(CASE WHEN ${dietCond} THEN received_inr ELSE 0 END) AS diet_received,
         SUM(CASE WHEN ${dietCond} THEN pending_inr ELSE 0 END) AS diet_pending,
         SUM(CASE WHEN ${dietCond} THEN (received_inr - cost_inr) ELSE 0 END) AS diet_profit,
         SUM(CASE WHEN ${dietCond} THEN 1 ELSE 0 END) AS diet_count,
         SUM(CASE WHEN ${supCond} THEN received_inr ELSE 0 END) AS sup_received,
         SUM(CASE WHEN ${supCond} THEN pending_inr ELSE 0 END) AS sup_pending,
         SUM(CASE WHEN ${supCond} THEN (received_inr - cost_inr) ELSE 0 END) AS sup_profit,
         SUM(CASE WHEN ${supCond} THEN 1 ELSE 0 END) AS sup_count
       FROM fitness_transactions
       WHERE YEAR(transaction_date) >= ? AND YEAR(transaction_date) <= ?
       GROUP BY YEAR(transaction_date)
       ORDER BY yr ASC`,
      [startYear, endYear]
    );

    const byYear = new Map(yearRows.map((r) => [Number(r.yr), r]));
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
        years,
        yearRange: { from: startYear, to: endYear },
        classification: {
          diet_course: "Transaction types Membership and Other (plans, coaching, diet programs, misc services).",
          supplements: "Transaction type Supplement (product sales).",
        },
      },
    });
  } catch (error) {
    console.error("getRevenueSplit", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// REFERRALS
// ─────────────────────────────────────────────────────────────────
async function getAllReferrals(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT fr.*,
        rc.full_name as referrer_name, rc.client_id as referrer_client_id,
        rc.tier as referrer_tier,
        nc.full_name as referred_name, nc.client_id as referred_client_id
      FROM fitness_referrals fr
      JOIN fitness_clients rc ON fr.referrer_client_id = rc.client_id
      JOIN fitness_clients nc ON fr.referred_client_id = nc.client_id
      ORDER BY fr.referral_date DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getClientReferrals(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(`
      SELECT fr.*, fc.full_name as referred_name
      FROM fitness_referrals fr
      JOIN fitness_clients fc ON fr.referred_client_id = fc.client_id
      WHERE fr.referrer_client_id = ?
    `, [clientId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getReferralsReceived(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(`
      SELECT client_id, full_name, tier, status, plan_start_date
      FROM fitness_clients
      WHERE referred_by_client_id = ?
    `, [clientId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createReferral(req, res) {
  try {
    const { referrer_client_id, referred_client_id, referral_date, notes } = req.body;

    // Validation
    const reqError = validateRequired({ referrer_client_id, referred_client_id }, ['referrer_client_id', 'referred_client_id']);
    if (reqError) return sendValidationError(res, reqError);

    if (referrer_client_id && (typeof referrer_client_id !== 'string' || referrer_client_id.length > 20)) {
      return sendValidationError(res, 'Invalid referrer_client_id');
    }
    if (referred_client_id && (typeof referred_client_id !== 'string' || referred_client_id.length > 20)) {
      return sendValidationError(res, 'Invalid referred_client_id');
    }
    if (referral_date) {
      const err = validateDate(referral_date, 'referral_date');
      if (err) return sendValidationError(res, err);
    }
    if (referrer_client_id === referred_client_id) {
      return sendValidationError(res, 'Referrer and referred cannot be the same client');
    }

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_referrals (referrer_client_id, referred_client_id, referral_date, notes)
       VALUES (?, ?, ?, ?)`,
      [referrer_client_id, referred_client_id, referral_date || new Date(), notes]
    );

    const [rows] = await mainPool.execute(`
      SELECT fr.*,
        rc.full_name as referrer_name, nc.full_name as referred_name
      FROM fitness_referrals fr
      JOIN fitness_clients rc ON fr.referrer_client_id = rc.client_id
      JOIN fitness_clients nc ON fr.referred_client_id = nc.client_id
      WHERE fr.id = ?
    `, [result.insertId]);
    emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteReferral(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_referrals WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Referral not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// CLIENT TASKS
// ─────────────────────────────────────────────────────────────────
async function getClientTasks(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_client_tasks WHERE client_id = ? ORDER BY due_date ASC",
      [clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createClientTask(req, res) {
  try {
    const { clientId } = req.params;
    const { task_description, due_date, priority, status, period, notes } = req.body;

    // Validation
    if (!clientId || typeof clientId !== 'string') {
      return sendValidationError(res, 'Invalid client ID');
    }
    const reqError = validateRequired({ task_description }, ['task_description']);
    if (reqError) return sendValidationError(res, reqError);

    if (due_date) {
      const err = validateDate(due_date, 'due_date');
      if (err) return sendValidationError(res, err);
    }
    if (priority) {
      const err = validateEnum(priority, VALID_ENUMS.task_priority, 'priority');
      if (err) return sendValidationError(res, err);
    }
    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, 'status');
      if (err) return sendValidationError(res, err);
    }

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_client_tasks (client_id, task_description, due_date, priority, status, period, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clientId, task_description, due_date, priority || 'Medium', status || 'Open', period, notes]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_client_tasks WHERE id = ?", [result.insertId]
    );
    emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateClientTask(req, res) {
  try {
    const { id } = req.params;
    const { task_description, due_date, priority, status, period, completed_on, notes } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid task ID');

    if (due_date) {
      const err = validateDate(due_date, 'due_date');
      if (err) return sendValidationError(res, err);
    }
    if (priority) {
      const err = validateEnum(priority, VALID_ENUMS.task_priority, 'priority');
      if (err) return sendValidationError(res, err);
    }
    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, 'status');
      if (err) return sendValidationError(res, err);
    }
    if (completed_on) {
      const err = validateDate(completed_on, 'completed_on');
      if (err) return sendValidationError(res, err);
    }

    await mainPool.execute(
      `UPDATE fitness_client_tasks
       SET task_description = ?, due_date = ?, priority = ?, status = ?, period = ?, completed_on = ?, notes = ?
       WHERE id = ?`,
      [task_description, due_date, priority, status, period, completed_on, notes, id]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_client_tasks WHERE id = ?", [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function patchClientTaskStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, completed_on } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid task ID');

    if (status) {
      const err = validateEnum(status, VALID_ENUMS.task_status, 'status');
      if (err) return sendValidationError(res, err);
    }
    if (completed_on) {
      const err = validateDate(completed_on, 'completed_on');
      if (err) return sendValidationError(res, err);
    }

    await mainPool.execute(
      "UPDATE fitness_client_tasks SET status = ?, completed_on = ? WHERE id = ?",
      [status, completed_on, id]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_client_tasks WHERE id = ?", [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    emitFitnessChanged();
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteClientTask(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute(
      "DELETE FROM fitness_client_tasks WHERE id = ?", [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// MEAL PLANS
// ─────────────────────────────────────────────────────────────────
async function getAllMealPlans(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT mp.*, fc.full_name
      FROM fitness_meal_plans mp
      JOIN fitness_clients fc ON mp.client_id = fc.client_id
      ORDER BY mp.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getMealPlans(req, res) {
  try {
    const { clientId } = req.params;
    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_meal_plans WHERE client_id = ? ORDER BY created_at DESC",
      [clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function createMealPlan(req, res) {
  try {
    const { clientId } = req.params;
    const { plan_name, start_date, end_date, calories, protein_g, carbs_g, fats_g, plan_pdf_url, notes } = req.body;

    if (!clientId) return sendValidationError(res, 'Client ID required');
    if (!plan_name) return sendValidationError(res, 'Plan name required');

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_meal_plans (client_id, plan_name, start_date, end_date, calories, protein_g, carbs_g, fats_g, plan_pdf_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, plan_name, start_date, end_date, calories, protein_g, carbs_g, fats_g, plan_pdf_url, notes]
    );

    const [rows] = await mainPool.execute("SELECT * FROM fitness_meal_plans WHERE id = ?", [result.insertId]);
    emitFitnessChanged();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteMealPlan(req, res) {
  try {
    const { id } = req.params;
    const [result] = await mainPool.execute("DELETE FROM fitness_meal_plans WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Meal plan not found" });
    }
    emitFitnessChanged();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// DASHBOARD / ANALYTICS
// ─────────────────────────────────────────────────────────────────
async function getDashboardStats(req, res) {
  try {
    const [[{ active }]] = await mainPool.execute(
      "SELECT COUNT(*) as active FROM fitness_clients WHERE status = 'Active'"
    );
    const [[{ onHold }]] = await mainPool.execute(
      "SELECT COUNT(*) as onHold FROM fitness_clients WHERE status = 'Hold'"
    );
    const [[{ needAttention }]] = await mainPool.execute(
      "SELECT COUNT(*) as needAttention FROM fitness_clients WHERE progress IN ('Poor', 'Very Poor')"
    );
    const today = new Date().toISOString().split('T')[0];
    const [[{ overdueFollowups }]] = await mainPool.execute(
      "SELECT COUNT(*) as overdueFollowups FROM fitness_clients WHERE next_due_date < ? AND status = 'Active'",
      [today]
    );
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [[{ expiringSoon }]] = await mainPool.execute(
      "SELECT COUNT(*) as expiringSoon FROM fitness_clients WHERE plan_expiry_date BETWEEN ? AND ? AND status = 'Active'",
      [today, nextWeek]
    );
    const [[{ fiveStar }]] = await mainPool.execute(
      "SELECT COUNT(*) as fiveStar FROM fitness_clients WHERE tier = 5"
    );

    const [[{ consultCount }]] = await mainPool.execute(
      "SELECT COUNT(*) as count FROM fitness_consultations WHERE MONTH(consult_date) = MONTH(CURDATE()) AND YEAR(consult_date) = YEAR(CURDATE())"
    );

    const [[{ highRisk }]] = await mainPool.execute(`
      SELECT COUNT(*) as highRisk 
      FROM fitness_clients 
      WHERE progress IN ('Poor', 'Very Poor') 
      OR next_due_date < ? 
      OR plan_expiry_date <= ?
    `, [today, nextWeek]);

    const [notifRows] = await mainPool.execute(
      `SELECT MIN(id) AS id, title, body, MIN(created_at) AS created_at, entity_type
       FROM notifications
       WHERE user_id = ?
         AND entity_type IN ('fitness_expiry', 'fitness_due')
         AND is_read = 0
       GROUP BY entity_type, entity_id, title, body
       ORDER BY MIN(created_at) DESC
       LIMIT 5`,
      [req.user.id]
    );

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
        proactive_alerts: notifRows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsSources(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT
        source,
        COUNT(*) as client_count,
        ROUND(AVG(tier), 1) as avg_tier
      FROM fitness_clients
      WHERE source IS NOT NULL
      GROUP BY source
      ORDER BY client_count DESC
    `);
    const [[{ total }]] = await mainPool.execute(
      "SELECT COUNT(*) as total FROM fitness_clients WHERE source IS NOT NULL"
    );
    const data = rows.map(r => ({
      ...r,
      pct_of_total: total ? Math.round((r.client_count / total) * 100) : 0,
    }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsTiers(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT
        tier,
        COUNT(*) as client_count
      FROM fitness_clients
      GROUP BY tier
      ORDER BY tier DESC
    `);
    const [[{ total }]] = await mainPool.execute("SELECT COUNT(*) as total FROM fitness_clients");
    const data = rows.map(r => ({
      ...r,
      pct_of_total: total ? Math.round((r.client_count / total) * 100) : 0,
    }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsReferrers(req, res) {
  try {
    const [rows] = await mainPool.execute(`
      SELECT
        fc.client_id,
        fc.full_name,
        fc.tier,
        fc.source,
        COUNT(fr.id) as referral_count
      FROM fitness_clients fc
      LEFT JOIN fitness_referrals fr ON fc.client_id = fr.referrer_client_id
      GROUP BY fc.client_id
      HAVING referral_count > 0
      ORDER BY referral_count DESC
      LIMIT 10
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function getAnalyticsFinancial(req, res) {
  try {
    const currentYear = new Date().getFullYear();
    const [rows] = await mainPool.execute(`
      SELECT
        DATE_FORMAT(transaction_date, '%Y-%m') as month,
        SUM(received_inr) as received,
        SUM(pending_inr) as pending,
        SUM(cost_inr) as cost,
        SUM(received_inr - cost_inr) as profit
      FROM fitness_transactions
      WHERE YEAR(transaction_date) = ?
      GROUP BY DATE_FORMAT(transaction_date, '%Y-%m')
      ORDER BY month
    `, [currentYear]);

    // Get last 3 months
    const last3 = rows.slice(-3);
    res.json({ success: true, data: last3 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * Import Clients from Excel
 */
const importClientsExcel = async (req, res) => {
  if (!req.file) {
    console.log('[Import] No file uploaded');
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const tmpPath = req.file.path;
  try {
    console.log('[Import] Reading file:', tmpPath);
    const workbook = XLSX.readFile(tmpPath, { cellDates: true });
    
    // Find MASTER sheet more flexibly
    const masterSheetName = workbook.SheetNames.find(n => n.includes('MASTER'));
    const masterSheet = masterSheetName ? workbook.Sheets[masterSheetName] : null;

    if (!masterSheet) {
      console.log('[Import] MASTER sheet not found. Available:', workbook.SheetNames);
      return res.status(400).json({ success: false, message: 'Invalid file format: MASTER sheet not found' });
    }

    const masterData = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });
    const clientIds = [];
    for (let i = 0; i < masterData.length; i++) {
      const row = masterData[i];
      if (row && row[0] && String(row[0]).startsWith('FV-')) {
        clientIds.push(row[0]);
      }
    }

    console.log(`[Import] Found ${clientIds.length} client IDs`);

    const importedClients = [];
    const errors = [];

    for (const clientId of clientIds) {
      const clientSheet = workbook.Sheets[clientId];
      if (!clientSheet) {
        errors.push(`Sheet for ${clientId} not found`);
        continue;
      }

      const sheetData = XLSX.utils.sheet_to_json(clientSheet, { header: 1 });
      const getVal = (row, col) => {
        const v = sheetData[row] ? sheetData[row][col] : null;
        return v === undefined ? null : v;
      };

      const client = {
        client_id: clientId,
        full_name: getVal(9, 2),
        age: getVal(9, 5),
        phone: String(getVal(10, 5) || ''),
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
        status: getVal(5, 4) || 'Active',
        progress: getVal(5, 3) || 'Good',
        next_due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      };

      try {
        const [existing] = await mainPool.execute('SELECT id FROM fitness_clients WHERE client_id = ?', [clientId]);
        
        if (existing.length > 0) {
          await mainPool.execute(
            `UPDATE fitness_clients SET 
              full_name = ?, age = ?, phone = ?, email = ?, city = ?, address = ?, occupation = ?,
              health_goal = ?, plan_type = ?, plan_start_date = ?, plan_expiry_date = ?, 
              height_cm = ?, start_weight_kg = ?, current_weight_kg = ?, target_weight_kg = ?, bmi = ?,
              referred_by_name = ?, status = ?, progress = ?, next_due_date = ?
            WHERE client_id = ?`,
            [
              client.full_name, client.age, client.phone, client.email, client.city, client.address, client.occupation,
              client.health_goal, client.plan_type, client.plan_start_date, client.plan_expiry_date,
              client.height_cm, client.start_weight_kg, client.current_weight_kg, client.target_weight_kg, client.bmi,
              client.referred_by_name, client.status, client.progress, client.next_due_date, clientId
            ]
          );
        } else {
          await mainPool.execute(
            `INSERT INTO fitness_clients (
              client_id, full_name, age, phone, email, city, address, occupation,
              health_goal, plan_type, plan_start_date, plan_expiry_date, 
              height_cm, start_weight_kg, current_weight_kg, target_weight_kg, bmi,
              referred_by_name, status, progress, next_due_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              clientId, client.full_name, client.age, client.phone, client.email, client.city, client.address, client.occupation,
              client.health_goal, client.plan_type, client.plan_start_date, client.plan_expiry_date,
              client.height_cm, client.start_weight_kg, client.current_weight_kg, client.target_weight_kg, client.bmi,
              client.referred_by_name, client.status, client.progress, client.next_due_date
            ]
          );
        }
        const [syncedRows] = await mainPool.execute(
          "SELECT * FROM fitness_clients WHERE client_id = ?",
          [clientId]
        );
        if (syncedRows[0]) {
          await syncClientDueTask(syncedRows[0], req.user?.id);
        }
        importedClients.push(clientId);
      } catch (dbError) {
        console.error(`[Import] DB Error for ${clientId}:`, dbError.message);
        errors.push(`Error importing ${clientId}: ${dbError.message}`);
      }
    }

    emitFitnessAndDueTaskChanged("client_due_import");
    res.json({ success: true, data: { importedCount: importedClients.length, errors } });
  } catch (err) {
    console.error('[Import] Fatal Error:', err);
    res.status(500).json({ success: false, message: 'Failed to import clients: ' + err.message });
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
    const [clients] = await mainPool.execute('SELECT * FROM fitness_clients ORDER BY created_at DESC');
    const worksheet = XLSX.utils.json_to_sheet(clients);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=fitness_clients.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export clients' });
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