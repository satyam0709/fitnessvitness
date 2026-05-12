const express = require("express");
const { requirePlatformAdmin } = require("../middleware/platformAdmin");
const {
  getTenantDatabaseStatus,
  postTenantDatabaseTest,
  postTenantDatabaseActivate,
  postTenantDatabaseRequest,
} = require("../controllers/tenantDbProvisioningController");

const router = express.Router();

router.get("/tenants/:tenantId/database", requirePlatformAdmin, getTenantDatabaseStatus);
router.post("/tenants/:tenantId/database/test", requirePlatformAdmin, postTenantDatabaseTest);
router.post("/tenants/:tenantId/database/activate", requirePlatformAdmin, postTenantDatabaseActivate);
router.post("/tenants/:tenantId/database/request", requirePlatformAdmin, postTenantDatabaseRequest);

module.exports = router;
