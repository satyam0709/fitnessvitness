const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { pool } = require("../config/database");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");
const {
  emitAdminChanged,
  emitCalendarChanged,
  emitTicketsChanged,
} = require("../realtime/meetingsRealtime");

const router = express.Router();
router.use(verifyToken);

const VALID_STATUS = new Set(["open", "in_progress", "resolved", "closed", "reopened"]);
const VALID_PRIORITY = new Set(["low", "medium", "high", "urgent"]);

function applyScope(req, alias = "t") {
  const params = [];
  const clauses = [`${alias}.is_deleted = 0`, `${alias}.tenant_id = ?`];
  params.push(req.user.tenantId);
  if (!canSeeAllTeamRecords(req)) {
    clauses.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: clauses.join(" AND "), params };
}

router.get("/", async (req, res) => {
  try {
    const { status, priority, q } = req.query;
    const scope = applyScope(req, "t");
    const where = [scope.where];
    const params = [...scope.params];

    if (status) {
      if (!VALID_STATUS.has(String(status))) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      where.push("t.status = ?");
      params.push(String(status));
    }
    if (priority) {
      if (!VALID_PRIORITY.has(String(priority))) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      where.push("t.priority = ?");
      params.push(String(priority));
    }
    if (q && String(q).trim()) {
      where.push("(t.subject LIKE ? OR t.description LIKE ?)");
      const like = `%${String(q).trim()}%`;
      params.push(like, like);
    }

    const [rows] = await pool.execute(
      `SELECT t.*, u.email AS assigned_email
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${where.join(" AND ")}
       ORDER BY t.created_at DESC`,
      params
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/tickets", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const subject = String(req.body?.subject || "").trim();
    if (!subject) return res.status(400).json({ success: false, message: "subject is required" });
    const status = String(req.body?.status || "open");
    const priority = String(req.body?.priority || "medium");
    if (!VALID_STATUS.has(status)) return res.status(400).json({ success: false, message: "Invalid status" });
    if (!VALID_PRIORITY.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });

    const assignedTo = Number(req.body?.assigned_to) || null;
    const [r] = await pool.execute(
      `INSERT INTO tickets
       (tenant_id, subject, description, priority, status, source, contact_id, lead_id, assigned_to, created_by, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.tenantId || null,
        subject,
        req.body?.description ? String(req.body.description) : null,
        priority,
        status,
        String(req.body?.source || "crm"),
        Number(req.body?.contact_id) || null,
        Number(req.body?.lead_id) || null,
        assignedTo,
        req.user.id,
        req.body?.due_at || null,
      ]
    );
    const [[row]] = await pool.execute("SELECT * FROM tickets WHERE id = ?", [r.insertId]);
    emitAdminChanged({ scope: "tickets", action: "create", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "tickets", tenantId: req.user?.tenantId || null });
    emitTicketsChanged({ action: "create", tenantId: req.user?.tenantId || null, id: r.insertId });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error("POST /api/tickets", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const scope = applyScope(req, "t");
    const [[existing]] = await pool.execute(
      `SELECT t.* FROM tickets t WHERE t.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Ticket not found" });

    const status = req.body?.status != null ? String(req.body.status) : existing.status;
    const priority = req.body?.priority != null ? String(req.body.priority) : existing.priority;
    if (!VALID_STATUS.has(status)) return res.status(400).json({ success: false, message: "Invalid status" });
    if (!VALID_PRIORITY.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });

    const closedAt = status === "resolved" || status === "closed" ? new Date() : null;
    await pool.execute(
      `UPDATE tickets
       SET subject = ?, description = ?, priority = ?, status = ?, source = ?, contact_id = ?, lead_id = ?,
           assigned_to = ?, due_at = ?, closed_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        req.body?.subject != null ? String(req.body.subject).trim() : existing.subject,
        req.body?.description != null ? String(req.body.description || "") : existing.description,
        priority,
        status,
        req.body?.source != null ? String(req.body.source) : existing.source,
        req.body?.contact_id != null ? Number(req.body.contact_id) || null : existing.contact_id,
        req.body?.lead_id != null ? Number(req.body.lead_id) || null : existing.lead_id,
        req.body?.assigned_to != null ? Number(req.body.assigned_to) || null : existing.assigned_to,
        req.body?.due_at != null ? req.body.due_at : existing.due_at,
        closedAt ? closedAt.toISOString().slice(0, 19).replace("T", " ") : existing.closed_at,
        id,
      ]
    );
    const [[row]] = await pool.execute("SELECT * FROM tickets WHERE id = ?", [id]);
    emitAdminChanged({ scope: "tickets", action: "update", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "tickets", tenantId: req.user?.tenantId || null });
    emitTicketsChanged({ action: "update", tenantId: req.user?.tenantId || null, id });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PUT /api/tickets/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!VALID_STATUS.has(status)) return res.status(400).json({ success: false, message: "Invalid status" });
    const scope = applyScope(req, "t");
    const closeExpr = status === "resolved" || status === "closed" ? "NOW()" : "NULL";
    const [r] = await pool.execute(
      `UPDATE tickets t
       SET t.status = ?, t.closed_at = ${closeExpr}, t.updated_at = NOW()
       WHERE t.id = ? AND ${scope.where}`,
      [status, id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Ticket not found" });
    emitAdminChanged({ scope: "tickets", action: "status", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "tickets", tenantId: req.user?.tenantId || null });
    emitTicketsChanged({ action: "status", tenantId: req.user?.tenantId || null, id, status });
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/tickets/:id/status", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const scope = applyScope(req, "t");
    const [r] = await pool.execute(
      `UPDATE tickets t
       SET t.is_deleted = 1, t.deleted_at = NOW(), t.updated_at = NOW()
       WHERE t.id = ? AND ${scope.where}`,
      [id, ...scope.params]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Ticket not found" });
    emitAdminChanged({ scope: "tickets", action: "delete", tenantId: req.user?.tenantId || null });
    emitCalendarChanged({ reason: "tickets", tenantId: req.user?.tenantId || null });
    emitTicketsChanged({ action: "delete", tenantId: req.user?.tenantId || null, id });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/tickets/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
