const express = require("express");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");
const { emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const { clearMustChangePassword, updateProfile, listUsers } = require("../controllers/userController");

const router = express.Router();
router.use(verifyToken);

router.get("/", listUsers);

module.exports = router;