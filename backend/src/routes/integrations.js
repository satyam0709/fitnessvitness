const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getIntegrationCatalog,
  getIntegrationCatalogWithStatus,
  ingestIntegrationWebhook,
  ingestIntegrationLeadAsUser,
} = require("../controllers/integrationController");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");

const router = express.Router();

router.get("/catalog", getIntegrationCatalog);
router.post("/webhook/:source", ingestIntegrationWebhook);

router.use(verifyToken, resolveTenantContext, requireCrmTenant);
router.get("/", getIntegrationCatalogWithStatus);
router.post("/:source", ingestIntegrationLeadAsUser);

module.exports = router;
