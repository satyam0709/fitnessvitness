const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getNotifications,
  markAllNotificationsRead,
} = require("../controllers/notificationController");
const { resolveTenantContext, enforceSubscription } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();
router.use(verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription());

router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);

module.exports = router;
