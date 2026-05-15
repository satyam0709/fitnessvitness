const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const fitnessController = require("../controllers/fitnessController");

// Helper to handle validation errors without auto-response
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors = {};
    for (const err of errors.array()) {
      fieldErrors[err.path] = err.msg;
    }
    return res.status(400).json({ success: false, errors: fieldErrors });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────
// VALIDATION RULES (for use in routes)
// ─────────────────────────────────────────────────────────────────
const createClientValidation = [
  body("full_name").trim().notEmpty().withMessage("Full name is required"),
  body("phone").trim().notEmpty().withMessage("Phone is required"),
  body("plan_type").trim().notEmpty().withMessage("Plan type is required"),
  body("plan_start_date").notEmpty().withMessage("Plan start date is required").isISO8601().withMessage("Plan start date must be a valid date"),
];

const createTransactionValidation = [
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
// SETTINGS
// ─────────────────────────────────────────────────────────────────
router.get("/settings", fitnessController.getFitnessSettings);
router.put("/settings", fitnessController.updateFitnessSettings);

// ─────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────
router.get("/clients", fitnessController.getAllClients);
router.get("/clients/search", fitnessController.searchClients);
router.post("/clients", createClientValidation, handleValidationErrors, fitnessController.createClient);
router.get("/clients/summary", fitnessController.getAllClients); // alias
router.get("/clients/:clientId", fitnessController.getClientById);
router.get("/clients/:clientId/summary", fitnessController.getClientSummary);
router.put("/clients/:clientId", fitnessController.updateClient);
router.delete("/clients/:clientId", fitnessController.deleteClient);

// ─────────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────────
router.get("/consultations", fitnessController.getAllConsultations);
router.get("/clients/:clientId/consultations", fitnessController.getConsultations);
router.post("/clients/:clientId/consultations", createConsultationValidation, handleValidationErrors, fitnessController.createConsultation);
router.put("/consultations/:id", fitnessController.updateConsultation);
router.delete("/consultations/:id", fitnessController.deleteConsultation);

// ─────────────────────────────────────────────────────────────────
// MEAL PLANS
// ─────────────────────────────────────────────────────────────────
router.get("/meal-plans", fitnessController.getAllMealPlans);
router.get("/clients/:clientId/meal-plans", fitnessController.getMealPlans);
router.post("/clients/:clientId/meal-plans", fitnessController.createMealPlan);
router.delete("/meal-plans/:id", fitnessController.deleteMealPlan);

// ─────────────────────────────────────────────────────────────────
// BODY STATS
// ─────────────────────────────────────────────────────────────────
router.get("/clients/:clientId/body-stats", fitnessController.getBodyStats);
router.post("/clients/:clientId/body-stats", fitnessController.createBodyStat);
router.delete("/body-stats/:id", fitnessController.deleteBodyStat);

// ─────────────────────────────────────────────────────────────────
// SUPPLEMENTS
// ─────────────────────────────────────────────────────────────────
router.get("/clients/:clientId/supplements", fitnessController.getSupplements);
router.post("/clients/:clientId/supplements", fitnessController.createSupplement);
router.put("/supplements/:id", fitnessController.updateSupplement);
router.delete("/supplements/:id", fitnessController.deleteSupplement);

// ─────────────────────────────────────────────────────────────────
// EXTERNAL WALK-IN SALES
// ─────────────────────────────────────────────────────────────────
router.get("/external/stats", fitnessController.getExternalStats);
router.get("/external/buyers/search", fitnessController.searchExternalBuyers);
router.get("/external/buyers", fitnessController.getExternalBuyers);

// ─────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────────
router.get("/transactions", fitnessController.getAllTransactions);
router.post("/transactions", createTransactionValidation, handleValidationErrors, fitnessController.createTransaction);
router.put("/transactions/:id", fitnessController.updateTransaction);
router.delete("/transactions/:id", fitnessController.deleteTransaction);
router.get("/transactions/summary/monthly", fitnessController.getTransactionSummary);
router.get("/transactions/summary/yearly", fitnessController.getTransactionSummary);
router.get("/charts/transaction-mix", fitnessController.getFitnessTransactionCharts);
router.get("/revenue/split", fitnessController.getRevenueSplit);
router.get("/clients/:clientId/transactions", fitnessController.getClientTransactions);

// ─────────────────────────────────────────────────────────────────
// REFERRALS
// ─────────────────────────────────────────────────────────────────
router.get("/referrals", fitnessController.getAllReferrals);
router.post("/referrals", fitnessController.createReferral);
router.delete("/referrals/:id", fitnessController.deleteReferral);
router.get("/clients/:clientId/referrals", fitnessController.getClientReferrals);

// ─────────────────────────────────────────────────────────────────
// CLIENT TASKS
// ─────────────────────────────────────────────────────────────────
router.get("/clients/:clientId/tasks", fitnessController.getClientTasks);
router.post("/clients/:clientId/tasks", fitnessController.createClientTask);
router.put("/client-tasks/:id", fitnessController.updateClientTask);
router.patch("/client-tasks/:id/status", fitnessController.patchClientTaskStatus);
router.delete("/client-tasks/:id", fitnessController.deleteClientTask);

// ─────────────────────────────────────────────────────────────────
// DASHBOARD / ANALYTICS
// ─────────────────────────────────────────────────────────────────
router.get("/dashboard/stats", fitnessController.getDashboardStats);
router.get("/analytics/sources", fitnessController.getAnalyticsSources);
router.get("/analytics/tiers", fitnessController.getAnalyticsTiers);
router.get("/analytics/referrers", fitnessController.getAnalyticsReferrers);
router.get("/analytics/financial", fitnessController.getAnalyticsFinancial);

// ─────────────────────────────────────────────────────────────────
// EXCEL IMPORT / EXPORT
// ─────────────────────────────────────────────────────────────────
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

router.post("/import", upload.single("file"), fitnessController.importClientsExcel);
router.get("/export", fitnessController.exportClientsExcel);

module.exports = router;