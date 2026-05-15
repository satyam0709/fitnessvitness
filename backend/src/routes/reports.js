const express = require("express");
const {
  getPipelineReport,
  getConversionReport,
  getActivityReport,
  getRevenueReport,
  getInvoiceMixReport,
  exportReportCsv,
} = require("../controllers/reportsController");

const router = express.Router();

router.get("/pipeline", getPipelineReport);
router.get("/conversion", getConversionReport);
router.get("/activity", getActivityReport);
router.get("/revenue", getRevenueReport);
router.get("/invoice-mix", getInvoiceMixReport);
router.get("/export/:type", exportReportCsv);

module.exports = router;
