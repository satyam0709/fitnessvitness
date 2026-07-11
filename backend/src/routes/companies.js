const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { emitContactsChanged, emitAdminChanged, emitUserEvent } = require("../realtime/meetingsRealtime");

const router = express.Router();
router.use(verifyToken);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
const allowedMimes = ["image/jpeg", "image/png", "image/webp", "text/csv", "application/pdf"];

function validateSingleUploadMime(req, res, next) {
  if (req.file && !allowedMimes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "File type not allowed" });
  }
  return next();
}

const REL_TYPES = new Set(["Competitor", "Customer", "Integrator", "Other", "Partner", "Prospect", "Vendor"]);

function clean(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"|"$/g, "").trim());
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}

function buildCompanyImportPayload(r) {
  return {
    account_name: clean(pick(r, ["account_name", "company_name", "name", "company", "organization", "org"]), 180),
    account_relationship: clean(pick(r, ["account_relationship", "relationship", "type"]), 80),
    phone: clean(pick(r, ["phone", "mobile", "phone_number", "telephone"]), 30),
    email: clean(pick(r, ["email", "email_address", "mail"]), 180),
    industry: clean(pick(r, ["industry"]), 120),
    street: clean(pick(r, ["street", "address", "address_line_1"]), 255),
    city: clean(pick(r, ["city"]), 120),
    state: clean(pick(r, ["state", "province"]), 120),
    country: clean(pick(r, ["country"]), 120),
    postal_code: clean(pick(r, ["postal_code", "pincode", "zip", "zipcode"]), 20),
    website: clean(pick(r, ["website", "url", "company_website"]), 255),
    notes: clean(pick(r, ["notes", "note", "comment", "remarks"]), 4000),
  };
}

async function syncCompanyPrimaryContact({ tenantId, userId, company }) {
  if (!company?.id || !userId) return;
  const accountName = clean(company.account_name, 180);
  if (!accountName) return;

  const existing = await prisma.contacts.findFirst({
    where: { company_id: company.id },
    orderBy: [
      { updated_at: "desc" },
      { id: "desc" }
    ],
  });

  const contactName = existing?.contact_name || accountName;
  const designation = existing?.designation || "Primary Contact";
  const department = existing?.department || clean(company.industry, 120);

  const contactData = {
    company_name: accountName,
    contact_name: contactName,
    designation,
    account_relationship: clean(company.account_relationship, 80),
    department,
    email: clean(company.email, 180),
    phone: clean(company.phone, 30),
    street: clean(company.street, 255),
    city: clean(company.city, 120),
    state: clean(company.state, 120),
    country: clean(company.country, 120),
    postal_code: clean(company.postal_code, 20),
    website: clean(company.website, 255),
    notes: clean(company.notes, 4000),
  };

  if (existing) {
    await prisma.contacts.update({
      where: { id: existing.id },
      data: contactData,
    });
  } else {
    await prisma.contacts.create({
      data: {
        ...contactData,
        company_id: company.id,
        created_by: userId,
      },
    });
  }
}

function whereScope(req) {
  const conditions = [{ is_deleted: false }];
  if (!canSeeAllTeamRecords(req)) {
    conditions.push({
      OR: [
        { created_by: req.user.id },
        { assigned_to: req.user.id }
      ]
    });
  }
  return conditions;
}

