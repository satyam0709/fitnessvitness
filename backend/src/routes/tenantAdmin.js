const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { requireTenantAdmin } = require("../middleware/platformAdmin");
const {
  listWorkspaceUsers,
  checkWorkspaceUserEmail,
  addWorkspaceUser,
  resetWorkspaceUserPassword,
  patchWorkspaceUserRole,
  toggleWorkspaceUser,
  removeWorkspaceUser,
  resendWorkspaceUserInvite,
  createWorkspaceInvite,
  listWorkspaceIntegrations,
  patchWorkspaceIntegration,
  getWorkspacePlan,
  deleteWorkspace,
} = require("../controllers/tenantWorkspaceController");
const dbSetupRoutes = require("./dbSetup");

const router = express.Router();
router.use(verifyToken, resolveTenantContext, requireTenantAdmin);
router.use("/", dbSetupRoutes);

router.get("/users", listWorkspaceUsers);
router.get("/users/check-email", checkWorkspaceUserEmail);
router.post("/users", addWorkspaceUser);
router.post("/users/:userId/reset-password", resetWorkspaceUserPassword);
router.patch("/users/:userId/role", patchWorkspaceUserRole);
router.patch("/users/:userId/active", toggleWorkspaceUser);
router.patch("/users/:userId/toggle-active", toggleWorkspaceUser);
router.post("/users/:userId/resend-invite", resendWorkspaceUserInvite);
router.delete("/users/:userId", removeWorkspaceUser);
router.post("/invitations", createWorkspaceInvite);

router.get("/integrations", listWorkspaceIntegrations);
router.patch("/integrations/:addonKey", patchWorkspaceIntegration);

router.get("/plan", getWorkspacePlan);
router.delete("/workspace", deleteWorkspace);

module.exports = router;
