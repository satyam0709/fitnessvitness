const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const { requireFeature } = require("../middleware/requireFeature");
const leadService = require("../services/leadService");

const router = express.Router();
router.use(verifyToken);
router.use(requireFeature("lead_management"));

const uploadDir = path.join(__dirname, "..", "..", "uploads", "leads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 5 } });
const allowedMimes = ["image/jpeg", "image/png", "image/webp", "text/csv", "application/pdf"];

function validateUploadedMimes(req, res, next) {
  const files = Array.isArray(req.files) ? req.files : [];
  const invalid = files.find((f) => !allowedMimes.includes(f.mimetype));
  if (invalid) {
    return res.status(400).json({ error: "File type not allowed" });
  }
  return next();
}

function multipartMaybe(fieldMax = 5) {
  return (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.array("attachments", fieldMax)(req, res, next);
    return next();
  };
}

function handleService(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      const status = result?.status || (req.method === "POST" && !req.params.id ? 201 : 200);
      if (result?.status) delete result.status;
      res.status(status).json(result);
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal error",
      });
    }
  };
}

router.get("/calendar-markers", handleService((req) => leadService.getCalendarMarkers(req)));

router.get("/", handleService((req) => leadService.listLeads(req)));

router.get("/:id/followups", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.getFollowups(req, leadId);
}));

router.get("/:id/history", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.getHistory(req, leadId);
}));

router.get("/:id/change-log", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.getChangeLog(req, leadId);
}));

router.get("/:id", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.getLeadById(req, leadId);
}));

router.post("/", multipartMaybe(), validateUploadedMimes, handleService(async (req) => {
  const result = await leadService.createLead(req);
  return { ...result, status: 201 };
}));

router.post("/:id/convert", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.convertLeadToOpportunity(req, leadId);
}));

router.post("/:id/link-client", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.linkLeadToFitnessClient(req, leadId);
}));

router.post("/:id/duplicate", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.duplicateLead(req, leadId);
}));

router.post("/:id/followup", multipartMaybe(), validateUploadedMimes, handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.addFollowup(req, leadId);
}));

router.put("/:id", multipartMaybe(), validateUploadedMimes, handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  return leadService.updateLead(req, leadId);
}));

router.patch("/:id/status", handleService(async (req) => {
  const leadId = Number(req.params.id);
  const { status } = req.body || {};
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  if (!status) throw Object.assign(new Error("status is required"), { status: 400 });
  return leadService.updateLeadStatus(req, leadId, status);
}));

router.delete("/:id", handleService(async (req) => {
  const leadId = Number(req.params.id);
  if (!leadId) throw Object.assign(new Error("Invalid lead id"), { status: 400 });
  const uploadsBase = path.join(__dirname, "..", "..");
  return leadService.softDeleteLead(req, leadId, uploadsBase);
}));

module.exports = router;
