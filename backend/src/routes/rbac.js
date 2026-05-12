const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { requireTenantAdminRbac } = require("../middleware/rbac");
const {
  getRbacMe,
  listPermissions,
  listRoles,
  listMembers,
  patchMemberRole,
} = require("../controllers/rbacController");

const router = express.Router();
router.use(verifyToken, resolveTenantContext);

router.get("/me", getRbacMe);
router.get("/catalog/permissions", requireTenantAdminRbac, listPermissions);
router.get("/roles", requireTenantAdminRbac, listRoles);
router.get("/members", requireTenantAdminRbac, listMembers);
router.patch("/members/:userId", requireTenantAdminRbac, patchMemberRole);

module.exports = router;
