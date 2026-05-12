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
  if (bmi < 30) return { label: 'Overweight', status: 'warning' };
  return { label: 'Obese', status: 'danger' };
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
  if (!nextDueDate) return 'ok';

  const due = new Date(nextDueDate);
  if (isNaN(due.getTime())) return 'ok';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'overdue';
  if (diffDays <= 3) return 'due_soon';
  return 'ok';
}

/**
 * Determine if client is high risk
 * Risk = progress is 'Poor' or 'Very Poor' AND (follow-up overdue OR plan expiring within 7 days)
 * @param {string|null} progress - Client progress status
 * @param {boolean} isFollowUpOverdue - Whether follow-up is overdue
 * @param {number|null} daysRemaining - Days until plan expiry
 * @returns {boolean} - True if high risk
 */
function isHighRisk(progress, isFollowUpOverdue, daysRemaining) {
  const poorProgress = progress === 'Poor' || progress === 'Very Poor';
  if (!poorProgress) return false;

  const expiringSoon = daysRemaining !== null && daysRemaining <= 7 && daysRemaining >= 0;

  return isFollowUpOverdue || expiringSoon;
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

  // Calculate next due date
  computed.next_due_date = calculateNextDueDate(
    client.last_consultation_date,
    client.follow_up_freq_days
  );

  // Calculate BMI
  computed.bmi = calculateBMI(client.height_cm, client.current_weight_kg);

  // Get BMI category
  computed.bmi_category = getBMICategory(computed.bmi);

  // Calculate days remaining
  computed.days_remaining = calculateDaysRemaining(computed.plan_expiry_date);

  // Determine follow-up overdue
  computed.follow_up_overdue = isFollowUpOverdue(client.next_due_date || computed.next_due_date);

  // Get follow-up priority
  computed.follow_up_priority = getFollowUpPriority(client.next_due_date || computed.next_due_date);

  // Determine risk flag
  computed.is_high_risk = isHighRisk(
    client.progress,
    computed.follow_up_overdue,
    computed.days_remaining
  );

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
  isHighRisk,
  calculateWeightChange,
  calculateGoalProgress,
  generateClientId,

  // Batch processors
  computeClientFields,
  computeClientFieldsBatch,

  // Constants
  PLAN_DURATIONS,
};