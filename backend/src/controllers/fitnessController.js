const { mainPool } = require("../config/database");
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

function sendValidationError(res, message) {
  return res.status(400).json({ success: false, message });
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

const createTransactionValidation = [
  body("client_id").trim().notEmpty().withMessage("Client ID is required"),
  body("transaction_date").notEmpty().withMessage("Transaction date is required").isISO8601().withMessage("Transaction date must be a valid date"),
  body("product_plan").trim().notEmpty().withMessage("Product/Plan is required"),
  body("type").trim().notEmpty().withMessage("Type is required"),
  body("rate_inr").notEmpty().withMessage("Rate is required").isNumeric().withMessage("Rate must be a number"),
  body("received_inr").notEmpty().withMessage("Received amount is required").isNumeric().withMessage("Received amount must be a number"),
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
    const { status, search } = req.query;
    let query = "SELECT * FROM fitness_clients WHERE 1=1";
    const params = [];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (search) {
      query += " AND (full_name LIKE ? OR client_id LIKE ? OR phone LIKE ? OR email LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += " ORDER BY created_at DESC";
    const [rows] = await mainPool.execute(query, params);
    const computed = rows.map(computeClientFields);
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
    const {
      full_name, phone, email, age, city, address, occupation, emergency_contact,
      referred_by_client_id, source, tier, health_goal, plan_type, plan_start_date,
      follow_up_freq_days, medical_conditions, allergies, activity_level,
      current_medications, height_cm, start_weight_kg, current_weight_kg, target_weight_kg
    } = req.body;

    // Express-validator validation
    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    // Existing validation
    const reqError = validateRequired(req.body, ['full_name']);
    if (reqError) return sendValidationError(res, reqError);

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
    if (tier !== undefined) {
      const tierError = validateNumber(tier, 'tier', 1, 5);
      if (tierError) return sendValidationError(res, tierError);
    }
    if (age !== undefined) {
      const ageError = validateNumber(age, 'age', 1, 150);
      if (ageError) return sendValidationError(res, ageError);
    }
    if (height_cm !== undefined) {
      const heightError = validateNumber(height_cm, 'height_cm', 50, 300);
      if (heightError) return sendValidationError(res, heightError);
    }
    if (start_weight_kg !== undefined) {
      const weightError = validateNumber(start_weight_kg, 'start_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (current_weight_kg !== undefined) {
      const weightError = validateNumber(current_weight_kg, 'current_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (target_weight_kg !== undefined) {
      const weightError = validateNumber(target_weight_kg, 'target_weight_kg', 1, 500);
      if (weightError) return sendValidationError(res, weightError);
    }
    if (follow_up_freq_days !== undefined) {
      const freqError = validatePositiveInt(follow_up_freq_days, 'follow_up_freq_days');
      if (freqError) return sendValidationError(res, freqError);
    }
    if (plan_start_date) {
      const dateError = validateDate(plan_start_date, 'plan_start_date');
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
        referred_by_client_id, source, tier, health_goal, plan_type, plan_start_date,
        plan_expiry_date, follow_up_freq_days, medical_conditions, allergies, activity_level,
        current_medications, height_cm, start_weight_kg, current_weight_kg, target_weight_kg, bmi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId, full_name, phone, email, age, city, address, occupation, emergency_contact,
        referred_by_client_id, source || 'Walk-in', tier || 3, health_goal, plan_type,
        plan_start_date, plan_expiry_date, follow_up_freq_days || 14,
        medical_conditions, allergies, activity_level, current_medications,
        height_cm, start_weight_kg, current_weight_kg, target_weight_kg, bmi
      ]
    );

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_clients WHERE id = ?", [result.insertId]
    );

    res.status(201).json({ success: true, data: computeClientFields(rows[0]) });
  } catch (error) {
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
        values.push(value);
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

    res.json({ success: true, data: computeClientFields(rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function deleteClient(req, res) {
  try {
    const { clientId } = req.params;
    // Soft delete - set status to Inactive
    const [result] = await mainPool.execute(
      "UPDATE fitness_clients SET status = 'Inactive' WHERE client_id = ?",
      [clientId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    res.json({ success: true, message: "Client marked as inactive" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────
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

    const [rows] = await mainPool.execute(
      "SELECT * FROM fitness_consultations WHERE id = ?", [result.insertId]
    );
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
    const { client_id, month, type } = req.query;
    let query = "SELECT ft.*, fc.full_name as client_name FROM fitness_transactions ft LEFT JOIN fitness_clients fc ON ft.client_id = fc.client_id WHERE 1=1";
    const params = [];

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
    const { client_id, transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes } = req.body;

    // Express-validator validation
    const fieldErrors = extractValidationErrors(req);
    if (fieldErrors) {
      return res.status(400).json({ success: false, errors: fieldErrors });
    }

    // Existing validation
    const reqError = validateRequired({ client_id, transaction_date, product_plan, type }, ['client_id', 'transaction_date', 'product_plan', 'type']);
    if (reqError) return sendValidationError(res, reqError);

    if (!client_id || client_id.length > 20) {
      return sendValidationError(res, 'Invalid client_id');
    }
    const dateErr = validateDate(transaction_date, 'transaction_date');
    if (dateErr) return sendValidationError(res, dateErr);

    const typeErr = validateEnum(type, VALID_ENUMS.transaction_type, 'type');
    if (typeErr) return sendValidationError(res, typeErr);

    if (pay_mode) {
      const modeErr = validateEnum(pay_mode, VALID_ENUMS.pay_mode, 'pay_mode');
      if (modeErr) return sendValidationError(res, modeErr);
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

    const [result] = await mainPool.execute(
      `INSERT INTO fitness_transactions (client_id, transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id, transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr || 0, pending_inr || 0, cost_inr || 0, pay_mode || 'GPay', notes]
    );

    const [rows] = await mainPool.execute(
      "SELECT ft.*, fc.full_name as client_name FROM fitness_transactions ft LEFT JOIN fitness_clients fc ON ft.client_id = fc.client_id WHERE ft.id = ?",
      [result.insertId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateTransaction(req, res) {
  try {
    const { id } = req.params;
    const { transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes } = req.body;

    // Validate ID
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return sendValidationError(res, 'Invalid transaction ID');

    if (transaction_date) {
      const err = validateDate(transaction_date, 'transaction_date');
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
       SET transaction_date = ?, product_plan = ?, type = ?, mrp_inr = ?, rate_inr = ?, received_inr = ?, pending_inr = ?, cost_inr = ?, pay_mode = ?, notes = ?
       WHERE id = ?`,
      [transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes, id]
    );

    const [rows] = await mainPool.execute(
      "SELECT ft.*, fc.full_name as client_name FROM fitness_transactions ft LEFT JOIN fitness_clients fc ON ft.client_id = fc.client_id WHERE ft.id = ?",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
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
    res.json({ success: true });
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

    res.json({
      success: true,
      data: {
        active_clients: active || 0,
        on_hold: onHold || 0,
        need_attention: needAttention || 0,
        overdue_followups: overdueFollowups || 0,
        expiring_soon: expiringSoon || 0,
        five_star_clients: fiveStar || 0,
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
  // Referrals
  getAllReferrals,
  getClientReferrals,
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
};