const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getCalendarFeed,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getGoogleCalendarStatus,
  postGoogleCalendarSync,
} = require("../controllers/calendarController");
const { resolveTenantContext, enforceSubscription } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();
router.use(verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription());

router.get("/feed", getCalendarFeed);
router.post("/events", createCalendarEvent);
router.put("/events/:id", updateCalendarEvent);
router.delete("/events/:id", deleteCalendarEvent);

router.get("/google/status", getGoogleCalendarStatus);
router.post("/google/sync", postGoogleCalendarSync);

module.exports = router;
