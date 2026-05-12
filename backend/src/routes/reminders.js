const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getReminders,
  createReminder,
  updateReminder,
  markReminderDone,
  deleteReminder,
  bulkDeleteReminders,
} = require("../controllers/reminderController");
const {
  resolveTenantContext,
  enforceSubscription,
  requireAnyFeature,
} = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();
router.use(
  verifyToken,
  resolveTenantContext,
  bindTenantCrmPool,
  requireCrmTenant,
  enforceSubscription(),
  requireAnyFeature(["task_management", "lead_management"], "view")
);

router.get("/", getReminders);
router.post("/", requireAnyFeature(["task_management", "lead_management"], "create"), createReminder);
router.post("/bulk-delete", requireAnyFeature(["task_management", "lead_management"], "delete"), bulkDeleteReminders);
router.put("/:id", requireAnyFeature(["task_management", "lead_management"], "edit"), updateReminder);
router.patch("/:id/done", requireAnyFeature(["task_management", "lead_management"], "edit"), markReminderDone);
router.delete("/:id", requireAnyFeature(["task_management", "lead_management"], "delete"), deleteReminder);

module.exports = router;