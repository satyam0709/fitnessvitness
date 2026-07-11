const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const prisma = require("../config/prisma");
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

function applyScope(req) {
  const where = {
    is_deleted: false,
    OR: [
      { tenant_id: null },
      { tenant_id: req.user?.tenantId ?? null }
    ]
  };
  if (!canSeeAllTeamRecords(req)) {
    where.AND = [
      {
        OR: [
          { created_by: req.user.id },
          { assigned_to: req.user.id }
        ]
      }
    ];
  }
  return where;
}

router.get("/", async (req, res) => {
  try {
    const { status, priority, q } = req.query;
    const scope = applyScope(req);
    const where = { ...scope };

    if (status) {
      if (!VALID_STATUS.has(String(status))) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      where.status = String(status);
    }
    if (priority) {
      if (!VALID_PRIORITY.has(String(priority))) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      where.priority = String(priority);
    }
    if (q && String(q).trim()) {
      const qCondition = {
        OR: [
          { subject: { contains: String(q).trim() } },
          { description: { contains: String(q).trim() } }
        ]
      };
      if (where.AND) {
        where.AND.push(qCondition);
      } else {
        where.AND = [qCondition];
      }
    }

    const rows = await prisma.tickets.findMany({
      where,
      orderBy: {
        created_at: 'desc'
      }
    });

    const userIds = [...new Set(rows.map(r => r.assigned_to).filter(Boolean))];
    const users = userIds.length > 0 ? await prisma.users.findMany({
      where: {
        id: { in: userIds }
      },
      select: {
        id: true,
        email: true
      }
    }) : [];
    const userMap = new Map(users.map(u => [u.id, u.email]));
    
    const formattedRows = rows.map(r => ({
      ...r,
      assigned_email: r.assigned_to ? userMap.get(r.assigned_to) || null : null
    }));

    res.json({ success: true, total: formattedRows.length, data: formattedRows });
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
    const tenantIdVal = req.user?.tenantId || null;

    const newTicket = await prisma.tickets.create({
      data: {
        tenant_id: tenantIdVal,
        subject,
        description: req.body?.description ? String(req.body.description) : null,
        priority: priority,
        status: status,
        source: String(req.body?.source || "crm"),
        contact_id: Number(req.body?.contact_id) || null,
        lead_id: Number(req.body?.lead_id) || null,
        assigned_to: assignedTo,
        created_by: req.user.id,
        due_at: req.body?.due_at ? new Date(req.body.due_at) : null
      }
    });

    emitAdminChanged({ scope: "tickets", action: "create", tenantId: tenantIdVal });
    emitCalendarChanged({ reason: "tickets", tenantId: tenantIdVal });
    emitTicketsChanged({ action: "create", tenantId: tenantIdVal, id: newTicket.id });
    res.status(201).json({ success: true, data: newTicket });
  } catch (err) {
    console.error("POST /api/tickets", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const scope = applyScope(req);
    const existing = await prisma.tickets.findFirst({
      where: {
        id,
        ...scope
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Ticket not found" });

    const status = req.body?.status != null ? String(req.body.status) : existing.status;
    const priority = req.body?.priority != null ? String(req.body.priority) : existing.priority;
    if (!VALID_STATUS.has(status)) return res.status(400).json({ success: false, message: "Invalid status" });
    if (!VALID_PRIORITY.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });

    const closedAt = status === "resolved" || status === "closed" ? new Date() : null;
    
    const updatedTicket = await prisma.tickets.update({
      where: { id },
      data: {
        subject: req.body?.subject != null ? String(req.body.subject).trim() : undefined,
        description: req.body?.description !== undefined ? (req.body.description ? String(req.body.description) : null) : undefined,
        priority: priority,
        status: status,
        source: req.body?.source != null ? String(req.body.source) : undefined,
        contact_id: req.body?.contact_id !== undefined ? (Number(req.body.contact_id) || null) : undefined,
        lead_id: req.body?.lead_id !== undefined ? (Number(req.body.lead_id) || null) : undefined,
        assigned_to: req.body?.assigned_to !== undefined ? (Number(req.body.assigned_to) || null) : undefined,
        due_at: req.body?.due_at !== undefined ? (req.body.due_at ? new Date(req.body.due_at) : null) : undefined,
        closed_at: closedAt ? closedAt : (status !== existing.status ? null : undefined),
        updated_at: new Date()
      }
    });

    const tenantIdVal = req.user?.tenantId || null;
    emitAdminChanged({ scope: "tickets", action: "update", tenantId: tenantIdVal });
    emitCalendarChanged({ reason: "tickets", tenantId: tenantIdVal });
    emitTicketsChanged({ action: "update", tenantId: tenantIdVal, id });
    res.json({ success: true, data: updatedTicket });
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
    
    const scope = applyScope(req);
    const existing = await prisma.tickets.findFirst({
      where: {
        id,
        ...scope
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Ticket not found" });

    const closedAt = status === "resolved" || status === "closed" ? new Date() : null;
    await prisma.tickets.update({
      where: { id },
      data: {
        status: status,
        closed_at: closedAt,
        updated_at: new Date()
      }
    });

    const tenantIdVal = req.user?.tenantId || null;
    emitAdminChanged({ scope: "tickets", action: "status", tenantId: tenantIdVal });
    emitCalendarChanged({ reason: "tickets", tenantId: tenantIdVal });
    emitTicketsChanged({ action: "status", tenantId: tenantIdVal, id, status });
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
    
    const scope = applyScope(req);
    const existing = await prisma.tickets.findFirst({
      where: {
        id,
        ...scope
      }
    });
    if (!existing) return res.status(404).json({ success: false, message: "Ticket not found" });

    await prisma.tickets.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date()
      }
    });

    const tenantIdVal = req.user?.tenantId || null;
    emitAdminChanged({ scope: "tickets", action: "delete", tenantId: tenantIdVal });
    emitCalendarChanged({ reason: "tickets", tenantId: tenantIdVal });
    emitTicketsChanged({ action: "delete", tenantId: tenantIdVal, id });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/tickets/:id", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