router.get("/", async (req, res) => {
  try {
    const { q, account_relationship, city, state, industry, assigned_to, include_breakdown, starred } = req.query;
    const conditions = whereScope(req);

    if (q && String(q).trim()) {
      const searchStr = String(q).trim();
      conditions.push({
        OR: [
          { account_name: { contains: searchStr } },
          { phone: { contains: searchStr } },
          { email: { contains: searchStr } },
          { industry: { contains: searchStr } },
          { street: { contains: searchStr } },
          { city: { contains: searchStr } },
          { state: { contains: searchStr } },
        ]
      });
    }
    const rel = clean(account_relationship, 80);
    if (rel) {
      conditions.push({ account_relationship: rel });
    }
    const cityV = clean(city, 120);
    if (cityV) {
      conditions.push({ city: cityV });
    }
    const stateV = clean(state, 120);
    if (stateV) {
      conditions.push({ state: stateV });
    }
    const ind = clean(industry, 120);
    if (ind) {
      conditions.push({ industry: ind });
    }
    if (assigned_to === "__none__") {
      conditions.push({ assigned_to: null });
    } else if (assigned_to && Number.isInteger(Number(assigned_to))) {
      conditions.push({ assigned_to: Number(assigned_to) });
    }
    if (String(starred || "") === "1") {
      conditions.push({ is_starred: true });
    }

    const companiesList = await prisma.companies.findMany({
      where: { AND: conditions },
      orderBy: [
        { updated_at: "desc" },
        { id: "desc" }
      ]
    });

    const companyNames = companiesList.map((c) => c.account_name);
    const contactsCounts = await prisma.contacts.groupBy({
      by: ["company_name"],
      where: { company_name: { in: companyNames } },
      _count: { id: true }
    });

    const countsMap = {};
    for (const item of contactsCounts) {
      countsMap[item.company_name] = item._count.id;
    }

    const rows = companiesList.map((c) => ({
      ...c,
      contacts_count: countsMap[c.account_name] || 0
    }));

    let relationshipBreakdown = null;
    if (String(include_breakdown || "") === "1") {
      const countsMapBr = {};
      for (const row of rows) {
        const relationshipVal = String(row.account_relationship || "").trim();
        const bucket = relationshipVal === "" ? "Other" : relationshipVal;
        countsMapBr[bucket] = (countsMapBr[bucket] || 0) + 1;
      }
      relationshipBreakdown = Object.entries(countsMapBr)
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    }

    res.json({ success: true, total: rows.length, data: rows, relationshipBreakdown });
  } catch (err) {
    console.error("GET /api/companies", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/leads", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const company = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      },
      select: { account_name: true }
    });
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const leadConditions = [{ is_deleted: false, company_name: company.account_name }];
    if (!canSeeAllTeamRecords(req)) {
      leadConditions.push({
        OR: [
          { created_by: req.user.id },
          { assigned_to: req.user.id }
        ]
      });
    }

    const leads = await prisma.leads.findMany({
      where: { AND: leadConditions },
      orderBy: [
        { updated_at: "desc" },
        { id: "desc" }
      ]
    });
    res.json({ success: true, data: leads });
  } catch (err) {
    console.error("GET /api/companies/:id/leads", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/contacts", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const company = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      },
      select: { account_name: true }
    });
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const contactConditions = [
      {
        OR: [
          { company_id: id },
          { company_name: company.account_name }
        ]
      }
    ];

    if (!canSeeAllTeamRecords(req)) {
      contactConditions.push({
        OR: [
          { created_by: req.user.id },
          { assigned_to: req.user.id }
        ]
      });
    }

    const contactsList = await prisma.contacts.findMany({
      where: { AND: contactConditions },
      orderBy: [
        { updated_at: "desc" },
        { id: "desc" }
      ]
    });
    res.json({ success: true, data: contactsList });
  } catch (err) {
    console.error("GET /api/companies/:id/contacts", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const company = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      }
    });
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const contactsList = await prisma.contacts.findMany({
      where: { company_name: company.account_name },
      orderBy: { updated_at: "desc" }
    });
    res.json({ success: true, data: { ...company, contacts: contactsList } });
  } catch (err) {
    console.error("GET /api/companies/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const accountName = clean(req.body?.account_name, 180);
    if (!accountName) return res.status(400).json({ success: false, message: "account_name is required" });
    const rel = clean(req.body?.account_relationship, 80) || "Customer";
    if (!REL_TYPES.has(rel)) return res.status(400).json({ success: false, message: "Invalid account_relationship" });
    const assignedTo = req.body?.assigned_to != null ? Number(req.body.assigned_to) || null : null;

    const createdCompany = await prisma.companies.create({
      data: {
        account_name: accountName,
        account_relationship: rel,
        phone: clean(req.body?.phone, 30),
        email: clean(req.body?.email, 180),
        industry: clean(req.body?.industry, 120),
        street: clean(req.body?.street, 255),
        city: clean(req.body?.city, 120),
        state: clean(req.body?.state, 120),
        country: clean(req.body?.country, 120),
        postal_code: clean(req.body?.postal_code, 20),
        website: clean(req.body?.website, 255),
        notes: clean(req.body?.notes, 4000),
        assigned_to: assignedTo,
        created_by: req.user.id,
      }
    });

    await syncCompanyPrimaryContact({ tenantId: req.user?.tenantId || null, userId: req.user.id, company: createdCompany });
    emitContactsChanged({ reason: "companies:create", id: createdCompany.id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "create", tenantId: req.user?.tenantId || null });
    res.status(201).json({ success: true, data: createdCompany });
  } catch (err) {
    console.error("POST /api/companies", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const existing = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Company not found" });

    const rel = req.body?.account_relationship != null ? clean(req.body?.account_relationship, 80) : existing.account_relationship;
    if (rel && !REL_TYPES.has(rel)) return res.status(400).json({ success: false, message: "Invalid account_relationship" });

    const nextName = req.body?.account_name != null ? clean(req.body?.account_name, 180) : existing.account_name;
    if (!nextName) return res.status(400).json({ success: false, message: "account_name cannot be empty" });

    const updatedCompany = await prisma.companies.update({
      where: { id },
      data: {
        account_name: nextName,
        account_relationship: rel || "Other",
        phone: req.body?.phone !== undefined ? clean(req.body?.phone, 30) : existing.phone,
        email: req.body?.email !== undefined ? clean(req.body?.email, 180) : existing.email,
        industry: req.body?.industry !== undefined ? clean(req.body?.industry, 120) : existing.industry,
        street: req.body?.street !== undefined ? clean(req.body?.street, 255) : existing.street,
        city: req.body?.city !== undefined ? clean(req.body?.city, 120) : existing.city,
        state: req.body?.state !== undefined ? clean(req.body?.state, 120) : existing.state,
        country: req.body?.country !== undefined ? clean(req.body?.country, 120) : existing.country,
        postal_code: req.body?.postal_code !== undefined ? clean(req.body?.postal_code, 20) : existing.postal_code,
        website: req.body?.website !== undefined ? clean(req.body?.website, 255) : existing.website,
        notes: req.body?.notes !== undefined ? clean(req.body?.notes, 4000) : existing.notes,
        assigned_to: req.body?.assigned_to !== undefined ? Number(req.body?.assigned_to) || null : existing.assigned_to,
      }
    });

    if (existing.account_name !== nextName) {
      await prisma.contacts.updateMany({
        where: { company_name: existing.account_name },
        data: { company_name: nextName }
      });
    }

    await syncCompanyPrimaryContact({ tenantId: req.user?.tenantId || null, userId: req.user.id, company: updatedCompany });
    emitContactsChanged({ reason: "companies:update", id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "update", tenantId: req.user?.tenantId || null });
    res.json({ success: true, data: updatedCompany });
  } catch (err) {
    console.error("PUT /api/companies/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const existing = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Company not found" });

    await prisma.companies.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date()
      }
    });

    emitContactsChanged({ reason: "companies:delete", id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "delete", tenantId: req.user?.tenantId || null });
    res.json({ success: true, message: "Company deleted" });
  } catch (err) {
    console.error("DELETE /api/companies/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/star", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });

    const existing = await prisma.companies.findFirst({
      where: {
        id,
        is_deleted: false,
        AND: whereScope(req)
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Company not found" });

    const starred = req.body?.starred ? true : false;
    await prisma.companies.update({
      where: { id },
      data: { is_starred: starred }
    });

    emitContactsChanged({ reason: "companies:star", id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "star", tenantId: req.user?.tenantId || null });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/companies/:id/star", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/merge", async (req, res) => {
  try {
    const keepId = Number(req.body?.keep_id);
    const mergeId = Number(req.body?.merge_id);
    if (!keepId || !mergeId || keepId === mergeId) {
      return res.status(400).json({ success: false, message: "Valid keep_id and merge_id are required" });
    }

    await prisma.$transaction(async (tx) => {
      const keep = await tx.companies.findFirst({
        where: { id: keepId, is_deleted: false, AND: whereScope(req) }
      });
      const merge = await tx.companies.findFirst({
        where: { id: mergeId, is_deleted: false, AND: whereScope(req) }
      });

      if (!keep || !merge) {
        throw new Error("NOT_FOUND");
      }

      const merged = {
        account_name: keep.account_name || merge.account_name || null,
        account_relationship: keep.account_relationship || merge.account_relationship || "Other",
        phone: keep.phone || merge.phone || null,
        email: keep.email || merge.email || null,
        industry: keep.industry || merge.industry || null,
        street: keep.street || merge.street || null,
        city: keep.city || merge.city || null,
        state: keep.state || merge.state || null,
        country: keep.country || merge.country || null,
        postal_code: keep.postal_code || merge.postal_code || null,
        website: keep.website || merge.website || null,
        notes: [keep.notes, merge.notes].filter(Boolean).join("\n\n--- Merged Notes ---\n\n") || null,
        assigned_to: keep.assigned_to || merge.assigned_to || null,
      };

      await tx.companies.update({
        where: { id: keepId },
        data: {
          account_name: merged.account_name,
          account_relationship: REL_TYPES.has(merged.account_relationship) ? merged.account_relationship : "Other",
          phone: merged.phone,
          email: merged.email,
          industry: merged.industry,
          street: merged.street,
          city: merged.city,
          state: merged.state,
          country: merged.country,
          postal_code: merged.postal_code,
          website: merged.website,
          notes: merged.notes,
          assigned_to: merged.assigned_to,
        }
      });

      await tx.contacts.updateMany({
        where: { company_id: mergeId },
        data: { company_id: keepId, company_name: merged.account_name }
      });

      await tx.contacts.updateMany({
        where: { company_name: merge.account_name },
        data: { company_id: keepId, company_name: merged.account_name }
      });

      await tx.companies.update({
        where: { id: mergeId },
        data: {
          is_deleted: true,
          deleted_at: new Date()
        }
      });
    });

    emitContactsChanged({
      reason: "companies:merge",
      keep_id: keepId,
      merge_id: mergeId,
      tenantId: req.user.tenantId,
      userId: req.user.id,
    });
    emitAdminChanged({ scope: "companies", action: "merge", tenantId: req.user.tenantId });
    res.json({ success: true, message: "Companies merged successfully", keep_id: keepId, merge_id: mergeId });
  } catch (err) {
    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: "One or both companies not found" });
    }
    console.error("POST /api/companies/merge", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/import", upload.single("file"), validateSingleUploadMime, async (req, res) => {
  try {
    const mode = String(req.body?.mode || "create_only").trim();
    if (!["create_only", "update_only", "upsert"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Invalid mode" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "CSV file is required" });
    }

    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return res.status(400).json({ success: false, message: "CSV must contain header and at least one row" });
    }

    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] ?? "";
      });
      return obj;
    });

    const summary = { total: rows.length, processed: 0, created: 0, updated: 0, skipped: 0, errors: [] };
    const maxErrors = 100;
    const jobId = clean(req.body?.job_id, 120) || `companies-import-${Date.now()}`;
    const progressEvery = rows.length > 2000 ? 250 : rows.length > 500 ? 100 : 25;
    const pushProgress = (status = "running") => {
      emitUserEvent(req.user.id, "companies:import:progress", {
        jobId,
        status,
        mode,
        summary: {
          total: summary.total,
          processed: summary.processed,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errors: summary.errors,
        },
      });
    };

    pushProgress("running");
    res.status(202).json({
      success: true,
      accepted: true,
      mode,
      jobId,
      summary,
    });

    void (async () => {
      try {
        for (let i = 0; i < rows.length; i += 1) {
          const rowNum = i + 2;
          const payload = buildCompanyImportPayload(rows[i]);
          const accountName = payload.account_name;
          let rel = payload.account_relationship || "Customer";
          if (rel && !REL_TYPES.has(rel)) rel = "Other";

          if (!accountName) {
            summary.skipped += 1;
            if (summary.errors.length < maxErrors) summary.errors.push(`Row ${rowNum}: account_name is required`);
            summary.processed += 1;
            if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
            continue;
          }

          let existing = null;
          if (payload.email) {
            existing = await prisma.companies.findFirst({
              where: { is_deleted: false, email: payload.email }
            });
          }
          if (!existing) {
            existing = await prisma.companies.findFirst({
              where: { is_deleted: false, account_name: accountName }
            });
          }

          if (mode === "create_only" && existing) {
            summary.skipped += 1;
            summary.processed += 1;
            if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
            continue;
          }
          if (mode === "update_only" && !existing) {
            summary.skipped += 1;
            summary.processed += 1;
            if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
            continue;
          }

          let targetCompany = null;
          if (existing) {
            targetCompany = await prisma.companies.update({
              where: { id: existing.id },
              data: {
                account_name: accountName,
                account_relationship: rel,
                phone: payload.phone,
                email: payload.email,
                industry: payload.industry,
                street: payload.street,
                city: payload.city,
                state: payload.state,
                country: payload.country,
                postal_code: payload.postal_code,
                website: payload.website,
                notes: payload.notes,
              }
            });
            summary.updated += 1;
          } else {
            targetCompany = await prisma.companies.create({
              data: {
                account_name: accountName,
                account_relationship: rel,
                phone: payload.phone,
                email: payload.email,
                industry: payload.industry,
                street: payload.street,
                city: payload.city,
                state: payload.state,
                country: payload.country,
                postal_code: payload.postal_code,
                website: payload.website,
                notes: payload.notes,
                created_by: req.user.id,
              }
            });
            summary.created += 1;
          }

          await syncCompanyPrimaryContact({ tenantId: req.user.tenantId, userId: req.user.id, company: targetCompany });
          summary.processed += 1;
          if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
        }

        pushProgress("completed");
        emitContactsChanged({
          reason: "companies:import_completed",
          jobId,
          mode,
          total: summary.total,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          userId: req.user.id,
          tenantId: req.user.tenantId,
        });
        emitAdminChanged({ scope: "companies", action: "import", tenantId: req.user.tenantId });
      } catch (jobErr) {
        console.error("companies import job error", jobErr);
        emitUserEvent(req.user.id, "companies:import:progress", {
          jobId,
          status: "failed",
          mode,
          error: jobErr.message,
          summary,
        });
      }
    })();
  } catch (err) {
    console.error("POST /api/companies/import", err);
    emitUserEvent(req.user.id, "companies:import:progress", {
      jobId: clean(req.body?.job_id, 120) || null,
      status: "failed",
      mode: String(req.body?.mode || "create_only").trim(),
      error: err.message,
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
