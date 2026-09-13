"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const {
  normalizeEmail,
  validEmail,
  normalizePhoneDigits,
  normalizePhoneStorage,
  parseImportDate,
  parseImportAmount,
  sanitizeField,
} = require("../utils/importSanitize");
const {
  parseImportFile,
  suggestColumnMapping,
  applyMapping,
  PREVIEW_ROWS,
  detectFileType,
  parseFileBuffer,
} = require("./leadImportParser");
const { parseStatusInput, legacyToV2 } = require("../utils/leadStatusMap");
const { emitLeadsChanged, emitUserEvent } = require("../realtime/meetingsRealtime");

const BATCH_SIZE = 50;
const IMPORT_MODES = new Set(["create_only", "update_only", "upsert"]);
const cancelFlags = new Set();

const LEAD_IMPORT_FIELDS = [
  { key: "external_id", label: "External ID", required: false },
  { key: "first_name", label: "First Name", required: true },
  { key: "last_name", label: "Last Name", required: true },
  { key: "name", label: "Full Name", required: false, nameGroup: true },
  { key: "phone", label: "Phone", required: false },
  { key: "phone_dial", label: "Phone Dial Code", required: false },
  { key: "email", label: "Email", required: false },
  { key: "company_name", label: "Company Name", required: false },
  { key: "source", label: "Source", required: false },
  { key: "status", label: "Status", required: false },
  { key: "label", label: "Label", required: false },
  { key: "designation", label: "Designation", required: false },
  { key: "industry", label: "Industry", required: false },
  { key: "department", label: "Department", required: false },
  { key: "product_category", label: "Product Category", required: false },
  { key: "team", label: "Team", required: false },
  { key: "account_relationship", label: "Account Relationship", required: false },
  { key: "followup_type", label: "Follow-up Type", required: false },
  { key: "follow_up_date", label: "Follow-up Date", required: false },
  { key: "followup_at", label: "Follow-up At", required: false },
  { key: "address_line1", label: "Address Line 1", required: false },
  { key: "address_line2", label: "Address Line 2", required: false },
  { key: "city", label: "City", required: false },
  { key: "state", label: "State", required: false },
  { key: "country", label: "Country", required: false },
  { key: "postal_code", label: "Postal Code", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "amount", label: "Amount", required: false },
  { key: "currency", label: "Currency", required: false },
  { key: "reference", label: "Reference", required: false },
  { key: "assigned_to", label: "Assigned To (ID or email)", required: false },
];

function importBaseDir() {
  return path.join(__dirname, "..", "..", "uploads", "imports");
}

function jobDir(userId, jobId) {
  return path.join(importBaseDir(), String(userId || "user"), jobId);
}

function formatJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    created_by: job.created_by,
    mode: job.mode,
    status: job.status,
    file_name: job.file_name,
    file_type: job.file_type,
    column_mapping: job.column_mapping || {},
    total_rows: job.total_rows,
    processed_rows: job.processed_rows,
    valid_rows: job.valid_rows,
    invalid_rows: job.invalid_rows,
    duplicate_rows: job.duplicate_rows,
    new_rows: job.new_rows,
    update_rows: job.update_rows,
    created_count: job.created_count,
    updated_count: job.updated_count,
    skipped_count: job.skipped_count,
    failed_count: job.failed_count,
    progress_pct: job.progress_pct,
    retry_of_job_id: job.retry_of_job_id,
    cancelled_by: job.cancelled_by,
    cancelled_at: job.cancelled_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function emitProgress(userId, job) {
  emitUserEvent(userId, "leads:import:progress", {
    jobId: job.id,
    status: job.status,
    progress_pct: job.progress_pct,
    summary: {
      total: job.total_rows,
      processed: job.processed_rows,
      created: job.created_count,
      updated: job.updated_count,
      skipped: job.skipped_count,
      failed: job.failed_count,
    },
  });
}

async function ensureNoActiveJob(excludeJobId = null) {
  const active = await prisma.lead_import_jobs.findFirst({
    where: {
      status: { in: ["validating", "processing"] },
      ...(excludeJobId ? { NOT: { id: excludeJobId } } : {}),
    },
    select: { id: true },
  });
  if (active) {
    const err = new Error("Another import is already in progress");
    err.status = 409;
    throw err;
  }
}

async function getJob(jobId) {
  const job = await prisma.lead_import_jobs.findUnique({ where: { id: jobId } });
  if (!job) {
    const err = new Error("Import job not found");
    err.status = 404;
    throw err;
  }
  return job;
}

