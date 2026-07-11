/**
 * Fitness CRM - Computed Fields Utility
 * Handles auto-calculated fields for fitness clients
 */

// Plan duration mapping
const PLAN_DURATIONS = {
  '1 Month Plan': 30,
  '3 Month Plan': 90,
  '6 Month Plan': 180,
  '1 Year Plan': 365,
};

/**
 * Calculate plan expiry date from start date and plan type
 * @param {Date|string|null} planStartDate - Plan start date
 * @param {string|null} planType - Plan type
 * @returns {Date|null} - Calculated expiry date or null
 */
function calculatePlanExpiryDate(planStartDate, planType) {
  if (!planStartDate || !planType) return null;

  const start = new Date(planStartDate);
  if (isNaN(start.getTime())) return null;

  const duration = PLAN_DURATIONS[planType];
  if (!duration) return null;

  const expiry = new Date(start);
  expiry.setDate(expiry.getDate() + duration);
  return expiry;
}

/**
 * Calculate next due date from last consultation and follow-up frequency
 * @param {Date|string|null} lastConsultationDate - Last consultation date
 * @param {number|null} followUpFreqDays - Follow-up frequency in days
 * @returns {Date|null} - Calculated next due date or null
 */
function calculateNextDueDate(lastConsultationDate, followUpFreqDays) {
  if (!lastConsultationDate || !followUpFreqDays) return null;

  const lastConsult = new Date(lastConsultationDate);
  if (isNaN(lastConsult.getTime())) return null;

  const nextDue = new Date(lastConsult);
  nextDue.setDate(nextDue.getDate() + followUpFreqDays);
  return nextDue;
}

/**
 * Calculate BMI from height and weight
 * @param {number|null} heightCm - Height in centimeters
 * @param {number|null} weightKg - Weight in kilograms
 * @returns {number|null} - Calculated BMI or null
 */
function calculateBMI(heightCm, weightKg) {
  if (!heightCm || !weightKg || heightCm <= 0) return null;

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 100) / 100; // Round to 2 decimal places
}

/**
 * Get BMI category based on BMI value
 * @param {number|null} bmi - BMI value
 * @returns {object} - Category info with label and status
 */
function getBMICategory(bmi) {
  if (bmi === null) return { label: 'N/A', status: 'unknown' };

  if (bmi < 18.5) return { label: 'Underweight', status: 'warning' };
  if (bmi < 25) return { label: 'Normal', status: 'good' };
  if (bmi < 30) return { label: '⚠️ Overweight', status: 'warning' };
  return { label: '🚨 Obese', status: 'danger' };
}

/**
 * Calculate days remaining until plan expiry
 * @param {Date|string|null} planExpiryDate - Plan expiry date
 * @returns {number|null} - Days remaining or null
 */
