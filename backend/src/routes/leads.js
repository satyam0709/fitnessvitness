const express = require("express");
const path    = require("path");
const fs      = require("fs");
const multer  = require("multer");
const { verifyToken } = require("../middleware/verifyToken");
const { pool }        = require("../config/database");
const { emitAdminChanged, emitCalendarChanged, emitLeadsChanged } = require("../realtime/meetingsRealtime");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { sendEmailWithRetry } = require("../services/emailService");

const router = express.Router();
router.use(verifyToken);

function addCondition(conditions, params, tableAlias = "l") {
  conditions.push(`${tableAlias}.is_deleted = 0`);
}

// ── upload dir ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, "..", "..", "uploads", "leads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
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

// ── helpers ────────────────────────────────────────────────────────────────
async function resolveUserId(assignedTo) {
  if (assignedTo == null || assignedTo === "") return null;
  const num = Number(assignedTo);
  if (!isNaN(num) && Number.isInteger(num) && num > 0) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND is_active = 1", [num]
    );
    if (rows.length) return rows[0].id;
  }
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE clerk_user_id = ? AND is_active = 1", [assignedTo]
  );
  return rows.length ? rows[0].id : null;
}

function parseAttachments(row) {
  if (!row || row.attachments_json == null) return [];
  try {
    const v = row.attachments_json;
    if (typeof v === "string") return JSON.parse(v);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function normalizePhone(b) {
  const raw  = b.phone      != null ? String(b.phone).trim()      : "";
  const dial = b.phone_dial != null ? String(b.phone_dial).trim() : "";
  if (dial && raw && !raw.startsWith("+")) {
    return `${dial}${raw.replace(/^0+/, "")}`;
  }
  return raw || dial || "";
}

const VALID_STATUSES = new Set(["new", "processing", "close_by", "confirm", "cancel"]);

function formatRow(row) {
  return { ...row, attachments: parseAttachments(row) };
}

function canMutateLead(req, lead) {
  if (!lead) return false;
  return (
    req.user.role === "admin" ||
    req.user.role === "manager" ||
    req.rbac?.roleSlug === "tenant_admin" ||
    req.rbac?.roleSlug === "manager" ||
    lead.created_by === req.user.id ||
    lead.assigned_to === req.user.id
  );
}

// ── GET /api/leads/calendar-markers (before /:id) ─────────────────────────
/** Count leads per follow_up_date day in range (for calendar dots). */
router.get("/calendar-markers", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: "from and to are required (YYYY-MM-DD)" });
    }

    const conditions = ["l.follow_up_date IS NOT NULL", "l.follow_up_date >= ?", "l.follow_up_date <= ?"];
    const params     = [from, to];
    addCondition(conditions, params, "l");

    if (!canSeeAllTeamRecords(req)) {
      conditions.unshift("(l.created_by = ? OR l.assigned_to = ?)");
      params.unshift(req.user.id, req.user.id);
    }

    const whereSql = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await pool.execute(
      `SELECT DATE(l.follow_up_date) AS d, COUNT(*) AS cnt
       FROM leads l
       ${whereSql}
       GROUP BY DATE(l.follow_up_date)`,
      params
    );

    function rowToYMD(v) {
      if (v instanceof Date) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, "0");
        const day = String(v.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
      if (v == null) return "";
      const s = String(v);
      return s.length >= 10 ? s.slice(0, 10) : s;
    }

    const byDate = {};
    for (const r of rows) {
      const key = rowToYMD(r.d);
      if (key) byDate[key] = Number(r.cnt) || 0;
    }

    res.json({ success: true, byDate });
  } catch (err) {
    console.error("GET /api/leads/calendar-markers", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/leads ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const {
      status,
      source,
      assigned_to,
      search,
      follow_up_date,
      follow_up_from,
      follow_up_to,
      my,
    } = req.query;
    const conditions = [];
    const params     = [];
    addCondition(conditions, params, "l");

    if (!canSeeAllTeamRecords(req) || my === "true") {
      conditions.push("(l.created_by = ? OR l.assigned_to = ?)");
      params.push(req.user.id, req.user.id);
    }

    if (status) { conditions.push("l.status = ?"); params.push(status); }

    if (source) { conditions.push("l.source = ?"); params.push(source); }

    if (follow_up_date) {
      conditions.push("l.follow_up_date = ?");
      params.push(follow_up_date);
    } else {
      if (follow_up_from) {
        conditions.push("l.follow_up_date >= ?");
        params.push(follow_up_from);
      }
      if (follow_up_to) {
        conditions.push("l.follow_up_date <= ?");
        params.push(follow_up_to);
      }
    }

    if (search) {
      conditions.push("(l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.company_name LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    if (assigned_to === "me") {
      conditions.push("l.assigned_to = ?");
      params.push(req.user.id);
    } else if (assigned_to) {
      const mapped = await resolveUserId(assigned_to);
      if (mapped) { conditions.push("l.assigned_to = ?"); params.push(mapped); }
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.execute(
      `SELECT
         l.*,
         TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
         u.email AS assigned_email,
         TRIM(CONCAT(COALESCE(cb.first_name,''), ' ', COALESCE(cb.last_name,''))) AS created_by_name
       FROM leads l
       LEFT JOIN users u  ON l.assigned_to = u.id
       LEFT JOIN users cb ON l.created_by  = cb.id
       ${whereSql}
       ORDER BY l.created_at DESC`,
      params
    );

    const data = rows.map(formatRow);
    res.json({ success: true, total: data.length, data });
  } catch (err) {
    console.error("GET /api/leads", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/leads/:id/followups (before /:id) ───────────────────────────────
router.get("/:id/followups", async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

    const [leadRows] = await pool.execute(
      "SELECT * FROM leads WHERE id = ? AND is_deleted = 0 AND tenant_id = ?",
      [leadId, req.user.tenantId]
    );
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!canMutateLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const [rows] = await pool.execute(
      `SELECT f.*, u.email AS creator_email
       FROM lead_followups f
       LEFT JOIN users u ON f.created_by = u.id
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC`,
      [leadId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET /api/leads/:id/followups", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/leads/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

    const [rows] = await pool.execute(
      `SELECT
         l.*,
         TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
         u.email AS assigned_email
       FROM leads l
       LEFT JOIN users u ON l.assigned_to = u.id
       WHERE l.id = ? AND l.is_deleted = 0 AND l.tenant_id = ?`,
      [leadId, req.user.tenantId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: "Lead not found" });

    const row = rows[0];
    if (!canMutateLead(req, row)) {
      return res.status(403).json({ success: false, message: "Not allowed to view this lead" });
    }

    const [timelineNotes] = await pool.execute(
      `SELECT n.id, n.content, n.created_by, u.email AS creator_email, n.created_at
       FROM notes n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.lead_id = ? ORDER BY n.created_at ASC`,
      [leadId]
    );

    res.json({
      success: true,
      data: { ...formatRow(row), timeline_notes: timelineNotes },
    });
  } catch (err) {
    console.error("GET /api/leads/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/leads ────────────────────────────────────────────────────────
async function createLeadHandler(req, res) {
  try {
    const b = req.body || {};
    const name  = b.name  != null ? String(b.name).trim()  : "";
    const phone = normalizePhone(b);

    if (!name)  return res.status(400).json({ success: false, message: "name is required" });
    if (!phone) return res.status(400).json({ success: false, message: "phone is required" });

    const status = b.status || "new";
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: "invalid status" });
    }

    const assignedUserId = await resolveUserId(b.assigned_to) || req.user.id;

    let attachmentsJson = null;
    if (req.files && req.files.length) {
      attachmentsJson = JSON.stringify(req.files.map((f) => `/uploads/leads/${f.filename}`));
    }

    const [result] = await pool.execute(
      `INSERT INTO leads
         (tenant_id, name, company_name, phone, phone_dial, email, source, status, label, cancel_reason,
          address, reference, attachments_json, assigned_to, created_by, follow_up_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.tenantId || null,
        name,
        b.company_name  || null,
        phone,
        b.phone_dial    || null,
        b.email         || null,
        b.source        || "other",
        status,
        b.label         || null,
        b.cancel_reason || null,
        b.address       || null,
        b.reference     || null,
        attachmentsJson,
        assignedUserId,
        req.user.id,
        b.follow_up_date || null,
        b.notes || b.comment || null,
      ]
    );

    const [created] = await pool.execute(
      `SELECT l.*,
              TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
              u.email AS assigned_email
       FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
       WHERE l.id = ? AND l.tenant_id = ?`,
      [result.insertId, req.user.tenantId]
    );

    emitAdminChanged({ scope: "stats", reason: "leads", action: "create" });
    emitCalendarChanged({ reason: "leads" });
    emitLeadsChanged({ reason: "leads" });
    res.status(201).json({ success: true, data: formatRow(created[0]) });
  } catch (err) {
    console.error("POST /api/leads", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

router.post(
  "/",
      (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.array("attachments", 5)(req, res, next);
    next();
  },
  validateUploadedMimes,
  createLeadHandler
);

// ── POST /api/leads/:id/convert → customers ─────────────────────────────────
router.post("/:id/convert", async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

    const [[lead]] = await pool.execute(
      "SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND is_deleted = 0",
      [leadId, req.user.tenantId]
    );
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (!canMutateLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const [[dup]] = await pool.execute(
      "SELECT id FROM customers WHERE lead_id = ? LIMIT 1",
      [leadId]
    );
    if (dup) {
      return res.status(400).json({ success: false, message: "This lead is already converted to a customer" });
    }

    await pool.execute(
      `INSERT INTO customers (tenant_id, name, email, phone, company, city, country, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.tenantId,
        lead.name,
        lead.email || null,
        lead.phone || null,
        lead.company_name || null,
        null,
        "India",
        leadId,
      ]
    );

    await pool.execute(
      "UPDATE leads SET status = 'confirm', updated_at = NOW() WHERE id = ?",
      [leadId]
    );

    emitAdminChanged({ scope: "stats", reason: "leads", action: "convert" });
    emitCalendarChanged({ reason: "leads" });
    emitLeadsChanged({ reason: "leads" });
    res.json({ success: true, message: "Lead converted to customer" });
  } catch (err) {
    console.error("POST /api/leads/:id/convert", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/leads/:id/followup ────────────────────────────────────────────
router.post(
  "/:id/followup",
    (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.array("attachments", 5)(req, res, next);
    next();
  },
  validateUploadedMimes,
  async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

      const [leadRows] = await pool.execute(
        "SELECT * FROM leads WHERE id = ? AND is_deleted = 0 AND tenant_id = ?",
        [leadId, req.user.tenantId]
      );
      const lead = leadRows[0];
      if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
      if (!canMutateLead(req, lead)) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      const b = req.body || {};
      const note = String(b.note || b.message || b.comment || "").trim();
      if (!note) return res.status(400).json({ success: false, message: "Comment is required" });

      const nextAtRaw = b.next_follow_up_at || b.next_follow_up_date || null;
      let nextDate = null;
      let nextAtSql = null;
      if (nextAtRaw) {
        const d = new Date(nextAtRaw);
        if (!Number.isNaN(d.getTime())) {
          nextDate = d.toISOString().slice(0, 10);
          nextAtSql = d.toISOString().slice(0, 19).replace("T", " ");
        }
      }

      let attachmentsJson = null;
      if (req.files && req.files.length) {
        attachmentsJson = JSON.stringify(req.files.map((f) => `/uploads/leads/${f.filename}`));
      }

      try {
        await pool.execute(
          `INSERT INTO lead_followups (lead_id, note, next_follow_up_date, next_follow_up_at, attachments_json, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [leadId, note, nextDate, nextAtSql, attachmentsJson, req.user.id]
        );
      } catch (e) {
        if (e.code === "ER_BAD_FIELD_ERROR") {
          await pool.execute(
            `INSERT INTO lead_followups (lead_id, note, next_follow_up_date, created_by)
             VALUES (?, ?, ?, ?)`,
            [leadId, note, nextDate, req.user.id]
          );
        } else {
          throw e;
        }
      }

      if (nextDate) {
        await pool.execute(
          "UPDATE leads SET follow_up_date = ?, updated_at = NOW() WHERE id = ?",
          [nextDate, leadId]
        );
      }

      const shouldSendEmail = b.send_email !== "false" && b.send_email !== false;
      let mail = { ok: false, reason: "disabled" };
      if (shouldSendEmail) {
        if (!lead.email) {
          mail = { ok: false, reason: "missing_lead_email" };
        } else {
          const company = String(lead.company_name || "").trim();
          const leadName = String(lead.name || "").trim() || "there";
          const whenText = nextAtSql
            ? new Date(nextAtSql).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : nextDate || "scheduled soon";
          const subject = company
            ? `Follow-up from ${company}`
            : "CRM follow-up update";
          const text = `Hi ${leadName},

${note}

Next follow-up: ${whenText}

Best regards,
CRM Team`;
          const html = `<p>Hi ${leadName},</p>
<p style="white-space:pre-wrap;">${note.replace(/[<>&]/g, (ch) =>
            ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"
          )}</p>
<p><strong>Next follow-up:</strong> ${whenText}</p>
<p>Best regards,<br/>CRM Team</p>`;
          mail = await sendEmailWithRetry({
            to: lead.email,
            subject,
            text,
            html,
            meta: { type: "lead_followup", lead_id: leadId, tenant_id: req.user.tenantId },
          });
        }
      }

      res.json({
        success: true,
        message: "Follow-up saved",
        mail,
      });
    } catch (err) {
      console.error("POST /api/leads/:id/followup", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PUT /api/leads/:id ─────────────────────────────────────────────────────
router.put(
  "/:id",
      (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.array("attachments", 5)(req, res, next);
    next();
  },
  validateUploadedMimes,
  async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

      const [existingRows] = await pool.execute(
        "SELECT * FROM leads WHERE id = ? AND is_deleted = 0 AND tenant_id = ?",
        [leadId, req.user.tenantId]
      );
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

      if (!canMutateLead(req, existing)) {
        return res.status(403).json({ success: false, message: "Not allowed to update this lead" });
      }

      const b      = req.body || {};
      const status = b.status || null;
      if (status && !VALID_STATUSES.has(status)) {
        return res.status(400).json({ success: false, message: "invalid status" });
      }

      const phone = (b.phone != null || b.phone_dial != null) ? normalizePhone(b) : null;

      let assignedUserId = existing.assigned_to;
      if (b.assigned_to !== undefined) {
        assignedUserId = (await resolveUserId(b.assigned_to)) ?? null;
      }

      let attachmentsJson = existing.attachments_json;
      if (req.files && req.files.length) {
        const prev  = parseAttachments(existing);
        const added = req.files.map((f) => `/uploads/leads/${f.filename}`);
        attachmentsJson = JSON.stringify([...prev, ...added]);
      }

      await pool.execute(
        `UPDATE leads SET
           name             = COALESCE(?, name),
           company_name     = COALESCE(?, company_name),
           phone            = COALESCE(?, phone),
           phone_dial       = COALESCE(?, phone_dial),
           email            = COALESCE(?, email),
           source           = COALESCE(?, source),
           status           = COALESCE(?, status),
           label            = COALESCE(?, label),
           cancel_reason    = COALESCE(?, cancel_reason),
           address          = COALESCE(?, address),
           reference        = COALESCE(?, reference),
           attachments_json = ?,
           assigned_to      = ?,
           follow_up_date   = COALESCE(?, follow_up_date),
           notes            = COALESCE(?, notes),
           updated_at       = NOW()
         WHERE id = ?`,
        [
          b.name         != null ? String(b.name).trim() || null : null,
          b.company_name != null ? b.company_name || null : null,
          phone,
          b.phone_dial   != null ? b.phone_dial || null : null,
          b.email        != null ? b.email       || null : null,
          b.source       != null ? b.source      || null : null,
          status,
          b.label        != null ? b.label        || null : null,
          b.cancel_reason!= null ? b.cancel_reason|| null : null,
          b.address      != null ? b.address      || null : null,
          b.reference    != null ? b.reference    || null : null,
          attachmentsJson,
          assignedUserId,
          b.follow_up_date != null ? b.follow_up_date || null : null,
          (b.notes != null || b.comment != null) ? (b.notes || b.comment || null) : null,
          leadId,
        ]
      );

      const [updated] = await pool.execute(
        `SELECT l.*,
                TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
                u.email AS assigned_email
         FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
         WHERE l.id = ?`,
        [leadId]
      );

      emitAdminChanged({ scope: "stats", reason: "leads", action: "update" });
      emitCalendarChanged({ reason: "leads" });
    emitLeadsChanged({ reason: "leads" });
      res.json({ success: true, data: formatRow(updated[0]) });
    } catch (err) {
      console.error("PUT /api/leads/:id", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PATCH /api/leads/:id/status ────────────────────────────────────────────
router.patch(
  "/:id/status",
      async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    const { status } = req.body || {};
    if (!leadId)                   return res.status(400).json({ success: false, message: "Invalid lead id" });
    if (!VALID_STATUSES.has(status)) return res.status(400).json({ success: false, message: "invalid status" });

    const [existingRows] = await pool.execute(
      "SELECT * FROM leads WHERE id = ? AND is_deleted = 0 AND tenant_id = ?",
      [leadId, req.user.tenantId]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

    if (!canMutateLead(req, existing)) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    await pool.execute(
      "UPDATE leads SET status = ?, updated_at = NOW() WHERE id = ?",
      [status, leadId]
    );

    emitAdminChanged({ scope: "stats", reason: "leads", action: "status" });
    emitCalendarChanged({ reason: "leads" });
    emitLeadsChanged({ reason: "leads" });
    res.json({ success: true, message: "Status updated" });
  } catch (err) {
    console.error("PATCH /api/leads/:id/status", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/leads/:id ──────────────────────────────────────────────────
router.delete(
  "/:id",
      async (req, res) => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: "Invalid lead id" });

    const [existingRows] = await pool.execute(
      "SELECT * FROM leads WHERE id = ? AND is_deleted = 0 AND tenant_id = ?",
      [leadId, req.user.tenantId]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

    if (!canMutateLead(req, existing)) {
      return res.status(403).json({ success: false, message: "Not allowed to delete this lead" });
    }

    // clean up files
    const paths = parseAttachments(existing);
    for (const rel of paths) {
      if (rel && String(rel).includes("uploads/leads/")) {
        const fp = path.join(__dirname, "..", "..", String(rel).replace(/^\//, ""));
        fs.unlink(fp, () => {});
      }
    }

    await pool.execute(
      "UPDATE leads SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ?",
      [leadId]
    );
    emitAdminChanged({ scope: "stats", reason: "leads", action: "delete" });
    emitCalendarChanged({ reason: "leads" });
    emitLeadsChanged({ reason: "leads" });
    res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    console.error("DELETE /api/leads/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;