async function buildLeadMatchIndex() {
  const rows = await prisma.leads.findMany({
    where: { is_deleted: false },
    select: { id: true, external_id: true, email: true, phone: true },
  });
  const byExternal = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  for (const r of rows) {
    if (r.external_id) byExternal.set(String(r.external_id).trim(), r.id);
    if (r.email) byEmail.set(normalizeEmail(r.email), r.id);
    if (r.phone) {
      const digits = normalizePhoneDigits(r.phone);
      if (digits) byPhone.set(digits, r.id);
    }
  }
  return { byExternal, byEmail, byPhone };
}

function matchLeadFromIndex(index, row) {
  const externalId = row.external_id ? String(row.external_id).trim() : "";
  if (externalId && index.byExternal.has(externalId)) return index.byExternal.get(externalId);
  const email = row.email ? normalizeEmail(row.email) : "";
  if (email && index.byEmail.has(email)) return index.byEmail.get(email);
  const phone = row.phone ? normalizePhoneDigits(row.phone) : "";
  if (phone && index.byPhone.has(phone)) return index.byPhone.get(phone);
  return null;
}

function fillNames(row) {
  let first = String(row.first_name || "").trim();
  let last = String(row.last_name || "").trim();
  if ((!first || !last) && row.name) {
    const parts = String(row.name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      first = first || parts[0];
      last = last || parts[0];
    } else if (parts.length > 1) {
      first = first || parts[0];
      last = last || parts.slice(1).join(" ");
    }
  }
  row.first_name = first;
  row.last_name = last;
  return row;
}

function validateMappedRow(row) {
  fillNames(row);
  const errors = [];
  const phone = normalizePhoneStorage(row.phone, row.phone_dial);
  if (!row.first_name || !row.last_name) {
    errors.push({ field: "name", message: "First name and last name are required" });
  }
  if (row.email && !validEmail(row.email)) {
    errors.push({ field: "email", message: "Invalid email format" });
  }
  const amountParsed = parseImportAmount(row.amount);
  if (amountParsed.error) errors.push({ field: "amount", message: amountParsed.error });
  const followDate = parseImportDate(row.follow_up_date);
  if (followDate.error) errors.push({ field: "follow_up_date", message: followDate.error });
  const followAt = parseImportDate(row.followup_at);
  if (followAt.error) errors.push({ field: "followup_at", message: followAt.error });
  return { errors, phone, amountParsed, followDate, followAt };
}

function rowAction(mode, matchId) {
  if (matchId) {
    if (mode === "create_only") return "skip_duplicate";
    return "update";
  }
  if (mode === "update_only") return "skip_no_match";
  return "create";
}

async function resolveAssignedUser(client, raw, fallbackId) {
  if (raw == null || raw === "") return fallbackId;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) {
    const byId = await client.users.findFirst({ where: { id: n, is_active: true }, select: { id: true } });
    if (byId) return byId.id;
  }
  const email = normalizeEmail(raw);
  if (email.includes("@")) {
    const user = await client.users.findFirst({
      where: { email, is_active: true },
      select: { id: true },
    });
    if (user) return user.id;
  }
  return fallbackId;
}

async function allocateLeadNumber(tx) {
  const agg = await tx.leads.aggregate({ _max: { lead_number: true } });
  const max = Number(agg?._max?.lead_number ?? 0);
  return (Number.isFinite(max) && max > 0 ? max : 0) + 1;
}

function buildLeadBodyFromRow(row, extras) {
  const body = {};
  for (const field of LEAD_IMPORT_FIELDS.map((f) => f.key)) {
    if (row[field] != null && row[field] !== "") {
      body[field] = sanitizeField(field, row[field]);
    }
  }
  if (extras?.phone) body.phone = extras.phone;
  if (extras?.amount != null) body.amount = extras.amount;
  if (extras?.follow_up_date) body.follow_up_date = extras.follow_up_date.toISOString().slice(0, 10);
  if (extras?.followup_at) {
    body.followup_at = extras.followup_at.toISOString().slice(0, 19).replace("T", " ");
  }
  if (row.notes) {
    body.notes = sanitizeField("notes", row.notes);
    body.comments_history = body.notes;
  }
  fillNames(body);
  return body;
}

function statusFromRow(raw) {
  const parsed = parseStatusInput({ status: raw, status_v2: raw }, "new");
  return {
    status: parsed.legacy || "processing",
    status_v2: String(parsed.v2 || legacyToV2(parsed.legacy) || "new").slice(0, 32),
    custom: Boolean(parsed.custom),
  };
}