function calculateDaysRemaining(planExpiryDate) {
  if (!planExpiryDate) return null;

  const expiry = new Date(planExpiryDate);
  if (isNaN(expiry.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  const diffTime = expiry - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Determine if follow-up is overdue
 * @param {Date|string|null} nextDueDate - Next due date
 * @returns {boolean} - True if overdue
 */
function isFollowUpOverdue(nextDueDate) {
  if (!nextDueDate) return false;

  const due = new Date(nextDueDate);
  if (isNaN(due.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  return today > due;
}

/**
 * Determine follow-up priority status
 * @param {Date|string|null} nextDueDate - Next due date
 * @returns {string} - Priority: 'overdue', 'due_soon', or 'ok'
 */
function getFollowUpPriority(nextDueDate) {
  if (!nextDueDate) return '✅ OK';

  const due = new Date(nextDueDate);
  if (isNaN(due.getTime())) return '✅ OK';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return '🔴 OVERDUE';
  if (diffDays <= 3) return '🟡 DUE SOON';
  return '✅ OK';
}

/**
 * Determine if client is high risk
 * Risk = progress is 'Poor' or 'Very Poor' AND (follow-up overdue OR plan expiring within 7 days)
 * @param {string|null} progress - Client progress status
 * @param {boolean} isFollowUpOverdue - Whether follow-up is overdue
 * @param {number|null} daysRemaining - Days until plan expiry
 * @returns {boolean} - True if high risk
 */
function getRiskStatus(progress, followUpPriority, daysRemaining) {
  const poorProgress = progress === 'Poor' || progress === 'Very Poor';
  const overdue = followUpPriority === '🔴 OVERDUE';
  const expiringSoon = daysRemaining !== null && daysRemaining <= 7;

  if (poorProgress || overdue || expiringSoon) {
    return '🔴 HIGH RISK';
  }
  return '✅ OK';
}

/**
 * Calculate weight change from start to current
 * @param {number|null} startWeight - Starting weight in kg
 * @param {number|null} currentWeight - Current weight in kg
 * @returns {number|null} - Weight change (negative = lost, positive = gained)
 */
function calculateWeightChange(startWeight, currentWeight) {
  if (startWeight === null || currentWeight === null) return null;
  return Math.round((currentWeight - startWeight) * 100) / 100;
}

/**
 * Calculate percentage progress toward goal
 * @param {number|null} startWeight - Starting weight in kg
 * @param {number|null} currentWeight - Current weight in kg
 * @param {number|null} targetWeight - Target weight in kg
 * @returns {number|null} - Percentage of goal achieved (0-100+)
 */
function calculateGoalProgress(startWeight, currentWeight, targetWeight) {
  if (startWeight === null || currentWeight === null || targetWeight === null) return null;

  const totalToLose = startWeight - targetWeight;
  if (totalToLose === 0) return 100;

  const lost = startWeight - currentWeight;
  const progress = (lost / totalToLose) * 100;

  return Math.round(progress * 100) / 100;
}

/**
 * Generate next client ID (FV-001, FV-002, etc.)
 * @param {number} clientCount - Current count of clients
 * @returns {string} - Formatted client ID
 */
function generateClientId(clientCount) {
  const padded = String(clientCount + 1).padStart(3, '0');
  return `FV-${padded}`;
}

/** Normalize DB / computed values to YYYY-MM-DD or null. */
function normalizeEffectiveDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return null;
  return s;
}

function effectiveDateTimestamp(value) {
  const ymd = normalizeEffectiveDate(value);
  if (!ymd) return null;
  const ts = new Date(`${ymd}T00:00:00`).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function compareNames(a, b) {
  return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'en', {
    sensitivity: 'base',
  });
}

/**
 * Sort client rows using the same effective fields shown in the UI (after compute).
 */
function sortClientRows(rows, sortKey) {
  const list = [...rows];
  const sort = String(sortKey || '').toLowerCase();

  const STATUS_ORDER = { 'Active': 1, 'Hold': 2, 'Inactive': 3 };
  const PROGRESS_ORDER = { 'Very Good': 5, 'Good': 4, 'Neutral': 3, 'Poor': 2, 'Very Poor': 1 };
  const PRIORITY_ORDER = { '🔴 OVERDUE': 1, '🟡 DUE SOON': 2, '✅ OK': 3 };

  switch (sort) {
    case 'id_asc':
      list.sort((a, b) => String(a.client_id || '').localeCompare(String(b.client_id || ''), 'en', { numeric: true }));
      break;
    case 'id_desc':
      list.sort((a, b) => String(b.client_id || '').localeCompare(String(a.client_id || ''), 'en', { numeric: true }));
      break;
    case 'risk_asc': // high risk first
      list.sort((a, b) => (b.is_high_risk ? 1 : 0) - (a.is_high_risk ? 1 : 0) || compareNames(a, b));
      break;
    case 'risk_desc': // low risk first (ok first)
      list.sort((a, b) => (a.is_high_risk ? 1 : 0) - (b.is_high_risk ? 1 : 0) || compareNames(a, b));
      break;
    case 'status_asc': // Active -> Hold -> Inactive
      list.sort((a, b) => (STATUS_ORDER[a.status] || 99) - (STATUS_ORDER[b.status] || 99) || compareNames(a, b));
      break;
    case 'status_desc': // Inactive -> Hold -> Active
      list.sort((a, b) => (STATUS_ORDER[b.status] || 99) - (STATUS_ORDER[a.status] || 99) || compareNames(a, b));
      break;
    case 'progress_asc': // Very Good -> Very Poor
      list.sort((a, b) => (PROGRESS_ORDER[b.progress] || 0) - (PROGRESS_ORDER[a.progress] || 0) || compareNames(a, b));
      break;
    case 'progress_desc': // Very Poor -> Very Good
      list.sort((a, b) => (PROGRESS_ORDER[a.progress] || 0) - (PROGRESS_ORDER[b.progress] || 0) || compareNames(a, b));
      break;
    case 'follow_up_asc': // OVERDUE first
      list.sort((a, b) => (PRIORITY_ORDER[a.follow_up_priority] || 99) - (PRIORITY_ORDER[b.follow_up_priority] || 99) || compareNames(a, b));
      break;
    case 'follow_up_desc': // OK first
      list.sort((a, b) => (PRIORITY_ORDER[b.follow_up_priority] || 99) - (PRIORITY_ORDER[a.follow_up_priority] || 99) || compareNames(a, b));
      break;
    case 'days_asc':
      list.sort((a, b) => {
        const ad = a.days_remaining;
        const bd = b.days_remaining;
        if (ad == null && bd == null) return compareNames(a, b);
        if (ad == null) return 1;
        if (bd == null) return -1;
        return ad - bd || compareNames(a, b);
      });
      break;
    case 'days_desc':
      list.sort((a, b) => {
        const ad = a.days_remaining;
        const bd = b.days_remaining;
        if (ad == null && bd == null) return compareNames(a, b);
        if (ad == null) return 1;
        if (bd == null) return -1;
        return bd - ad || compareNames(a, b);
      });
      break;
    case 'next_due':
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.next_due_date);
        const bt = effectiveDateTimestamp(b.next_due_date);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return at - bt || compareNames(a, b);
      });
      break;
    case 'next_due_desc':
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.next_due_date);
        const bt = effectiveDateTimestamp(b.next_due_date);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return bt - at || compareNames(a, b);
      });
      break;
    case 'plan_expiry':
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.plan_expiry_date);
        const bt = effectiveDateTimestamp(b.plan_expiry_date);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return at - bt || compareNames(a, b);
      });
      break;
    case 'plan_expiry_desc':
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.plan_expiry_date);
        const bt = effectiveDateTimestamp(b.plan_expiry_date);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return bt - at || compareNames(a, b);
      });
      break;
    case 'name':
      list.sort(compareNames);
      break;
    case 'name_desc':
      list.sort((a, b) => compareNames(b, a));
      break;
    case 'tier':
      list.sort((a, b) => (Number(a.tier) || 0) - (Number(b.tier) || 0) || compareNames(a, b));
      break;
    case 'tier_desc':
      list.sort((a, b) => (Number(b.tier) || 0) - (Number(a.tier) || 0) || compareNames(a, b));
      break;
    case 'created_asc':
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.created_at);
        const bt = effectiveDateTimestamp(b.created_at);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return at - bt || compareNames(a, b);
      });
      break;
    case 'created':
    default:
      list.sort((a, b) => {
        const at = effectiveDateTimestamp(a.created_at);
        const bt = effectiveDateTimestamp(b.created_at);
        if (at == null && bt == null) return compareNames(a, b);
        if (at == null) return 1;
        if (bt == null) return -1;
        return bt - at || compareNames(a, b);
      });
      break;
  }

  return list;
}

