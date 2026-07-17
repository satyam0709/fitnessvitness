const prisma = require("../config/prisma");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");

function tenantIdFromReq(req) {
  return req.user?.tenantId ?? req.user?.tenant_id ?? null;
}

function isStaff(req) {
  return String(req.user?.role || "") === "staff";
}

async function submitContact(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "No tenant workspace assigned." });
    }

    const { name, phone, email, message, type = "contact" } = req.body;

    if (!name || !phone || !email) {
      return res.status(422).json({
        success: false,
        message: "Name, phone and email are required",
      });
    }

    const validTypes = ["contact", "demo"];
    if (!validTypes.includes(type)) {
      return res.status(422).json({
        success: false,
        message: 'Type must be "contact" or "demo"',
      });
    }

    const insertId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO contact_requests (tenant_id, name, phone, email, message, type, created_by, assigned_to)
       VALUES (${tenantId}, ${name}, ${phone}, ${email}, ${message || null}, ${type}, ${req.user?.id || null}, ${req.user?.id || null})`;
      const rows = await tx.$queryRaw`SELECT LAST_INSERT_ID() as id`;
      return Number(rows[0].id);
    });

    emitAdminChanged({ scope: "contacts", action: "new_request", id: insertId });
    res.status(201).json({
      success: true,
      message:
        type === "demo"
          ? "Demo request received! We'll contact you within 24 hours."
          : "Message sent! We'll get back to you shortly.",
      data: { id: insertId },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getContacts(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "No tenant workspace assigned." });
    }

    const { type, is_read } = req.query;
    
    // We construct the query string manually since we use raw query, but we pass parameters for safety
    // Using Prisma.sql to build raw query safely
    const { Prisma } = require("../generated/prisma");
    let queryArgs = [Prisma.sql`tenant_id = ${tenantId}`];

    if (type) {
      queryArgs.push(Prisma.sql`type = ${type}`);
    }
    if (is_read !== undefined) {
      queryArgs.push(Prisma.sql`is_read = ${is_read === "true" ? 1 : 0}`);
    }
    if (isStaff(req)) {
      queryArgs.push(Prisma.sql`(assigned_to = ${req.user.id} OR created_by = ${req.user.id})`);
    }

    const rows = await prisma.$queryRaw`SELECT * FROM contact_requests WHERE ${Prisma.join(queryArgs, " AND ")} ORDER BY created_at DESC`;

    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAsRead(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "No tenant workspace assigned." });
    }

    const { id } = req.params;
    const { Prisma } = require("../generated/prisma");
    
    let whereClause = Prisma.sql`id = ${id} AND tenant_id = ${tenantId}`;
    if (isStaff(req)) {
      whereClause = Prisma.sql`${whereClause} AND (assigned_to = ${req.user.id} OR created_by = ${req.user.id})`;
    }
    
    await prisma.$executeRaw`UPDATE contact_requests SET is_read = 1 WHERE ${whereClause}`;
    emitAdminChanged({ scope: "contacts", action: "mark_read", id });
    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { submitContact, getContacts, markAsRead };