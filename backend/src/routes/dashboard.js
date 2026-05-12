const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { getDashboardStats, getDashboardInsights, getDashboardOpr } = require("../controllers/dashboardController");
const { resolveTenantContext, enforceSubscription } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();

router.use(verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription());

router.get("/stats", getDashboardStats);
router.get("/insights", getDashboardInsights);
router.get("/opr", getDashboardOpr);

module.exports = router;