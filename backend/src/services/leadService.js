const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");
const {
  emitAdminChanged,
  emitCalendarChanged,
  emitLeadsChanged,
  emitOpportunitiesChanged,
} = require("../realtime/meetingsRealtime");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const { sendEmailWithRetry } = require("./emailService");
const {
  VALID_LEGACY,
  VALID_V2,
  legacyToV2,
  v2ToLegacy,
  resolveStatusFilter,
  enrichLeadStatus,
} = require("../utils/leadStatusMap");

const TRACKED_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "company_name",
  "phone",
  "email",
  "source",
  "status",
  "label",
  "assigned_to",
  "follow_up_date",
  "followup_at",
  "notes",
  "amount",
  "currency",
  "product_category",
  "team",
  "followup_type",
  "industry",
  "department",
  "address",
];

function tenantId(req) {
  return req.user?.tenantId ?? req.tenantId ?? null;
}

/** Standalone CRM uses null tenant_id on rows; counter table PK cannot be null. */
function counterTenantKey(tid) {
  return tid != null ? Number(tid) : 0;
}

function parseAttachments(row) {
  if (!row || row.attachments_json == null) return [];
  try {
    const v = row.attachments_json;
    if (typeof v === "string") return JSON.parse(v);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function formatRow(row) {
  return enrichLeadStatus({ ...row, attachments: parseAttachments(row) });
}

async function resolveUserId(assignedTo) {
  if (assignedTo == null || assignedTo === "") return null;
  const num = Number(assignedTo);
  if (!isNaN(num) && Number.isInteger(num) && num > 0) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND is_active = 1",
      [num]
    );
    if (rows.length) return rows[0].id;
  }
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE clerk_user_id = ? AND is_active = 1",
    [assignedTo]
  );
  return rows.length ? rows[0].id : null;
}