async function registerRowOptions(tx, body, statusMeta) {
  const fields = ["source", "label", "account_relationship", "followup_type", "product_category", "team"];
  const values = fields.map((field) => ({ field, val: body[field] ? String(body[field]).trim() : "" }));
  if (statusMeta?.custom && statusMeta.status_v2) {
    values.push({ field: "status", val: String(statusMeta.status_v2).trim() });
  }
  for (const { field, val } of values) {
    if (!val) continue;
    try {
      await tx.dropdown_options.upsert({
        where: { field_name_option_value: { field_name: field, option_value: val } },
        update: { option_label: val },
        create: { field_name: field, option_value: val, option_label: val },
      });
    } catch {
      /* ignore duplicate races */
    }
  }
}

async function createLeadRecord(tx, userId, body) {
  fillNames(body);
  const displayName = String(body.name || `${body.first_name} ${body.last_name}`).trim().slice(0, 100);
  const phone = body.phone || "";
  const statusMeta = statusFromRow(body.status);
  const assignedUserId = await resolveAssignedUser(tx, body.assigned_to, userId);
  const leadNumber = await allocateLeadNumber(tx);
  await registerRowOptions(tx, body, statusMeta);

  return tx.leads.create({
    data: {
      lead_number: leadNumber,
      external_id: body.external_id || null,
      first_name: body.first_name,
      last_name: body.last_name,
      name: displayName,
      designation: body.designation || null,
      company_name: body.company_name || null,
      phone,
      phone_dial: body.phone_dial || null,
      email: body.email || null,
      source: body.source || "other",
      status: statusMeta.status,
      status_v2: statusMeta.status_v2,
      account_relationship: body.account_relationship || null,
      followup_type: body.followup_type || null,
      followup_at: body.followup_at ? new Date(String(body.followup_at).replace(" ", "T")) : null,
      follow_up_date: body.follow_up_date ? new Date(`${body.follow_up_date}T00:00:00.000Z`) : null,
      industry: body.industry || null,
      department: body.department || null,
      product_category: body.product_category || null,
      team: body.team || null,
      amount: new Prisma.Decimal(body.amount ?? 0),
      currency: body.currency || "INR",
      comments_history: body.comments_history || null,
      notes: body.notes || null,
      address_line1: body.address_line1 || null,
      address_line2: body.address_line2 || null,
      city: body.city || null,
      state: body.state || null,
      country: body.country || null,
      postal_code: body.postal_code || null,
      label: body.label || null,
      reference: body.reference || null,
      assigned_to: assignedUserId,
      created_by: userId,
      updated_by: userId,
      last_touched_at: new Date(),
    },
  });
}

async function updateLeadRecord(tx, userId, leadId, body) {
  fillNames(body);
  const displayName = String(body.name || `${body.first_name || ""} ${body.last_name || ""}`).trim();
  const statusMeta = body.status ? statusFromRow(body.status) : null;
  await registerRowOptions(tx, body, statusMeta || { custom: false });

  const data = { updated_by: userId, last_touched_at: new Date(), updated_at: new Date() };
  if (body.external_id) data.external_id = body.external_id;
  if (body.first_name) data.first_name = body.first_name;
  if (body.last_name) data.last_name = body.last_name;
  if (displayName) data.name = displayName.slice(0, 100);
  if (body.designation !== undefined) data.designation = body.designation || null;
  if (body.company_name !== undefined) data.company_name = body.company_name || null;
  if (body.phone !== undefined) data.phone = body.phone || "";
  if (body.phone_dial !== undefined) data.phone_dial = body.phone_dial || null;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.source) data.source = body.source;
  if (statusMeta) {
    data.status = statusMeta.status;
    data.status_v2 = statusMeta.status_v2;
  }
  if (body.account_relationship !== undefined) data.account_relationship = body.account_relationship || null;
  if (body.followup_type !== undefined) data.followup_type = body.followup_type || null;
  if (body.followup_at !== undefined) {
    data.followup_at = body.followup_at ? new Date(String(body.followup_at).replace(" ", "T")) : null;
  }
  if (body.follow_up_date !== undefined) {
    data.follow_up_date = body.follow_up_date ? new Date(`${body.follow_up_date}T00:00:00.000Z`) : null;
  }
  if (body.industry !== undefined) data.industry = body.industry || null;
  if (body.department !== undefined) data.department = body.department || null;
  if (body.product_category !== undefined) data.product_category = body.product_category || null;
  if (body.team !== undefined) data.team = body.team || null;
  if (body.amount !== undefined) data.amount = new Prisma.Decimal(body.amount ?? 0);
  if (body.currency) data.currency = body.currency;
  if (body.notes !== undefined) {
    data.notes = body.notes || null;
    data.comments_history = body.comments_history || body.notes || null;
  }
  if (body.address_line1 !== undefined) data.address_line1 = body.address_line1 || null;
  if (body.address_line2 !== undefined) data.address_line2 = body.address_line2 || null;
  if (body.city !== undefined) data.city = body.city || null;
  if (body.state !== undefined) data.state = body.state || null;
  if (body.country !== undefined) data.country = body.country || null;
  if (body.postal_code !== undefined) data.postal_code = body.postal_code || null;
  if (body.label !== undefined) data.label = body.label || null;
  if (body.reference !== undefined) data.reference = body.reference || null;
  if (body.assigned_to !== undefined && body.assigned_to !== "") {
    data.assigned_to = await resolveAssignedUser(tx, body.assigned_to, userId);
  }

  await tx.leads.updateMany({ where: { id: leadId, is_deleted: false }, data });
}

