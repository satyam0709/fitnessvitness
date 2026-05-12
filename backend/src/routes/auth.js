const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { getMeContext } = require("../controllers/meController");
const {
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  signup,
} = require("../controllers/authController");
const { signupWithDedicatedTenant } = require("../controllers/tenantSignupController");

const router = express.Router();

router.post("/signup", signup);
router.post("/register-company", signupWithDedicatedTenant);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/update-password", verifyToken, updatePassword);
router.get("/me", verifyToken, resolveTenantContext, getMeContext);

module.exports = router;
