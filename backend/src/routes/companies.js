const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { resolveTenantContext, enforceSubscription } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { emitContactsChanged, emitAdminChanged, emitUserEvent } = require("../realtime/meetingsRealtime");

function leadListScope(req, alias = "l") {
  const parts = [`${alias}.is_deleted = 0`, `${alias}.tenant_id = ?`];
  const params = [req.user.tenantId];
  if (!canSeeAllTeamRecords(req)) {
    parts.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

const router = express.Router();
router.use(verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription());
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
  if (!company?.id || !tenantId || !userId) return;
  const accountName = clean(company.account_name, 180);
  if (!accountName) return;

  const [existingRows] = await pool.execute(
    `SELECT id, contact_name, designation, department
     FROM contacts
     WHERE tenant_id = ? AND company_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [tenantId, company.id]
  );
  const existing = existingRows[0] || null;

  const contactName = existing?.contact_name || accountName;
  const designation = existing?.designation || "Primary Contact";
  const department = existing?.department || clean(company.industry, 120);

  if (existing) {
    await pool.execute(
      `UPDATE contacts
       SET company_name = ?, contact_name = ?, designation = ?, account_relationship = ?, department = ?,
           email = ?, phone = ?, street = ?, city = ?, state = ?, country = ?, postal_code = ?,
           website = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [
        accountName,
        contactName,
        designation,
        clean(company.account_relationship, 80),
        department,
        clean(company.email, 180),
        clean(company.phone, 30),
        clean(company.street, 255),
        clean(company.city, 120),
        clean(company.state, 120),
        clean(company.country, 120),
        clean(company.postal_code, 20),
        clean(company.website, 255),
        clean(company.notes, 4000),
        existing.id,
        tenantId,
      ]
    );
  } else {
    await pool.execute(
      `INSERT INTO contacts
       (tenant_id, company_id, company_name, contact_name, designation, account_relationship, department,
        email, phone, street, city, state, country, postal_code, website, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        company.id,
        accountName,
        contactName,
        designation,
        clean(company.account_relationship, 80),
        department,
        clean(company.email, 180),
        clean(company.phone, 30),
        clean(company.street, 255),
        clean(company.city, 120),
        clean(company.state, 120),
        clean(company.country, 120),
        clean(company.postal_code, 20),
        clean(company.website, 255),
        clean(company.notes, 4000),
        userId,
      ]
    );
  }
}

function whereScope(req, alias = "c") {
  const where = [`${alias}.is_deleted = 0`, `${alias}.tenant_id = ?`];
  const params = [req.user.tenantId];
  if (!canSeeAllTeamRecords(req)) {
    where.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: where.join(" AND "), params };
}

router.get("/", async (req, res) => {
  try {
    const { q, account_relationship, city, state, industry, assigned_to, include_breakdown, starred } = req.query;
    const scope = whereScope(req, "c");
    const where = [scope.where];
    const params = [...scope.params];

    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      where.push(
        "(c.account_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.industry LIKE ? OR c.street LIKE ? OR c.city LIKE ? OR c.state LIKE ?)"
      );
      params.push(like, like, like, like, like, like, like);
    }
    const rel = clean(account_relationship, 80);
    if (rel) {
      where.push("c.account_relationship = ?");
      params.push(rel);
    }
    const cityV = clean(city, 120);
    if (cityV) {
      where.push("c.city = ?");
      params.push(cityV);
    }
    const stateV = clean(state, 120);
    if (stateV) {
      where.push("c.state = ?");
      params.push(stateV);
    }
    const ind = clean(industry, 120);
    if (ind) {
      where.push("c.industry = ?");
      params.push(ind);
    }
    if (assigned_to === "__none__") where.push("c.assigned_to IS NULL");
    else if (assigned_to && Number.isInteger(Number(assigned_to))) {
      where.push("c.assigned_to = ?");
      params.push(Number(assigned_to));
    }
    if (String(starred || "") === "1") where.push("c.is_starred = 1");

    const [rows] = await pool.execute(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM contacts ct WHERE ct.company_name = c.account_name AND (? IS NULL OR ct.tenant_id = ?)) AS contacts_count
       FROM companies c
       WHERE ${where.join(" AND ")}
       ORDER BY c.updated_at DESC, c.id DESC`,
      [req.user?.tenantId || null, req.user?.tenantId || null, ...params]
    );

    let relationshipBreakdown = null;
    if (String(include_breakdown || "") === "1") {
      const [br] = await pool.execute(
        `SELECT COALESCE(NULLIF(TRIM(c.account_relationship),''),'Other') AS bucket, COUNT(*) AS count
         FROM companies c
         WHERE ${where.join(" AND ")}
         GROUP BY COALESCE(NULLIF(TRIM(c.account_relationship),''),'Other')
         ORDER BY count DESC, bucket ASC`,
        params
      );
      relationshipBreakdown = br.map((r) => ({ key: String(r.bucket || "Other"), count: Number(r.count) || 0 }));
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
    const cscope = whereScope(req, "c");
    const [[company]] = await pool.execute(
      `SELECT c.account_name FROM companies c WHERE c.id = ? AND ${cscope.where} LIMIT 1`,
      [id, ...cscope.params]
    );
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    const lscope = leadListScope(req, "l");
    const [rows] = await pool.execute(
      `SELECT l.* FROM leads l
       WHERE ${lscope.where} AND l.company_name = ?
       ORDER BY l.updated_at DESC, l.id DESC`,
      [...lscope.params, company.account_name]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET /api/companies/:id/leads", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/contacts", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });
    const cscope = whereScope(req, "c");
    const [[company]] = await pool.execute(
      `SELECT c.account_name FROM companies c WHERE c.id = ? AND ${cscope.where} LIMIT 1`,
      [id, ...cscope.params]
    );
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    const own = !canSeeAllTeamRecords(req);
    const vis = own ? " AND (ct.created_by = ? OR ct.assigned_to = ?)" : "";
    const params = own
      ? [req.user.tenantId, id, company.account_name, req.user.id, req.user.id]
      : [req.user.tenantId, id, company.account_name];
    const [rows] = await pool.execute(
      `SELECT ct.* FROM contacts ct
       WHERE ct.tenant_id = ?${vis}
         AND (ct.company_id = ? OR ct.company_name = ?)
       ORDER BY ct.updated_at DESC, ct.id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET /api/companies/:id/contacts", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });
    const scope = whereScope(req, "c");
    const [[row]] = await pool.execute(
      `SELECT c.* FROM companies c WHERE c.id = ? AND ${scope.where} LIMIT 1`,
      [id, ...scope.params]
    );
    if (!row) return res.status(404).json({ success: false, message: "Company not found" });

    const [contacts] = await pool.execute(
      `SELECT id, company_name, contact_name, designation, account_relationship, department, email, phone
       FROM contacts
       WHERE company_name = ? ${req.user?.tenantId ? "AND tenant_id = ?" : ""}
       ORDER BY updated_at DESC`,
      req.user?.tenantId ? [row.account_name, req.user.tenantId] : [row.account_name]
    );
    res.json({ success: true, data: { ...row, contacts } });
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

    const [r] = await pool.execute(
      `INSERT INTO companies
       (tenant_id, account_name, account_relationship, phone, email, industry, street, city, state, country, postal_code, website, notes, assigned_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.tenantId || null,
        accountName,
        rel,
        clean(req.body?.phone, 30),
        clean(req.body?.email, 180),
        clean(req.body?.industry, 120),
        clean(req.body?.street, 255),
        clean(req.body?.city, 120),
        clean(req.body?.state, 120),
        clean(req.body?.country, 120),
        clean(req.body?.postal_code, 20),
        clean(req.body?.website, 255),
        clean(req.body?.notes, 4000),
        assignedTo,
        req.user.id,
      ]
    );
    const [[row]] = await pool.execute("SELECT * FROM companies WHERE id = ? LIMIT 1", [r.insertId]);
    await syncCompanyPrimaryContact({ tenantId: req.user?.tenantId || null, userId: req.user.id, company: row });
    emitContactsChanged({ reason: "companies:create", id: r.insertId, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "create", tenantId: req.user?.tenantId || null });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/companies", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });
    const scope = whereScope(req, "c");
    const [[existing]] = await pool.execute(
      `SELECT c.* FROM companies c WHERE c.id = ? AND ${scope.where} LIMIT 1`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Company not found" });

    const rel =
      req.body?.account_relationship != null
        ? clean(req.body?.account_relationship, 80)
        : existing.account_relationship;
    if (rel && !REL_TYPES.has(rel)) return res.status(400).json({ success: false, message: "Invalid account_relationship" });

    const nextName = req.body?.account_name != null ? clean(req.body?.account_name, 180) : existing.account_name;
    if (!nextName) return res.status(400).json({ success: false, message: "account_name cannot be empty" });

    await pool.execute(
      `UPDATE companies
       SET account_name = ?, account_relationship = ?, phone = ?, email = ?, industry = ?, street = ?, city = ?,
           state = ?, country = ?, postal_code = ?, website = ?, notes = ?, assigned_to = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        nextName,
        rel || "Other",
        req.body?.phone !== undefined ? clean(req.body?.phone, 30) : existing.phone,
        req.body?.email !== undefined ? clean(req.body?.email, 180) : existing.email,
        req.body?.industry !== undefined ? clean(req.body?.industry, 120) : existing.industry,
        req.body?.street !== undefined ? clean(req.body?.street, 255) : existing.street,
        req.body?.city !== undefined ? clean(req.body?.city, 120) : existing.city,
        req.body?.state !== undefined ? clean(req.body?.state, 120) : existing.state,
        req.body?.country !== undefined ? clean(req.body?.country, 120) : existing.country,
        req.body?.postal_code !== undefined ? clean(req.body?.postal_code, 20) : existing.postal_code,
        req.body?.website !== undefined ? clean(req.body?.website, 255) : existing.website,
        req.body?.notes !== undefined ? clean(req.body?.notes, 4000) : existing.notes,
        req.body?.assigned_to !== undefined ? Number(req.body?.assigned_to) || null : existing.assigned_to,
        id,
      ]
    );

    if (existing.account_name !== nextName) {
      await pool.execute(
        `UPDATE contacts SET company_name = ? WHERE company_name = ? ${req.user?.tenantId ? "AND tenant_id = ?" : ""}`,
        req.user?.tenantId ? [nextName, existing.account_name, req.user.tenantId] : [nextName, existing.account_name]
      );
    }

    const [[row]] = await pool.execute("SELECT * FROM companies WHERE id = ? LIMIT 1", [id]);
    await syncCompanyPrimaryContact({ tenantId: req.user?.tenantId || null, userId: req.user.id, company: row });
    emitContactsChanged({ reason: "companies:update", id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "update", tenantId: req.user?.tenantId || null });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PUT /api/companies/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid company id" });
    const scope = whereScope(req, "c");
    const [r] = await pool.execute(
      `UPDATE companies c
       SET c.is_deleted = 1, c.deleted_at = NOW(), c.updated_at = NOW()
       WHERE c.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Company not found" });
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
    const scope = whereScope(req, "c");
    const starred = req.body?.starred ? 1 : 0;
    const [r] = await pool.execute(
      `UPDATE companies c SET c.is_starred = ?, c.updated_at = NOW() WHERE c.id = ? AND ${scope.where}`,
      [starred, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Company not found" });
    emitContactsChanged({ reason: "companies:star", id, tenantId: req.user?.tenantId || null });
    emitAdminChanged({ scope: "companies", action: "star", tenantId: req.user?.tenantId || null });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/companies/:id/star", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/merge", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const keepId = Number(req.body?.keep_id);
    const mergeId = Number(req.body?.merge_id);
    if (!keepId || !mergeId || keepId === mergeId) {
      return res.status(400).json({ success: false, message: "Valid keep_id and merge_id are required" });
    }

    const scope = whereScope(req, "c");
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT c.* FROM companies c WHERE c.id IN (?, ?) AND ${scope.where} FOR UPDATE`,
      [keepId, mergeId, ...scope.params]
    );
    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "One or both companies not found" });
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

    await conn.execute(
      `UPDATE companies
       SET account_name = ?, account_relationship = ?, phone = ?, email = ?, industry = ?, street = ?, city = ?,
           state = ?, country = ?, postal_code = ?, website = ?, notes = ?, assigned_to = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        merged.account_name,
        REL_TYPES.has(merged.account_relationship) ? merged.account_relationship : "Other",
        merged.phone,
        merged.email,
        merged.industry,
        merged.street,
        merged.city,
        merged.state,
        merged.country,
        merged.postal_code,
        merged.website,
        merged.notes,
        merged.assigned_to,
        keepId,
      ]
    );

    await conn.execute(
      "UPDATE contacts SET company_id = ?, company_name = ? WHERE tenant_id = ? AND company_id = ?",
      [keepId, merged.account_name, req.user.tenantId, mergeId]
    );
    await conn.execute(
      "UPDATE contacts SET company_id = ?, company_name = ? WHERE tenant_id = ? AND company_name = ?",
      [keepId, merged.account_name, req.user.tenantId, merge.account_name]
    );

    await conn.execute(
      `UPDATE companies SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
      [mergeId, req.user.tenantId]
    );
    await conn.commit();

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
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    console.error("POST /api/companies/merge", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
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
            const [byEmail] = await pool.execute(
              "SELECT id FROM companies WHERE tenant_id = ? AND is_deleted = 0 AND email = ? LIMIT 1",
              [req.user.tenantId, payload.email]
            );
            if (byEmail.length) existing = byEmail[0];
          }
          if (!existing) {
            const [byName] = await pool.execute(
              "SELECT id FROM companies WHERE tenant_id = ? AND is_deleted = 0 AND account_name = ? LIMIT 1",
              [req.user.tenantId, accountName]
            );
            if (byName.length) existing = byName[0];
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

          if (existing) {
            await pool.execute(
              `UPDATE companies
               SET account_name = ?, account_relationship = ?, phone = ?, email = ?, industry = ?, street = ?,
                   city = ?, state = ?, country = ?, postal_code = ?, website = ?, notes = ?, updated_at = NOW()
               WHERE id = ? AND tenant_id = ? AND is_deleted = 0`,
              [
                accountName,
                rel,
                payload.phone,
                payload.email,
                payload.industry,
                payload.street,
                payload.city,
                payload.state,
                payload.country,
                payload.postal_code,
                payload.website,
                payload.notes,
                existing.id,
                req.user.tenantId,
              ]
            );
            summary.updated += 1;
            const [[row]] = await pool.execute(
              "SELECT * FROM companies WHERE id = ? AND tenant_id = ? AND is_deleted = 0 LIMIT 1",
              [existing.id, req.user.tenantId]
            );
            await syncCompanyPrimaryContact({ tenantId: req.user.tenantId, userId: req.user.id, company: row });
          } else {
            const [created] = await pool.execute(
              `INSERT INTO companies
                (tenant_id, account_name, account_relationship, phone, email, industry, street, city, state, country,
                 postal_code, website, notes, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                req.user.tenantId,
                accountName,
                rel,
                payload.phone,
                payload.email,
                payload.industry,
                payload.street,
                payload.city,
                payload.state,
                payload.country,
                payload.postal_code,
                payload.website,
                payload.notes,
                req.user.id,
              ]
            );
            summary.created += 1;
            const [[row]] = await pool.execute(
              "SELECT * FROM companies WHERE id = ? AND tenant_id = ? AND is_deleted = 0 LIMIT 1",
              [created.insertId, req.user.tenantId]
            );
            await syncCompanyPrimaryContact({ tenantId: req.user.tenantId, userId: req.user.id, company: row });
          }
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