async function createUploadJob({ userId, file }) {
  const fileType = detectFileType(file.originalname, file.mimetype);
  if (!fileType) {
    const err = new Error("Only CSV and XLSX files are allowed");
    err.status = 400;
    throw err;
  }
  const parsed = await parseFileBuffer(file.buffer, fileType);
  if (!parsed.headers.length) {
    const err = new Error("File has no header row");
    err.status = 400;
    throw err;
  }
  if (!parsed.rows.length) {
    const err = new Error("File has no data rows");
    err.status = 400;
    throw err;
  }

  const jobId = crypto.randomUUID();
  const dir = jobDir(userId, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = String(file.originalname || "import").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, file.buffer);

  const suggestedMapping = suggestColumnMapping(parsed.headers);
  const job = await prisma.lead_import_jobs.create({
    data: {
      id: jobId,
      created_by: userId,
      mode: "upsert",
      status: "uploaded",
      file_name: safeName,
      file_type: fileType,
      file_path: filePath,
      column_mapping: suggestedMapping,
      total_rows: parsed.rows.length,
    },
  });

  return {
    job: formatJob(job),
    headers: parsed.headers,
    previewRows: parsed.rows.slice(0, PREVIEW_ROWS),
    suggestedMapping,
  };
}

async function saveJobMapping({ jobId, columnMapping, mode }) {
  const job = await getJob(jobId);
  if (!["uploaded", "mapped", "validated"].includes(job.status)) {
    const err = new Error("Job cannot be remapped in current status");
    err.status = 400;
    throw err;
  }
  const nextMode = mode && IMPORT_MODES.has(mode) ? mode : job.mode;
  const updated = await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: {
      column_mapping: columnMapping || {},
      mode: nextMode,
      status: "mapped",
      updated_at: new Date(),
    },
  });
  return formatJob(updated);
}

