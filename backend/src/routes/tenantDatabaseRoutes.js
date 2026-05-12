const express = require("express");
const { requirePlatformAdmin } = require("../middleware/platformAdmin");
const tenantDatabaseService = require("../services/tenantDatabaseService");
const { mainPool } = require("../config/database");

const router = express.Router();

router.get("/api/tenant-db/status", async (req, res) => {
  try {
    const result = await tenantDatabaseService.getTenantDbStatus(req.tenantId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[tenantDb] status error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch DB status" });
  }
});

router.post("/api/tenant-db/request", async (req, res) => {
  try {
    const request = await tenantDatabaseService.submitTenantDbRequest(req.tenantId, req.body);
    await mainPool.execute("UPDATE tenants SET subdomain_status = 'pending' WHERE id = ?", [req.tenantId]);
    res.status(201).json({ success: true, ...request });
  } catch (err) {
    console.error("[tenantDb] submit request error:", err);
    res.status(500).json({ success: false, error: "Failed to submit DB request" });
  }
});

router.use("/api/admin/tenant-db", requirePlatformAdmin);

router.get("/api/admin/tenant-db/requests", async (req, res) => {
  try {
    const rows = await tenantDatabaseService.listTenantDbRequests(req.query);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[tenantDb] list requests error:", err);
    res.status(500).json({ success: false, error: "Failed to list DB requests" });
  }
});

router.post("/api/admin/tenant-db/requests/:id/approve", async (req, res) => {
  try {
    const result = await tenantDatabaseService.approveTenantDbRequest(req.params.id, req.user.id);
    if (result && result.ok === false) {
      return res.status(400).json({ success: false, message: result.reason || "Approval failed" });
    }
    res.json({ success: true, data: result || null });
  } catch (err) {
    console.error("[tenantDb] approve error:", err);
    res.status(500).json({ success: false, error: "Failed to approve DB request" });
  }
});

router.post("/api/admin/tenant-db/requests/:id/reject", async (req, res) => {
  try {
    const result = await tenantDatabaseService.rejectTenantDbRequest(
      req.params.id,
      req.user.id,
      req.body?.reason
    );
    res.json({ success: true, data: result || null });
  } catch (err) {
    console.error("[tenantDb] reject error:", err);
    res.status(500).json({ success: false, error: "Failed to reject DB request" });
  }
});

module.exports = router;