function normalizePhone(b) {
  const raw = b.phone != null ? String(b.phone).trim() : "";
  const dial = b.phone_dial != null ? String(b.phone_dial).trim() : "";
  if (dial && raw && !raw.startsWith("+")) {
    return `${dial}${raw.replace(/^0+/, "")}`;
  }
  return raw || dial || "";
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

function emitLeadChanges(action) {
  emitAdminChanged({ scope: "stats", reason: "leads", action });
  emitCalendarChanged({ reason: "leads" });
  emitLeadsChanged({ reason: "leads" });
}

async function loadLeadScoped(req, leadId) {
  const [rows] = await pool.execute(
    `SELECT l.*,
            TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
            u.email AS assigned_email
     FROM leads l
     LEFT JOIN users u ON l.assigned_to = u.id
     WHERE l.id = ? AND l.is_deleted = 0 AND l.tenant_id <=> ?`,
    [leadId, tenantId(req)]
  );
  return rows[0] || null;
}

async function nextLeadNumber(conn, tid) {
  const key = counterTenantKey(tid);
  await conn.execute(
    `INSERT INTO tenant_lead_counters (tenant_id, next_lead_number)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [key]
  );
  const [rows] = await conn.execute(
    "SELECT next_lead_number FROM tenant_lead_counters WHERE tenant_id = ? FOR UPDATE",
    [key]
  );
  const num = rows[0]?.next_lead_number || 1;
  await conn.execute(
    "UPDATE tenant_lead_counters SET next_lead_number = ? WHERE tenant_id = ?",
    [num + 1, key]
  );
  return num;
}

async function logFieldChanges(leadId, oldRow, newValues, userId) {
  for (const field of TRACKED_FIELDS) {
    if (!(field in newValues)) continue;
    const oldVal = oldRow[field] != null ? String(oldRow[field]) : null;
    const newVal = newValues[field] != null ? String(newValues[field]) : null;
    if (oldVal === newVal) continue;
    await pool.execute(
      `INSERT INTO lead_change_log (lead_id, field_name, old_value, new_value, user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [leadId, field, oldVal, newVal, userId]
    );
  }
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function buildListConditions(req, query) {
  const {
    status,
    source,
    assigned_to,
    search,
    follow_up_date,
    follow_up_from,
    follow_up_to,
    my,
  } = query;

  const conditions = ["l.is_deleted = 0", "l.tenant_id <=> ?"];
  const params = [tenantId(req)];

  if (!canSeeAllTeamRecords(req) || my === "true") {
    conditions.push("(l.created_by = ? OR l.assigned_to = ?)");
    params.push(req.user.id, req.user.id);
  }

  if (status) {
    const mapped = resolveStatusFilter(status);
    if (mapped) {
      conditions.push("(l.status = ? OR l.status_v2 = ?)");
      params.push(mapped.legacy, mapped.v2);
    }
  }

  if (source) {
    conditions.push("l.source = ?");
    params.push(source);
  }

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
    conditions.push(
      "(l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.company_name LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  if (assigned_to === "me") {
    conditions.push("l.assigned_to = ?");
    params.push(req.user.id);
  } else if (assigned_to) {
    return resolveUserId(assigned_to).then((mapped) => {
      if (mapped) {
        conditions.push("l.assigned_to = ?");
        params.push(mapped);
      }
      return { conditions, params };
    });
  }

  return Promise.resolve({ conditions, params });
}

async function listLeads(req) {
  const { conditions, params } = await buildListConditions(req, req.query);
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
  return { success: true, total: data.length, data };
}

async function getCalendarMarkers(req) {
  const { from, to } = req.query;
  if (!from || !to) {
    const err = new Error("from and to are required (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }

  const conditions = [
    "l.follow_up_date IS NOT NULL",
    "l.follow_up_date >= ?",
    "l.follow_up_date <= ?",
    "l.is_deleted = 0",
    "l.tenant_id <=> ?",
  ];
  const params = [from, to, tenantId(req)];

  if (!canSeeAllTeamRecords(req)) {
    conditions.push("(l.created_by = ? OR l.assigned_to = ?)");
    params.push(req.user.id, req.user.id);
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

  return { success: true, byDate };
}

async function getLeadById(req, leadId) {
  const [rows] = await pool.execute(
    `SELECT
       l.*,
       TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
       u.email AS assigned_email
     FROM leads l
     LEFT JOIN users u ON l.assigned_to = u.id
     WHERE l.id = ? AND l.is_deleted = 0 AND l.tenant_id <=> ?`,
    [leadId, tenantId(req)]
  );

  if (!rows.length) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (!canMutateLead(req, row)) {
    const err = new Error("Not allowed to view this lead");
    err.status = 403;
    throw err;
  }

  const [timelineNotes] = await pool.execute(
    `SELECT n.id, n.content, n.created_by, u.email AS creator_email, n.created_at
     FROM notes n
     LEFT JOIN users u ON n.created_by = u.id
     WHERE n.lead_id = ? ORDER BY n.created_at ASC`,
    [leadId]
  );

  return {
    success: true,
    data: { ...formatRow(row), timeline_notes: timelineNotes },
  };
}

async function getFollowups(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const [rows] = await pool.execute(
    `SELECT f.*, u.email AS creator_email
     FROM lead_followups f
     LEFT JOIN users u ON f.created_by = u.id
     WHERE f.lead_id = ?
     ORDER BY f.created_at DESC`,
    [leadId]
  );
  return { success: true, data: rows };
}

async function createLead(req) {
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : "";
  const phone = normalizePhone(b);

  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }
  if (!phone) {
    const err = new Error("phone is required");
    err.status = 400;
    throw err;
  }

  let status = b.status || "new";
  if (VALID_V2.has(String(status).toLowerCase())) {
    status = v2ToLegacy(status);
  }
  if (!VALID_LEGACY.has(status)) {
    const err = new Error("invalid status");
    err.status = 400;
    throw err;
  }

  const statusV2 = b.status_v2 || legacyToV2(status);
  const assignedUserId = (await resolveUserId(b.assigned_to)) || req.user.id;
  const tid = tenantId(req);

  let attachmentsJson = null;
  if (req.files && req.files.length) {
    attachmentsJson = JSON.stringify(
      req.files.map((f) => `/uploads/leads/${f.filename}`)
    );
  }

  const { first_name, last_name } = splitName(name);
  const conn = await pool.getConnection();
  let insertId;
  try {
    await conn.beginTransaction();
    const leadNumber = await nextLeadNumber(conn, tid);

    const [result] = await conn.execute(
      `INSERT INTO leads
         (tenant_id, name, first_name, last_name, company_name, phone, phone_dial, email, source,
          status, status_v2, label, cancel_reason, address, reference, attachments_json,
          assigned_to, created_by, follow_up_date, followup_at, notes, lead_number,
          amount, currency, product_category, team, last_touched_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        tid,
        name,
        b.first_name || first_name,
        b.last_name || last_name,
        b.company_name || null,
        phone,
        b.phone_dial || null,
        b.email || null,
        b.source || "other",
        status,
        statusV2,
        b.label || null,
        b.cancel_reason || null,
        b.address || null,
        b.reference || null,
        attachmentsJson,
        assignedUserId,
        req.user.id,
        b.follow_up_date || null,
        b.followup_at || null,
        b.notes || b.comment || null,
        leadNumber,
        Number(b.amount) || 0,
        String(b.currency || "INR").toUpperCase(),
        b.product_category || null,
        b.team || null,
        req.user.id,
      ]
    );
    insertId = result.insertId;

    await conn.execute(
      `INSERT INTO lead_change_log (lead_id, field_name, old_value, new_value, user_id)
       VALUES (?, 'status', NULL, ?, ?)`,
      [insertId, status, req.user.id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [created] = await pool.execute(
    `SELECT l.*,
            TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name,
            u.email AS assigned_email
     FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
     WHERE l.id = ? AND l.tenant_id <=> ?`,
    [insertId, tid]
  );

  emitLeadChanges("create");
  return { success: true, data: formatRow(created[0]) };
}

async function updateLead(req, leadId) {
  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed to update this lead");
    err.status = 403;
    throw err;
  }

  const b = req.body || {};
  let status = b.status != null ? b.status : null;
  let statusV2 = b.status_v2 != null ? b.status_v2 : null;

  if (status) {
    if (VALID_V2.has(String(status).toLowerCase())) {
      statusV2 = status;
      status = v2ToLegacy(status);
    }
    if (!VALID_LEGACY.has(status)) {
      const err = new Error("invalid status");
      err.status = 400;
      throw err;
    }
    if (!statusV2) statusV2 = legacyToV2(status);
  }

  const phone =
    b.phone != null || b.phone_dial != null ? normalizePhone(b) : null;

  let assignedUserId = existing.assigned_to;
  if (b.assigned_to !== undefined) {
    assignedUserId = (await resolveUserId(b.assigned_to)) ?? null;
  }

  let attachmentsJson = existing.attachments_json;
  if (req.files && req.files.length) {
    const prev = parseAttachments(existing);
    const added = req.files.map((f) => `/uploads/leads/${f.filename}`);
    attachmentsJson = JSON.stringify([...prev, ...added]);
  }

  const newName =
    b.name != null ? String(b.name).trim() || null : existing.name;
  const nameParts = newName ? splitName(newName) : {};

  const updates = {
    name: newName,
    first_name: b.first_name != null ? b.first_name : nameParts.first_name,
    last_name: b.last_name != null ? b.last_name : nameParts.last_name,
    company_name: b.company_name != null ? b.company_name || null : undefined,
    phone: phone != null ? phone : undefined,
    email: b.email != null ? b.email || null : undefined,
    source: b.source != null ? b.source || null : undefined,
    status: status != null ? status : undefined,
    label: b.label != null ? b.label || null : undefined,
    assigned_to: b.assigned_to !== undefined ? assignedUserId : undefined,
    follow_up_date:
      b.follow_up_date != null ? b.follow_up_date || null : undefined,
    followup_at: b.followup_at != null ? b.followup_at || null : undefined,
    notes:
      b.notes != null || b.comment != null
        ? b.notes || b.comment || null
        : undefined,
    amount: b.amount != null ? Number(b.amount) : undefined,
    currency: b.currency != null ? String(b.currency).toUpperCase() : undefined,
    product_category:
      b.product_category != null ? b.product_category || null : undefined,
    team: b.team != null ? b.team || null : undefined,
    industry: b.industry != null ? b.industry || null : undefined,
    department: b.department != null ? b.department || null : undefined,
    address: b.address != null ? b.address || null : undefined,
  };

  await logFieldChanges(leadId, existing, updates, req.user.id);

  await pool.execute(
    `UPDATE leads SET
       name             = COALESCE(?, name),
       first_name       = COALESCE(?, first_name),
       last_name        = COALESCE(?, last_name),
       company_name     = COALESCE(?, company_name),
       phone            = COALESCE(?, phone),
       phone_dial       = COALESCE(?, phone_dial),
       email            = COALESCE(?, email),
       source           = COALESCE(?, source),
       status           = COALESCE(?, status),
       status_v2        = COALESCE(?, status_v2),
       label            = COALESCE(?, label),
       cancel_reason    = COALESCE(?, cancel_reason),
       address          = COALESCE(?, address),
       reference        = COALESCE(?, reference),
       attachments_json = ?,
       assigned_to      = COALESCE(?, assigned_to),
       follow_up_date   = COALESCE(?, follow_up_date),
       followup_at      = COALESCE(?, followup_at),
       notes            = COALESCE(?, notes),
       amount           = COALESCE(?, amount),
       currency         = COALESCE(?, currency),
       product_category = COALESCE(?, product_category),
       team             = COALESCE(?, team),
       industry         = COALESCE(?, industry),
       department       = COALESCE(?, department),
       last_touched_at  = NOW(),
       updated_by       = ?,
       updated_at       = NOW()
     WHERE id = ?`,
    [
      updates.name,
      updates.first_name,
      updates.last_name,
      updates.company_name,
      updates.phone,
      b.phone_dial != null ? b.phone_dial || null : null,
      updates.email,
      updates.source,
      updates.status,
      statusV2 || (status ? legacyToV2(status) : null),
      updates.label,
      b.cancel_reason != null ? b.cancel_reason || null : null,
      updates.address,
      b.reference != null ? b.reference || null : null,
      attachmentsJson,
      b.assigned_to !== undefined ? assignedUserId : null,
      updates.follow_up_date,
      updates.followup_at,
      updates.notes,
      updates.amount,
      updates.currency,
      updates.product_category,
      updates.team,
      updates.industry,
      updates.department,
      req.user.id,
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

  emitLeadChanges("update");
  return { success: true, data: formatRow(updated[0]) };
}

async function updateLeadStatus(req, leadId, status) {
  if (!VALID_LEGACY.has(status) && !VALID_V2.has(status)) {
    const err = new Error("invalid status");
    err.status = 400;
    throw err;
  }

  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  let legacy = status;
  let v2 = status;
  if (VALID_V2.has(status)) {
    legacy = v2ToLegacy(status);
    v2 = status;
  } else {
    v2 = legacyToV2(status);
  }

  await pool.execute(
    `INSERT INTO lead_change_log (lead_id, field_name, old_value, new_value, user_id)
     VALUES (?, 'status', ?, ?, ?)`,
    [leadId, existing.status, legacy, req.user.id]
  );

  await pool.execute(
    `UPDATE leads SET status = ?, status_v2 = ?, last_touched_at = NOW(), updated_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [legacy, v2, req.user.id, leadId]
  );

  emitLeadChanges("status");
  return { success: true, message: "Status updated" };
}

async function softDeleteLead(req, leadId, uploadsBase) {
  const existing = await loadLeadScoped(req, leadId);
  if (!existing) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, existing)) {
    const err = new Error("Not allowed to delete this lead");
    err.status = 403;
    throw err;
  }

  const paths = parseAttachments(existing);
  for (const rel of paths) {
    if (rel && String(rel).includes("uploads/leads/")) {
      const fp = path.join(uploadsBase, String(rel).replace(/^\//, ""));
      fs.unlink(fp, () => {});
    }
  }

  await pool.execute(
    "UPDATE leads SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ?",
    [leadId]
  );
  emitLeadChanges("delete");
  return { success: true, message: "Lead deleted" };
}

async function addFollowup(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const b = req.body || {};
  const note = String(b.note || b.message || b.comment || "").trim();
  if (!note) {
    const err = new Error("Comment is required");
    err.status = 400;
    throw err;
  }

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
    attachmentsJson = JSON.stringify(
      req.files.map((f) => `/uploads/leads/${f.filename}`)
    );
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

  if (nextDate || nextAtSql) {
    await pool.execute(
      `UPDATE leads SET follow_up_date = COALESCE(?, follow_up_date),
         followup_at = COALESCE(?, followup_at),
         last_touched_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [nextDate, nextAtSql, leadId]
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
      const text = `Hi ${leadName},\n\n${note}\n\nNext follow-up: ${whenText}\n\nBest regards,\nCRM Team`;
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
        meta: { type: "lead_followup", lead_id: leadId, tenant_id: tenantId(req) },
      });
    }
  }

  emitLeadChanges("followup");
  return { success: true, message: "Follow-up saved", mail };
}

function leadTitle(lead) {
  const fn = String(lead.first_name || "").trim();
  const ln = String(lead.last_name || "").trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return String(lead.name || "Lead").trim();
}

async function convertLeadToOpportunity(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }
  if (lead.converted_opportunity_id) {
    const err = new Error("Lead is already converted to an opportunity");
    err.status = 400;
    throw err;
  }

  const b = req.body || {};
  const amount =
    b.amount != null ? Number(b.amount) : Number(lead.amount) || 0;
  const currency = String(b.currency || lead.currency || "INR").toUpperCase();
  const productCategory =
    b.product_category || lead.product_category || null;
  const expectedClose = b.expected_close_date || null;
  const notes = b.notes || lead.notes || lead.comments_history || null;
  const title = leadTitle(lead);
  const followupAt = lead.followup_at || lead.follow_up_date || null;
  const followupType = lead.followup_type || null;
  const tid = tenantId(req);

  const conn = await pool.getConnection();
  let oppId;
  try {
    await conn.beginTransaction();

    const [oppResult] = await conn.execute(
      `INSERT INTO opportunities
         (tenant_id, title, lead_id, contact_id, company_name, amount, currency, stage,
          expected_close_date, owner_user_id, created_by, notes, product_category,
          followup_at, followup_type, lead_source, team, comments_history, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'qualification_done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tid,
        title,
        leadId,
        lead.contact_id || null,
        lead.company_name || null,
        amount,
        currency,
        expectedClose,
        lead.assigned_to || req.user.id,
        req.user.id,
        notes,
        productCategory,
        followupAt,
        followupType,
        lead.source || null,
        lead.team || null,
        lead.comments_history || null,
        lead.phone || null,
      ]
    );
    oppId = oppResult.insertId;

    await conn.execute(
      `INSERT INTO lead_change_log (lead_id, field_name, old_value, new_value, user_id)
       VALUES (?, 'status', ?, 'confirm', ?)`,
      [leadId, lead.status, req.user.id]
    );

    await conn.execute(
      `UPDATE leads SET status = 'confirm', status_v2 = 'converted',
         converted_opportunity_id = ?, amount = ?, currency = ?,
         product_category = COALESCE(?, product_category),
         last_touched_at = NOW(), updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [oppId, amount, currency, productCategory, req.user.id, leadId]
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [oppRows] = await pool.execute(
    "SELECT * FROM opportunities WHERE id = ?",
    [oppId]
  );

  emitLeadChanges("convert");
  emitOpportunitiesChanged({ action: "create", tenantId: tid, leadId });

  return {
    success: true,
    opportunity_id: oppId,
    opportunity: oppRows[0] || null,
    message: "Lead converted to opportunity",
  };
}

async function linkLeadToFitnessClient(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const clientId = Number(req.query?.client_id || req.body?.client_id) || null;

  const [[dup]] = await pool.execute(
    "SELECT id FROM customers WHERE lead_id = ? LIMIT 1",
    [leadId]
  );
  if (dup) {
    const err = new Error("This lead is already linked to a customer");
    err.status = 400;
    throw err;
  }

  if (clientId) {
    const [[fc]] = await pool.execute(
      "SELECT id, name, email, phone FROM fitness_clients WHERE id = ? AND tenant_id <=> ? LIMIT 1",
      [clientId, tenantId(req)]
    );
    if (!fc) {
      const err = new Error("Fitness client not found");
      err.status = 404;
      throw err;
    }
    await pool.execute(
      `INSERT INTO customers (tenant_id, name, email, phone, company, city, country, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId(req),
        fc.name || lead.name,
        fc.email || lead.email || null,
        fc.phone || lead.phone || null,
        lead.company_name || null,
        null,
        "India",
        leadId,
      ]
    );
  } else {
    await pool.execute(
      `INSERT INTO customers (tenant_id, name, email, phone, company, city, country, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId(req),
        lead.name,
        lead.email || null,
        lead.phone || null,
        lead.company_name || null,
        null,
        "India",
        leadId,
      ]
    );
  }

  emitLeadChanges("link-client");
  return { success: true, message: "Lead linked to client" };
}

async function duplicateLead(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const tid = tenantId(req);
  const conn = await pool.getConnection();
  let newId;
  try {
    await conn.beginTransaction();
    const leadNumber = await nextLeadNumber(conn, tid);

    const [result] = await conn.execute(
      `INSERT INTO leads
         (tenant_id, name, first_name, last_name, company_name, phone, phone_dial, email, source,
          status, status_v2, label, address, reference, attachments_json, assigned_to, created_by,
          follow_up_date, followup_at, notes, lead_number, amount, currency, product_category, team,
          industry, department, last_touched_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        tid,
        lead.name,
        lead.first_name,
        lead.last_name,
        lead.company_name,
        lead.phone,
        lead.phone_dial,
        lead.email,
        lead.source,
        lead.label,
        lead.address,
        lead.reference,
        lead.attachments_json,
        lead.assigned_to,
        req.user.id,
        lead.follow_up_date,
        lead.followup_at,
        lead.notes ? `Duplicate of #${leadId}: ${lead.notes}` : `Duplicate of lead #${leadId}`,
        leadNumber,
        lead.amount,
        lead.currency,
        lead.product_category,
        lead.team,
        lead.industry,
        lead.department,
        req.user.id,
      ]
    );
    newId = result.insertId;
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [created] = await pool.execute(
    `SELECT l.*,
            TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS assigned_name
     FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
     WHERE l.id = ?`,
    [newId]
  );

  emitLeadChanges("duplicate");
  return { success: true, data: formatRow(created[0]) };
}

async function getChangeLog(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM lead_change_log WHERE lead_id = ?",
    [leadId]
  );

  const [rows] = await pool.execute(
    `SELECT c.*, u.email AS user_email,
            TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS user_name
     FROM lead_change_log c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.lead_id = ?
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [leadId, limit, offset]
  );

  return {
    success: true,
    data: rows,
    pagination: { page, limit, total: Number(total) || 0 },
  };
}

async function getHistory(req, leadId) {
  const lead = await loadLeadScoped(req, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.status = 404;
    throw err;
  }
  if (!canMutateLead(req, lead)) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }

  const tab = String(req.query.tab || "counts").toLowerCase();

  if (tab === "counts") {
    const [[fu]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM lead_followups WHERE lead_id = ?",
      [leadId]
    );
    const [[nt]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM notes WHERE lead_id = ?",
      [leadId]
    );
    const [[cl]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM lead_change_log WHERE lead_id = ?",
      [leadId]
    );
    return {
      success: true,
      data: {
        followups: Number(fu?.cnt) || 0,
        notes: Number(nt?.cnt) || 0,
        change_log: Number(cl?.cnt) || 0,
      },
    };
  }

  if (tab === "followups") {
    const [rows] = await pool.execute(
      `SELECT f.*, u.email AS creator_email
       FROM lead_followups f LEFT JOIN users u ON f.created_by = u.id
       WHERE f.lead_id = ? ORDER BY f.created_at DESC LIMIT 50`,
      [leadId]
    );
    return { success: true, data: rows };
  }

  if (tab === "notes") {
    const [rows] = await pool.execute(
      `SELECT n.*, u.email AS creator_email
       FROM notes n LEFT JOIN users u ON n.created_by = u.id
       WHERE n.lead_id = ? ORDER BY n.created_at DESC LIMIT 50`,
      [leadId]
    );
    return { success: true, data: rows };
  }

  if (tab === "change_log") {
    const [rows] = await pool.execute(
      `SELECT c.*, u.email AS user_email
       FROM lead_change_log c LEFT JOIN users u ON c.user_id = u.id
       WHERE c.lead_id = ? ORDER BY c.created_at DESC LIMIT 50`,
      [leadId]
    );
    return { success: true, data: rows };
  }

  const err = new Error("Invalid tab");
  err.status = 400;
  throw err;
}

module.exports = {
  canMutateLead,
  listLeads,
  getCalendarMarkers,
  getLeadById,
  getFollowups,
  createLead,
  updateLead,
  updateLeadStatus,
  softDeleteLead,
  addFollowup,
  convertLeadToOpportunity,
  linkLeadToFitnessClient,
  duplicateLead,
  getChangeLog,
  getHistory,
};