async function validateImportJob({ jobId, mode }) {
  await ensureNoActiveJob(jobId);
  let job = await getJob(jobId);
  if (!["uploaded", "mapped", "validated"].includes(job.status)) {
    const err = new Error("Job cannot be validated in current status");
    err.status = 400;
    throw err;
  }
  const importMode = mode && IMPORT_MODES.has(mode) ? mode : job.mode;
  await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: { status: "validating", mode: importMode, updated_at: new Date() },
  });

  const parsed = await parseImportFile(job.file_path, job.file_type);
  const mappedRows = applyMapping(parsed.rows, job.column_mapping || {});
  const matchIndex = await buildLeadMatchIndex();
  const seenExternal = new Set();
  const seenEmail = new Set();
  const seenPhone = new Set();
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;
  let newRows = 0;
  let updateRows = 0;
  await prisma.lead_import_errors.deleteMany({ where: { job_id: jobId } });
  const errorRecords = [];

  for (const row of mappedRows) {
    const rowNum = row.__rowNumber;
    const { errors, phone } = validateMappedRow(row);
    if (!errors.length) {
      const ext = row.external_id ? String(row.external_id).trim() : "";
      const email = row.email ? normalizeEmail(row.email) : "";
      const phoneKey = normalizePhoneDigits(phone);
      if (ext && seenExternal.has(ext)) errors.push({ field: "external_id", message: "Duplicate external_id in file" });
      if (email && seenEmail.has(email)) errors.push({ field: "email", message: "Duplicate email in file" });
      if (phoneKey && seenPhone.has(phoneKey)) errors.push({ field: "phone", message: "Duplicate phone in file" });
      if (ext) seenExternal.add(ext);
      if (email) seenEmail.add(email);
      if (phoneKey) seenPhone.add(phoneKey);
    }
    if (errors.length) {
      invalidRows += 1;
      for (const e of errors) {
        errorRecords.push({
          job_id: jobId,
          row_number: rowNum,
          field: e.field,
          message: e.message,
          raw_data: row,
          severity: "error",
        });
      }
      continue;
    }
    const matchId = matchLeadFromIndex(matchIndex, { ...row, phone });
    const action = rowAction(importMode, matchId);
    if (action === "skip_duplicate" || action === "skip_no_match") {
      duplicateRows += 1;
      validRows += 1;
      continue;
    }
    if (action === "create") newRows += 1;
    if (action === "update") updateRows += 1;
    validRows += 1;
  }

  if (errorRecords.length) {
    for (let i = 0; i < errorRecords.length; i += 200) {
      await prisma.lead_import_errors.createMany({ data: errorRecords.slice(i, i + 200) });
    }
  }

  job = await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: {
      status: "validated",
      mode: importMode,
      total_rows: mappedRows.length,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      duplicate_rows: duplicateRows,
      new_rows: newRows,
      update_rows: updateRows,
      processed_rows: 0,
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      failed_count: 0,
      progress_pct: 0,
      updated_at: new Date(),
    },
  });
  return formatJob(job);
}

async function isJobCancelled(jobId) {
  if (cancelFlags.has(jobId)) return true;
  const job = await prisma.lead_import_jobs.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "cancelled";
}

async function processImportJob({ userId, jobId }) {
  let job = await getJob(jobId);
  if (job.status !== "validated") {
    const err = new Error("Job must be validated before running");
    err.status = 400;
    throw err;
  }
  cancelFlags.delete(jobId);
  const importMode = job.mode;
  const parsed = await parseImportFile(job.file_path, job.file_type);
  const mappedRows = applyMapping(parsed.rows, job.column_mapping || {});
  const matchIndex = await buildLeadMatchIndex();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: { status: "processing", started_at: new Date(), updated_at: new Date() },
  });

  const processable = [];
  for (const row of mappedRows) {
    const { errors, phone, amountParsed, followDate, followAt } = validateMappedRow(row);
    if (errors.length) {
      skipped += 1;
      continue;
    }
    const matchId = matchLeadFromIndex(matchIndex, { ...row, phone });
    const action = rowAction(importMode, matchId);
    if (action === "skip_duplicate" || action === "skip_no_match") {
      skipped += 1;
      continue;
    }
    processable.push({
      row,
      action,
      matchId,
      extras: {
        phone,
        amount: amountParsed.amount,
        follow_up_date: followDate.date,
        followup_at: followAt.date,
      },
    });
  }

  for (let i = 0; i < processable.length; i += BATCH_SIZE) {
    if (await isJobCancelled(jobId)) break;
    const batch = processable.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const item of batch) {
            const body = buildLeadBodyFromRow(item.row, item.extras);
            if (item.action === "create") {
              await createLeadRecord(tx, userId, body);
              created += 1;
            } else if (item.action === "update" && item.matchId) {
              await updateLeadRecord(tx, userId, item.matchId, body);
              updated += 1;
            }
            processed += 1;
          }
        },
        { timeout: 60000 }
      );
    } catch (batchErr) {
      console.error("lead import batch", batchErr.message);
      for (const item of batch) {
        failed += 1;
        processed += 1;
        await prisma.lead_import_errors.create({
          data: {
            job_id: jobId,
            row_number: item.row.__rowNumber,
            field: null,
            message: "Import failed for this row",
            raw_data: item.row,
            severity: "error",
          },
        });
      }
    }

    const progressPct = processable.length
      ? Math.min(100, Math.round((processed / processable.length) * 100))
      : 100;
    job = await prisma.lead_import_jobs.update({
      where: { id: jobId },
      data: {
        processed_rows: processed,
        created_count: created,
        updated_count: updated,
        skipped_count: skipped,
        failed_count: failed,
        progress_pct: progressPct,
        updated_at: new Date(),
      },
    });
    emitProgress(userId, job);
  }

  const cancelled = await isJobCancelled(jobId);
  const finalStatus = cancelled ? "cancelled" : failed && !created && !updated ? "failed" : "completed";
  job = await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      processed_rows: processed,
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      failed_count: failed,
      progress_pct: 100,
      completed_at: new Date(),
      updated_at: new Date(),
    },
  });
  cancelFlags.delete(jobId);
  emitProgress(userId, job);
  if (finalStatus === "completed") {
    emitLeadsChanged({ action: "import", jobId });
  }
  return formatJob(job);
}