/**
 * Compute all derived fields for a fitness client
 * @param {object} client - Client object from database
 * @returns {object} - Client with computed fields added
 */
function computeClientFields(client) {
  const computed = {};

  // Calculate plan expiry
  if (client.plan_start_date && client.plan_type) {
    computed.plan_expiry_date = calculatePlanExpiryDate(client.plan_start_date, client.plan_type);
    // Update the stored plan_expiry_date if different
    if (computed.plan_expiry_date &&
        client.plan_expiry_date &&
        new Date(computed.plan_expiry_date).toISOString() !== new Date(client.plan_expiry_date).toISOString()) {
      // The DB already has a value, use that
      computed.plan_expiry_date = client.plan_expiry_date;
    }
  } else {
    computed.plan_expiry_date = client.plan_expiry_date;
  }

  // Effective next due: manual DB date wins, else calculated from last consultation
  const calculatedDue = calculateNextDueDate(
    client.last_consultation_date,
    client.follow_up_freq_days
  );
  const storedDue = normalizeEffectiveDate(client.next_due_date);
  const calculatedDueYmd = calculatedDue ? normalizeEffectiveDate(calculatedDue) : null;
  computed.next_due_date = storedDue || calculatedDueYmd;

  // Calculate BMI
  computed.bmi = calculateBMI(client.height_cm, client.current_weight_kg);

  // Get BMI category
  computed.bmi_category = getBMICategory(computed.bmi);

  // Calculate days remaining
  computed.days_remaining = calculateDaysRemaining(computed.plan_expiry_date);

  // Determine follow-up overdue / priority from the same date shown in the list
  computed.follow_up_overdue = isFollowUpOverdue(computed.next_due_date);
  computed.follow_up_priority = getFollowUpPriority(computed.next_due_date);

  // Determine risk flag
  computed.risk_status = getRiskStatus(
    client.progress,
    computed.follow_up_priority,
    computed.days_remaining
  );
  computed.is_high_risk = computed.risk_status === '🔴 HIGH RISK';

  // Calculate weight change
  computed.weight_change = calculateWeightChange(client.start_weight_kg, client.current_weight_kg);

  // Calculate goal progress
  computed.goal_progress = calculateGoalProgress(
    client.start_weight_kg,
    client.current_weight_kg,
    client.target_weight_kg
  );

  return { ...client, ...computed };
}

/**
 * Apply computed fields to a list of clients
 * @param {array} clients - Array of client objects
 * @returns {array} - Clients with computed fields
 */
function computeClientFieldsBatch(clients) {
  return clients.map(computeClientFields);
}

module.exports = {
  // Calculation functions
  calculatePlanExpiryDate,
  calculateNextDueDate,
  calculateBMI,
  getBMICategory,
  calculateDaysRemaining,
  isFollowUpOverdue,
  getFollowUpPriority,
  getRiskStatus,
  calculateWeightChange,
  calculateGoalProgress,
  generateClientId,

  // Batch processors
  computeClientFields,
  computeClientFieldsBatch,
  normalizeEffectiveDate,
  sortClientRows,

  // Constants
  PLAN_DURATIONS,
};