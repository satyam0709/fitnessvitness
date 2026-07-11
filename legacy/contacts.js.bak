const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { emitContactsChanged, emitUserEvent, emitAdminChanged } = require("../realtime/meetingsRealtime");

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

function cleanStr(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function validEmail(v) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
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

function contactCanAccessRow(row, req) {
  if (!row || String(row.tenant_id) !== String(req.user.tenantId)) return false;
  if (canSeeAllTeamRecords(req)) return true;
  return row.created_by === req.user.id || row.assigned_to === req.user.id;
}

async function resolveCompanyContext(req, companyIdRaw, companyNameRaw) {
  const companyId = companyIdRaw != null && companyIdRaw !== "" ? Number(companyIdRaw) : null;
  if (companyId && Number.isInteger(companyId) && companyId > 0) {
    const [[co]] = await pool.execute(
      "SELECT id, account_name FROM companies WHERE id = ? AND tenant_id = ? AND is_deleted = 0 LIMIT 1",
      [companyId, req.user.tenantId]
    );
    if (!co) return { error: "Invalid company_id" };
    return { company_id: co.id, company_name: co.account_name };
  }
  const name = cleanStr(companyNameRaw, 180);
  if (!name) return { error: "company_name or company_id is required" };
  return { company_id: null, company_name: name };
}

async function upsertCompanyFromContact(req, payload, existingCompanyId = null) {
  const accountName = cleanStr(payload?.company_name, 180);
  if (!accountName && !existingCompanyId) return { company_id: null, company_name: null };

  let companyId = existingCompanyId ? Number(existingCompanyId) : null;
  let row = null;

  if (companyId) {
    const [[byId]] = await pool.execute(
      "SELECT * FROM companies WHERE id = ? AND tenant_id = ? AND is_deleted = 0 LIMIT 1",
      [companyId, req.user.tenantId]
    );
    row = byId || null;
  } else if (accountName) {
    const [[byName]] = await pool.execute(
      "SELECT * FROM companies WHERE account_name = ? AND tenant_id = ? AND is_deleted = 0 LIMIT 1",
      [accountName, req.user.tenantId]
    );
    row = byName || null;
  }

  const nextName = accountName || row?.account_name || null;
  if (!nextName) return { company_id: null, company_name: null };

  const updateValues = {
    account_name: nextName,
    account_relationship: cleanStr(payload?.account_relationship, 80) || row?.account_relationship || "Customer",
    phone: cleanStr(payload?.phone, 30) || row?.phone || null,
    email: cleanStr(payload?.email, 180) || row?.email || null,
    industry: cleanStr(payload?.department, 120) || row?.industry || null,
    street: cleanStr(payload?.street, 255) || row?.street || null,
    city: cleanStr(payload?.city, 120) || row?.city || null,
    state: cleanStr(payload?.state, 120) || row?.state || null,
    country: cleanStr(payload?.country, 120) || row?.country || null,
    postal_code: cleanStr(payload?.postal_code, 20) || row?.postal_code || null,
    website: cleanStr(payload?.website, 255) || row?.website || null,
    notes: cleanStr(payload?.notes, 4000) || row?.notes || null,
  };

  if (row) {
    await pool.execute(
      `UPDATE companies
       SET account_name = ?, account_relationship = ?, phone = ?, email = ?, industry = ?, street = ?, city = ?,
           state = ?, country = ?, postal_code = ?, website = ?, notes = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND is_deleted = 0`,
      [
        updateValues.account_name,
        updateValues.account_relationship,
        updateValues.phone,
        updateValues.email,
        updateValues.industry,
        updateValues.street,
        updateValues.city,
        updateValues.state,
        updateValues.country,
        updateValues.postal_code,
        updateValues.website,
        updateValues.notes,
        row.id,
        req.user.tenantId,
      ]
    );
    companyId = row.id;
  } else {
    const [inserted] = await pool.execute(
      `INSERT INTO companies
       (tenant_id, account_name, account_relationship, phone, email, industry, street, city, state, country,
        postal_code, website, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.tenantId,
        updateValues.account_name,
        updateValues.account_relationship,
        updateValues.phone,
        updateValues.email,
        updateValues.industry,
        updateValues.street,
        updateValues.city,
        updateValues.state,
        updateValues.country,
        updateValues.postal_code,
        updateValues.website,
        updateValues.notes,
        req.user.id,
      ]
    );
    companyId = inserted.insertId;
  }

  emitContactsChanged({
    reason: "companies:upsert_from_contact",
    id: companyId,
    tenantId: req.user.tenantId,
    userId: req.user.id,
  });
  emitAdminChanged({ scope: "companies", action: "upsert_from_contact", tenantId: req.user.tenantId });

  return { company_id: companyId, company_name: updateValues.account_name };
}

function buildContactImportPayload(r) {
  const companyName = cleanStr(pick(r, ["company_name", "company", "account_name", "organization", "org"]), 180);
  const firstName = cleanStr(pick(r, ["first_name", "firstname", "fname"]), 80);
  const lastName = cleanStr(pick(r, ["last_name", "lastname", "lname"]), 80);
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
  const contactName = cleanStr(
    pick(r, ["contact_name", "name", "full_name", "contact", "person_name"]) || fullNameFromParts,
    150
  );
  const designation = cleanStr(pick(r, ["designation", "title", "job_title"]), 120);
  const relationship = cleanStr(pick(r, ["account_relationship", "relationship"]), 80);
  const department = cleanStr(pick(r, ["department", "dept", "team"]), 120);
  const email = cleanStr(pick(r, ["email", "email_address", "mail"]), 180);
  const phone = cleanStr(pick(r, ["phone", "mobile", "phone_number", "telephone"]), 30);
  const street = cleanStr(pick(r, ["street", "address", "address_line_1"]), 255);
  const city = cleanStr(pick(r, ["city"]), 120);
  const state = cleanStr(pick(r, ["state", "province"]), 120);
  const country = cleanStr(pick(r, ["country"]), 120);
  const postalCode = cleanStr(pick(r, ["postal_code", "pincode", "zip", "zipcode"]), 20);
  const website = cleanStr(pick(r, ["website", "url", "company_website"]), 255);
  const notes = cleanStr(pick(r, ["notes", "note", "comment", "remarks"]), 4000);

  return {
    companyName,
    contactName,
    designation,
    relationship,
    department,
    email,
    phone,
    street,
    city,
    state,
    country,
    postalCode,
    website,
    notes,
  };
}

function baseSelectSql(whereSql, orderSql = "ORDER BY c.updated_at DESC, c.id DESC") {
  return `
    SELECT
      c.*,
      comp.account_name AS company_linked_name,
      comp.account_relationship AS company_account_relationship,
      comp.phone AS company_phone,
      comp.email AS company_email,
      comp.industry AS company_industry,
      comp.street AS company_street,
      comp.city AS company_city,
      comp.state AS company_state,
      comp.country AS company_country,
      comp.postal_code AS company_postal_code,
      comp.website AS company_website,
      comp.notes AS company_notes,
      TRIM(CONCAT(COALESCE(cb.first_name, ''), ' ', COALESCE(cb.last_name, ''))) AS created_by_name,
      cb.email AS created_by_email,
      TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))) AS assigned_to_name,
      au.email AS assigned_to_email
    FROM contacts c
    LEFT JOIN companies comp ON c.company_id = comp.id
    LEFT JOIN users cb ON c.created_by = cb.id
    LEFT JOIN users au ON c.assigned_to = au.id
    ${whereSql}
    ${orderSql}
  `;
}

router.get("/", async (req, res) => {
  try {
    const {
      q,
      company_name,
      designation,
      account_relationship,
      department,
      assigned_to,
      include_breakdown,
    } = req.query;

    const conditions = [];
    const params = [];

    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      conditions.push(`(
        c.contact_name LIKE ? OR
        c.company_name LIKE ? OR
        c.designation LIKE ? OR
        c.department LIKE ? OR
        c.email LIKE ? OR
        c.phone LIKE ?
      )`);
      params.push(like, like, like, like, like, like);
    }

    const company = cleanStr(company_name, 180);
    if (company) {
      conditions.push("c.company_name = ?");
      params.push(company);
    }

    const desig = cleanStr(designation, 120);
    if (desig) {
      conditions.push("c.designation = ?");
      params.push(desig);
    }

    const rel = cleanStr(account_relationship, 80);
    if (rel) {
      conditions.push("c.account_relationship = ?");
      params.push(rel);
    }

    const dept = cleanStr(department, 120);
    if (dept) {
      conditions.push("c.department = ?");
      params.push(dept);
    }

    if (assigned_to === "__none__") {
      conditions.push("c.assigned_to IS NULL");
    } else if (assigned_to && Number.isInteger(Number(assigned_to))) {
      conditions.push("c.assigned_to = ?");
      params.push(Number(assigned_to));
    }

    conditions.push("c.tenant_id = ?");
    params.push(req.user.tenantId);
    if (!canSeeAllTeamRecords(req)) {
      conditions.push("(c.created_by = ? OR c.assigned_to = ?)");
      params.push(req.user.id, req.user.id);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.execute(baseSelectSql(whereSql), params);

    let designationBreakdown = null;
    if (include_breakdown === "1") {
      const [bucketRows] = await pool.execute(
        `
          SELECT
            COALESCE(NULLIF(TRIM(c.designation), ''), 'Other') AS bucket,
            COUNT(*) AS count
          FROM contacts c
          ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(c.designation), ''), 'Other')
          ORDER BY count DESC, bucket ASC
        `,
        params
      );
      designationBreakdown = bucketRows.map((r) => ({
        key: String(r.bucket || "Other"),
        count: Number(r.count) || 0,
      }));
    }

    res.json({
      success: true,
      total: rows.length,
      data: rows,
      designationBreakdown,
    });
  } catch (err) {
    console.error("GET /api/contacts", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const contactId = Number(req.params.id);
    if (!contactId) {
      return res.status(400).json({ success: false, message: "Invalid contact id" });
    }

    const [rows] = await pool.execute(baseSelectSql("WHERE c.id = ? AND c.tenant_id = ?"), [
      contactId,
      req.user.tenantId,
    ]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }

    const row = rows[0];
    if (!contactCanAccessRow(row, req)) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("GET /api/contacts/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    let resolved = await resolveCompanyContext(req, b.company_id, b.company_name);
    if (resolved.error) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    const upserted = await upsertCompanyFromContact(
      req,
      { ...b, company_name: resolved.company_name },
      resolved.company_id || null
    );
    if (upserted.company_id) resolved = upserted;
    const { company_id: resolvedCompanyId, company_name: companyName } = resolved;
    const contactName = cleanStr(b.contact_name, 150);
    const email = cleanStr(b.email, 180);
    const phone = cleanStr(b.phone, 30);

    if (!contactName) {
      return res.status(400).json({ success: false, message: "contact_name is required" });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }

    const assignedTo =
      b.assigned_to !== undefined && b.assigned_to !== null && b.assigned_to !== ""
        ? Number(b.assigned_to) || null
        : null;

    const [result] = await pool.execute(
      `
        INSERT INTO contacts (
          tenant_id, company_id, company_name, contact_name, designation, account_relationship, department,
          email, phone, street, city, state, country, postal_code,
          website, notes, assigned_to, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.tenantId,
        resolvedCompanyId,
        companyName,
        contactName,
        cleanStr(b.designation, 120),
        cleanStr(b.account_relationship, 80),
        cleanStr(b.department, 120),
        email,
        phone,
        cleanStr(b.street, 255),
        cleanStr(b.city, 120),
        cleanStr(b.state, 120),
        cleanStr(b.country, 120),
        cleanStr(b.postal_code, 20),
        cleanStr(b.website, 255),
        cleanStr(b.notes, 4000),
        assignedTo,
        req.user.id,
      ]
    );

    const [createdRows] = await pool.execute(baseSelectSql("WHERE c.id = ? AND c.tenant_id = ?"), [
      result.insertId,
      req.user.tenantId,
    ]);
    emitContactsChanged({ reason: "create", id: result.insertId, userId: req.user.id });
    res.status(201).json({ success: true, data: createdRows[0] });
  } catch (err) {
    console.error("POST /api/contacts", err);
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

    await conn.beginTransaction();
    const [rows] = await conn.execute(
      "SELECT * FROM contacts WHERE id IN (?, ?) AND tenant_id = ? FOR UPDATE",
      [keepId, mergeId, req.user.tenantId]
    );
    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "One or both contacts not found" });
    }

    if (!contactCanAccessRow(keep, req) || !contactCanAccessRow(merge, req)) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: "Not allowed to merge these contacts" });
    }

    const merged = {
      company_name: keep.company_name || merge.company_name || null,
      contact_name: keep.contact_name || merge.contact_name || null,
      designation: keep.designation || merge.designation || null,
      account_relationship: keep.account_relationship || merge.account_relationship || null,
      department: keep.department || merge.department || null,
      email: keep.email || merge.email || null,
      phone: keep.phone || merge.phone || null,
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
      `
        UPDATE contacts SET
          company_name = ?,
          contact_name = ?,
          designation = ?,
          account_relationship = ?,
          department = ?,
          email = ?,
          phone = ?,
          street = ?,
          city = ?,
          state = ?,
          country = ?,
          postal_code = ?,
          website = ?,
          notes = ?,
          assigned_to = ?,
          updated_at = NOW()
        WHERE id = ?
      `,
      [
        merged.company_name,
        merged.contact_name,
        merged.designation,
        merged.account_relationship,
        merged.department,
        merged.email,
        merged.phone,
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

    await conn.execute("DELETE FROM contacts WHERE id = ?", [mergeId]);
    await conn.commit();
    emitContactsChanged({ reason: "merge", keep_id: keepId, merge_id: mergeId, userId: req.user.id });
    res.json({ success: true, message: "Contacts merged successfully", keep_id: keepId, merge_id: mergeId });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("POST /api/contacts/merge", err);
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
    const jobId = cleanStr(req.body?.job_id, 120) || `contacts-import-${Date.now()}`;
    const progressEvery = rows.length > 2000 ? 250 : rows.length > 500 ? 100 : 25;
    const pushProgress = (status = "running") => {
      emitUserEvent(req.user.id, "contacts:import:progress", {
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
          const r = rows[i];
          const rowNum = i + 2;
          const {
            companyName,
            contactName,
            designation,
            relationship,
            department,
            email,
            phone,
            street,
            city,
            state,
            country,
            postalCode,
            website,
            notes,
          } = buildContactImportPayload(r);

          if (!contactName) {
            summary.skipped += 1;
            if (summary.errors.length < maxErrors) summary.errors.push(`Row ${rowNum}: contact_name is required`);
            summary.processed += 1;
            if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
            continue;
          }
          if (!validEmail(email)) {
            summary.skipped += 1;
            if (summary.errors.length < maxErrors) summary.errors.push(`Row ${rowNum}: invalid email`);
            summary.processed += 1;
            if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
            continue;
          }

          let existing = null;
          if (email) {
            const [byEmail] = await pool.execute(
              "SELECT id FROM contacts WHERE tenant_id = ? AND email = ? LIMIT 1",
              [req.user.tenantId, email]
            );
            if (byEmail.length) existing = byEmail[0];
          }
          if (!existing && phone) {
            const [byPhone] = await pool.execute(
              "SELECT id FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1",
              [req.user.tenantId, phone]
            );
            if (byPhone.length) existing = byPhone[0];
          }
          if (!existing) {
            const companyForMatch = companyName || "Individual";
            const [byNameCompany] = await pool.execute(
              "SELECT id FROM contacts WHERE tenant_id = ? AND contact_name = ? AND company_name = ? LIMIT 1",
              [req.user.tenantId, contactName, companyForMatch]
            );
            if (byNameCompany.length) existing = byNameCompany[0];
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

          const normalizedCompany = companyName || "Individual";
          let resolvedCompanyId = null;
          if (companyName) {
            const upsertedCompany = await upsertCompanyFromContact(
              req,
              {
                company_name: companyName,
                account_relationship: relationship,
                phone,
                email,
                department,
                street,
                city,
                state,
                country,
                postal_code: postalCode,
                website,
                notes,
              },
              null
            );
            resolvedCompanyId = upsertedCompany.company_id || null;
          }
          if (existing) {
            await pool.execute(
              `
                UPDATE contacts SET
                  company_name = ?, contact_name = ?, designation = ?, account_relationship = ?,
                  department = ?, email = ?, phone = ?, street = ?, city = ?, state = ?,
                  country = ?, postal_code = ?, website = ?, notes = ?, company_id = COALESCE(?, company_id), updated_at = NOW()
                WHERE id = ? AND tenant_id = ?
              `,
              [
                normalizedCompany,
                contactName,
                designation,
                relationship,
                department,
                email,
                phone,
                street,
                city,
                state,
                country,
                postalCode,
                website,
                notes,
                resolvedCompanyId,
                existing.id,
                req.user.tenantId,
              ]
            );
            summary.updated += 1;
          } else {
            await pool.execute(
              `
                INSERT INTO contacts (
                  tenant_id, company_name, contact_name, designation, account_relationship, department,
                  email, phone, street, city, state, country, postal_code, website, notes, company_id, created_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                req.user.tenantId,
                normalizedCompany,
                contactName,
                designation,
                relationship,
                department,
                email,
                phone,
                street,
                city,
                state,
                country,
                postalCode,
                website,
                notes,
                resolvedCompanyId,
                req.user.id,
              ]
            );
            summary.created += 1;
          }
          summary.processed += 1;
          if (summary.processed % progressEvery === 0 || summary.processed === summary.total) pushProgress("running");
        }

        pushProgress("completed");
        emitContactsChanged({
          reason: "import_completed",
          jobId,
          mode,
          total: summary.total,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          userId: req.user.id,
        });
      } catch (jobErr) {
        console.error("contacts import job error", jobErr);
        emitUserEvent(req.user.id, "contacts:import:progress", {
          jobId,
          status: "failed",
          mode,
          error: jobErr.message,
          summary,
        });
      }
    })();
  } catch (err) {
    console.error("POST /api/contacts/import", err);
    emitUserEvent(req.user.id, "contacts:import:progress", {
      jobId: cleanStr(req.body?.job_id, 120) || null,
      status: "failed",
      mode: String(req.body?.mode || "create_only").trim(),
      error: err.message,
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const contactId = Number(req.params.id);
    if (!contactId) {
      return res.status(400).json({ success: false, message: "Invalid contact id" });
    }

    const [[existing]] = await pool.execute(
      "SELECT * FROM contacts WHERE id = ? AND tenant_id = ? LIMIT 1",
      [contactId, req.user.tenantId]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }
    if (!contactCanAccessRow(existing, req)) {
      return res.status(403).json({ success: false, message: "Not allowed to update this contact" });
    }

    const b = req.body || {};
    let nextCompanyId = existing.company_id;
    let nextCompanyName = existing.company_name;
    if (b.company_id !== undefined || b.company_name !== undefined) {
      const resolved = await resolveCompanyContext(req, b.company_id, b.company_name);
      if (resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      let finalResolved = resolved;
      if (!resolved.company_id && resolved.company_name) {
        finalResolved = await upsertCompanyFromContact(req, { ...b, company_name: resolved.company_name }, existing.company_id);
      } else if (resolved.company_id) {
        const refreshed = await upsertCompanyFromContact(req, { ...b, company_name: resolved.company_name }, resolved.company_id);
        if (refreshed.company_id) finalResolved = refreshed;
      }
      nextCompanyId = finalResolved.company_id;
      nextCompanyName = finalResolved.company_name;
    } else if (
      existing.company_id &&
      [
        "account_relationship",
        "phone",
        "email",
        "department",
        "street",
        "city",
        "state",
        "country",
        "postal_code",
        "website",
        "notes",
      ].some((k) => b[k] !== undefined)
    ) {
      const synced = await upsertCompanyFromContact(
        req,
        { ...b, company_name: existing.company_name },
        existing.company_id
      );
      if (synced.company_id) {
        nextCompanyId = synced.company_id;
        nextCompanyName = synced.company_name;
      }
    }
    const companyName = b.company_name !== undefined || b.company_id !== undefined ? nextCompanyName : null;
    const contactName = b.contact_name !== undefined ? cleanStr(b.contact_name, 150) : null;
    const email = b.email !== undefined ? cleanStr(b.email, 180) : null;

    if ((b.company_name !== undefined || b.company_id !== undefined) && !companyName) {
      return res.status(400).json({ success: false, message: "company_name cannot be empty" });
    }
    if (b.contact_name !== undefined && !contactName) {
      return res.status(400).json({ success: false, message: "contact_name cannot be empty" });
    }
    if (b.email !== undefined && !validEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }

    await pool.execute(
      `
        UPDATE contacts SET
          company_id = ?,
          company_name = COALESCE(?, company_name),
          contact_name = COALESCE(?, contact_name),
          designation = COALESCE(?, designation),
          account_relationship = COALESCE(?, account_relationship),
          department = COALESCE(?, department),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          street = COALESCE(?, street),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          country = COALESCE(?, country),
          postal_code = COALESCE(?, postal_code),
          website = COALESCE(?, website),
          notes = COALESCE(?, notes),
          assigned_to = ?,
          updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [
        nextCompanyId,
        companyName,
        contactName,
        b.designation !== undefined ? cleanStr(b.designation, 120) : null,
        b.account_relationship !== undefined ? cleanStr(b.account_relationship, 80) : null,
        b.department !== undefined ? cleanStr(b.department, 120) : null,
        email,
        b.phone !== undefined ? cleanStr(b.phone, 30) : null,
        b.street !== undefined ? cleanStr(b.street, 255) : null,
        b.city !== undefined ? cleanStr(b.city, 120) : null,
        b.state !== undefined ? cleanStr(b.state, 120) : null,
        b.country !== undefined ? cleanStr(b.country, 120) : null,
        b.postal_code !== undefined ? cleanStr(b.postal_code, 20) : null,
        b.website !== undefined ? cleanStr(b.website, 255) : null,
        b.notes !== undefined ? cleanStr(b.notes, 4000) : null,
        b.assigned_to !== undefined ? (Number(b.assigned_to) || null) : existing.assigned_to,
        contactId,
        req.user.tenantId,
      ]
    );

    const [updatedRows] = await pool.execute(baseSelectSql("WHERE c.id = ? AND c.tenant_id = ?"), [
      contactId,
      req.user.tenantId,
    ]);
    emitContactsChanged({ reason: "update", id: contactId, userId: req.user.id });
    res.json({ success: true, data: updatedRows[0] });
  } catch (err) {
    console.error("PUT /api/contacts/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const contactId = Number(req.params.id);
    if (!contactId) {
      return res.status(400).json({ success: false, message: "Invalid contact id" });
    }

    const [[existing]] = await pool.execute(
      "SELECT * FROM contacts WHERE id = ? AND tenant_id = ? LIMIT 1",
      [contactId, req.user.tenantId]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }
    if (!contactCanAccessRow(existing, req)) {
      return res.status(403).json({ success: false, message: "Not allowed to delete this contact" });
    }

    await pool.execute("DELETE FROM contacts WHERE id = ? AND tenant_id = ?", [contactId, req.user.tenantId]);
    emitContactsChanged({ reason: "delete", id: contactId, userId: req.user.id });
    res.json({ success: true, message: "Contact deleted" });
  } catch (err) {
    console.error("DELETE /api/contacts/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