async function runImportJob({ userId, jobId, mode }) {
  await ensureNoActiveJob();
  const job = await getJob(jobId);
  if (job.status === "processing") return formatJob(job);
  if (job.status !== "validated") {
    if (mode && IMPORT_MODES.has(mode) && job.status === "mapped") {
      await validateImportJob({ jobId, mode });
    } else {
      const err = new Error("Validate the import before running");
      err.status = 400;
      throw err;
    }
  }
  if (mode && IMPORT_MODES.has(mode)) {
    await prisma.lead_import_jobs.update({ where: { id: jobId }, data: { mode } });
  }
  return { job: formatJob(await getJob(jobId)), async: true };
}

async function cancelImportJob({ userId, jobId }) {
  const job = await getJob(jobId);
  if (!["validating", "processing"].includes(job.status)) {
    const err = new Error("Job is not active");
    err.status = 400;
    throw err;
  }
  cancelFlags.add(jobId);
  const updated = await prisma.lead_import_jobs.update({
    where: { id: jobId },
    data: {
      status: "cancelled",
      cancelled_by: userId,
      cancelled_at: new Date(),
      completed_at: new Date(),
      updated_at: new Date(),
    },
  });
  emitProgress(userId, updated);
  return formatJob(updated);
}

async function retryImportJob({ userId, jobId }) {
  const job = await getJob(jobId);
  if (!["completed", "failed", "cancelled"].includes(job.status)) {
    const err = new Error("Job cannot be retried yet");
    err.status = 400;
    throw err;
  }
  const errors = await prisma.lead_import_errors.findMany({
    where: { job_id: jobId, severity: "error" },
    orderBy: { row_number: "asc" },
  });
  if (!errors.length) {
    const err = new Error("No failed rows to retry");
    err.status = 400;
    throw err;
  }
  const newJobId = crypto.randomUUID();
  const dir = jobDir(userId, newJobId);
  fs.mkdirSync(dir, { recursive: true });
  const retryFileName = "retry.csv";
  const filePath = path.join(dir, retryFileName);
  const headers = LEAD_IMPORT_FIELDS.map((f) => f.key);
  const lines = [headers.join(",")];
  for (const errRow of errors) {
    const raw = errRow.raw_data && typeof errRow.raw_data === "object" ? errRow.raw_data : {};
    const cols = headers.map((h) => {
      const v = raw[h] != null ? String(raw[h]) : "";
      return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    });
    lines.push(cols.join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  const mapping = {};
  for (const h of headers) mapping[h] = h;
  const created = await prisma.lead_import_jobs.create({
    data: {
      id: newJobId,
      created_by: userId,
      mode: job.mode,
      status: "mapped",
      file_name: retryFileName,
      file_type: "csv",
      file_path: filePath,
      column_mapping: mapping,
      total_rows: errors.length,
      retry_of_job_id: jobId,
    },
  });
  return formatJob(created);
}

async function listImportJobs({ page = 1, limit = 20 }) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = Math.max((Number(page) || 1) - 1, 0) * take;
  const [rows, total] = await Promise.all([
    prisma.lead_import_jobs.findMany({ orderBy: { created_at: "desc" }, skip, take }),
    prisma.lead_import_jobs.count(),
  ]);
  return { jobs: rows.map(formatJob), pagination: { page: Number(page) || 1, limit: take, total } };
}

async function getImportJob({ jobId }) {
  return formatJob(await getJob(jobId));
}

async function buildErrorsCsv({ jobId }) {
  await getJob(jobId);
  const errors = await prisma.lead_import_errors.findMany({
    where: { job_id: jobId },
    orderBy: [{ row_number: "asc" }, { id: "asc" }],
  });
  const header = "row_number,field,severity,message\n";
  const lines = errors.map((e) => {
    const msg = String(e.message || "").replace(/"/g, '""');
    const field = String(e.field || "").replace(/"/g, '""');
    return `${e.row_number},"${field}","${e.severity}","${msg}"`;
  });
  return header + lines.join("\n");
}

module.exports = {
  LEAD_IMPORT_FIELDS,
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
};
