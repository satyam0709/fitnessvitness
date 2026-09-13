"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const {
  createUploadJob,
  saveJobMapping,
  validateImportJob,
  runImportJob,
  processImportJob,
  cancelImportJob,
  retryImportJob,
  listImportJobs,
  getImportJob,
  buildErrorsCsv,
  LEAD_IMPORT_FIELDS,
} = require("../services/leadImportService");

const router = express.Router();

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `lead-import:${req.user?.id || req.ip}`,
  message: { success: false, message: "Too many import requests. Try again later." },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

router.use(importLimiter);

function fail(res, err) {
  console.error(err);
  return res.status(err.status || 500).json({
    success: false,
    message: err.status === 500 ? "Import failed" : err.message,
  });
}

router.get("/fields", (_req, res) => {
  res.json({ success: true, fields: LEAD_IMPORT_FIELDS });
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "File is required" });
    }
    const result = await createUploadJob({ userId: req.user.id, file: req.file });
    res.status(201).json({
      success: true,
      job: result.job,
      headers: result.headers,
      previewRows: result.previewRows,
      suggestedMapping: result.suggestedMapping,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.patch("/jobs/:id/mapping", async (req, res) => {
  try {
    const job = await saveJobMapping({
      jobId: req.params.id,
      columnMapping: req.body?.column_mapping || req.body?.mapping || {},
      mode: req.body?.mode,
    });
    res.json({ success: true, job });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/jobs/:id/validate", async (req, res) => {
  try {
    const job = await validateImportJob({ jobId: req.params.id, mode: req.body?.mode });
    res.json({
      success: true,
      job,
      summary: {
        valid: job.valid_rows,
        invalid: job.invalid_rows,
        duplicate: job.duplicate_rows,
        new: job.new_rows,
        update: job.update_rows,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/jobs/:id/run", async (req, res) => {
  try {
    const jobId = req.params.id;
    const { job } = await runImportJob({
      userId: req.user.id,
      jobId,
      mode: req.body?.mode,
    });
    res.status(202).json({ success: true, accepted: true, job });
    void processImportJob({ userId: req.user.id, jobId }).catch((err) => {
      console.error("lead import async job", err.message);
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const data = await listImportJobs({ page: req.query.page, limit: req.query.limit });
    res.json({ success: true, ...data });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/jobs/:id", async (req, res) => {
  try {
    const job = await getImportJob({ jobId: req.params.id });
    res.json({ success: true, job });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/jobs/:id/errors.csv", async (req, res) => {
  try {
    const csv = await buildErrorsCsv({ jobId: req.params.id });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lead-import-errors-${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/jobs/:id/cancel", async (req, res) => {
  try {
    const job = await cancelImportJob({ userId: req.user.id, jobId: req.params.id });
    res.json({ success: true, job });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/jobs/:id/retry", async (req, res) => {
  try {
    const job = await retryImportJob({ userId: req.user.id, jobId: req.params.id });
    res.status(201).json({ success: true, job });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
