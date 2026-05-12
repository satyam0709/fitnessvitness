const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { getDashboardStats, getDashboardInsights, getDashboardOpr } = require("../controllers/dashboardController");

const router = express.Router();

router.use(verifyToken);

router.get("/stats", getDashboardStats);
router.get("/insights", getDashboardInsights);
router.get("/opr", getDashboardOpr);

module.exports = router;