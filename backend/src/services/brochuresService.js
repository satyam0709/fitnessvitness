"use strict";

const fs = require("fs");
const path = require("path");
const prisma = require("../config/prisma");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "brochures");
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

function brochureDir() {
  return UPLOAD_ROOT;
}

function resolveStoredFile(storedName) {
  const file = path.basename(String(storedName || ""));
  if (!file) return null;
  const dir = brochureDir();
  const abs = path.join(dir, file);
  if (!abs.startsWith(dir) || !fs.existsSync(abs)) return null;
  return abs;
}

function mimeOf(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function normalizeType(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (t === "quotation") return "quotation";
  if (t === "paid_invoice" || t === "paidinvoice" || t === "invoice") return "paid_invoice";
  const err = new Error("Type must be Quotation or Paid Invoice");
  err.status = 400;
  throw err;
}

function typeLabel(type) {
  return type === "quotation" ? "Quotation" : "Paid Invoice";
}

function toRow(r) {
  const stored = String(r.stored_name || "").trim();
  return {
    id: Number(r.id),
    name: r.name,
    type: r.type,
    type_label: typeLabel(r.type),
    file_name: r.file_name || null,
    has_file: !!stored,
  };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function saveUpload(file) {
  if (!file) return { file_name: null, stored_name: null };
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED.has(mime)) fail(400, "Only PDF or image files are allowed");
  const size = Number(file.size || (file.buffer && file.buffer.length) || 0);
  if (size > MAX_BYTES) fail(400, "File is too large (max 10 MB)");
  const dir = brochureDir();
  fs.mkdirSync(dir, { recursive: true });
  const orig = String(file.originalname || "brochure").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  const stored = `${Date.now()}-${orig}`;
  const abs = path.join(dir, stored);
  if (file.buffer) fs.writeFileSync(abs, file.buffer);
  else if (file.path) fs.copyFileSync(file.path, abs);
  else fail(400, "File upload failed");
  return { file_name: orig, stored_name: stored };
}

function removeStored(storedName) {
  const abs = resolveStoredFile(storedName);
  if (abs) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

async function findLive(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid < 1) return null;
  return prisma.brochures.findFirst({
    where: { id: nid, is_deleted: false },
  });
}

async function listBrochures(typeFilter) {
  const rows = await prisma.brochures.findMany({
    where: { is_deleted: false },
    orderBy: { id: "desc" },
    select: { id: true, name: true, type: true, file_name: true, stored_name: true },
  });
  const all = rows.map(toRow);
  if (!typeFilter) return all;
  const want = normalizeType(typeFilter);
  return all.filter((r) => r.type === want);
}

async function createBrochure({ name, type, file }) {
  const title = String(name || "").trim().slice(0, 180);
  if (!title) fail(400, "Brochure name is required");
  const kind = normalizeType(type);
  if (!file) fail(400, "A brochure file is required");
  const stored = saveUpload(file);
  const created = await prisma.brochures.create({
    data: {
      name: title,
      type: kind,
      file_name: stored.file_name,
      stored_name: stored.stored_name,
    },
  });
  return toRow(created);
}

async function updateBrochure(id, { name, type, file }) {
  const existing = await findLive(id);
  if (!existing) fail(404, "Not found");
  const title = name != null ? String(name).trim().slice(0, 180) : existing.name;
  if (!title) fail(400, "Brochure name is required");
  const kind = type != null ? normalizeType(type) : existing.type;
  let fileName = existing.file_name;
  let storedName = existing.stored_name;
  if (file) {
    const stored = saveUpload(file);
    removeStored(existing.stored_name);
    fileName = stored.file_name;
    storedName = stored.stored_name;
  }
  const updated = await prisma.brochures.update({
    where: { id: Number(existing.id) },
    data: {
      name: title,
      type: kind,
      file_name: fileName,
      stored_name: storedName,
      updated_at: new Date(),
    },
  });
  return toRow(updated);
}

async function deleteBrochure(id) {
  const existing = await findLive(id);
  if (!existing) fail(404, "Not found");
  await prisma.brochures.update({
    where: { id: Number(existing.id) },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date(),
    },
  });
  return { ok: true };
}

async function getBrochureFile(id) {
  const existing = await findLive(id);
  if (!existing) fail(404, "Not found");
  const abs = resolveStoredFile(existing.stored_name);
  if (!abs) fail(404, "File not found");
  return {
    abs,
    fileName: existing.file_name || path.basename(abs),
    mime: mimeOf(existing.file_name || abs),
  };
}

module.exports = {
  listBrochures,
  createBrochure,
  updateBrochure,
  deleteBrochure,
  getBrochureFile,
};
