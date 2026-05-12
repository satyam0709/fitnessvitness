const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { getMe, syncCurrentUser } = require("../controllers/userController");
const {
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  signup,
} = require("../controllers/authController");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/update-password", verifyToken, updatePassword);
router.get("/me", verifyToken, getMe);

module.exports = router;