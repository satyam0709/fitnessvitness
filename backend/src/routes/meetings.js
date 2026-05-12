const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getMeetings,
  getMeetingStats,
  exportMeetingsCsv,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  bulkDeleteMeetings,
  bulkAssignMeetings,
} = require("../controllers/meetingController");
const {
  resolveTenantContext,
  enforceSubscription,
  requireFeature,
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
  requireFeature("task_management", "view")
);

router.get("/stats", getMeetingStats);
router.get("/export", exportMeetingsCsv);
router.post("/bulk-delete", requireFeature("task_management", "delete"), bulkDeleteMeetings);
router.post("/bulk-assign", requireFeature("task_management", "edit"), bulkAssignMeetings);
router.get("/", getMeetings);
router.post("/", requireFeature("task_management", "create"), createMeeting);
router.put("/:id", requireFeature("task_management", "edit"), updateMeeting);
router.delete("/:id", requireFeature("task_management", "delete"), deleteMeeting);

module.exports = router;