"use strict";

const fs = require("fs");
const path = require("path");
const prisma = require("../config/prisma");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "settings");

function assetUrl(storedPath) {
  const file = path.basename(String(storedPath || ""));
  if (!file) return null;
  return `/v2/settings/web/assets/${encodeURIComponent(file)}`;
}

function bankPack(row, extra = {}) {
  return {
    prefix: extra.prefix || "1",
    start: String(row?.invoice_start_no || 1),
    gst_percent: extra.gst_percent || "18",
    bank_name: row?.invoice_bank_name || "",
    account_no: row?.invoice_account_no || "",
    ifsc: row?.invoice_ifsc || "",
    upi_id: extra.upi_id || "",
    terms: extra.terms || "",
    signature_path: row?.invoice_signature_path || null,
    signature_url: assetUrl(row?.invoice_signature_path),
  };
}

function rowToPublic(row) {
  if (!row) return null;
  const gst = bankPack(row, { prefix: "1", gst_percent: "18" });
  const nongst = bankPack(row, { prefix: "crm" });
  return {
    ...row,
    logo_url: assetUrl(row.logo_path),
    signature_url: assetUrl(row.invoice_signature_path),
    invoice_gst: gst,
    invoice_nongst: nongst,
    invoice_start_no: row.invoice_start_no || 1,
    invoice_template_key: row.invoice_template_key || "classic",
    invoice_currency: row.invoice_currency || "INR",
    invoice_hsn: "",
    theme_color: "#8bc34a",
  };
}

async function getCompanyRow() {
  return prisma.company_settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}

async function getWebSettings() {
  const row = await getCompanyRow();
  return { data: rowToPublic(row) };
}

async function updateWebSettings(patch) {
  const payload = {};
  const keys = [
    "company_name",
    "website",
    "phone",
    "email",
    "address",
    "city",
    "state",
    "country",
    "gst_number",
    "pan_number",
    "invoice_bank_name",
    "invoice_account_no",
    "invoice_ifsc",
    "invoice_currency",
    "invoice_gst_mode",
    "logo_path",
    "invoice_signature_path",
    "invoice_start_no",
    "invoice_template_key",
    "brochure_url",
  ];
  for (const key of keys) {
    if (patch[key] !== undefined) payload[key] = patch[key];
  }
  if (patch.invoice_gst && typeof patch.invoice_gst === "object") {
    if (patch.invoice_gst.bank_name != null) payload.invoice_bank_name = patch.invoice_gst.bank_name || null;
    if (patch.invoice_gst.account_no != null) payload.invoice_account_no = patch.invoice_gst.account_no || null;
    if (patch.invoice_gst.ifsc != null) payload.invoice_ifsc = patch.invoice_gst.ifsc || null;
    if (patch.invoice_gst.signature_path != null) payload.invoice_signature_path = patch.invoice_gst.signature_path;
    if (patch.invoice_gst.start != null) payload.invoice_start_no = Number(patch.invoice_gst.start) || 1;
  }
  payload.updated_at = new Date();
  const row = await prisma.company_settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...payload },
    update: payload,
  });
  return { data: rowToPublic(row) };
}

async function resetInvoiceStart(startNo) {
  const n = Math.max(1, Number.parseInt(String(startNo), 10) || 1);
  const row = await prisma.company_settings.upsert({
    where: { id: 1 },
    create: { id: 1, invoice_start_no: n },
    update: { invoice_start_no: n, updated_at: new Date() },
  });
  return { data: rowToPublic(row) };
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  return UPLOAD_ROOT;
}

function resolveWebAsset(fileName) {
  const file = path.basename(String(fileName || ""));
  if (!file) return null;
  const abs = path.join(UPLOAD_ROOT, file);
  if (!abs.startsWith(UPLOAD_ROOT) || !fs.existsSync(abs)) return null;
  return abs;
}

module.exports = {
  UPLOAD_ROOT,
  getWebSettings,
  updateWebSettings,
  resetInvoiceStart,
  ensureUploadDir,
  resolveWebAsset,
  rowToPublic,
  getCompanyRow,
};
