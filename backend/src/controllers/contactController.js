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

    const created = await prisma.contact_requests.create({
      data: {
        tenant_id: tenantId,
        name,
        phone,
        email,
        message: message || null,
        type,
        created_by: req.user?.id || null,
        assigned_to: req.user?.id || null,
      },
    });

    emitAdminChanged({ scope: "contacts", action: "new_request", id: created.id });
    res.status(201).json({
      success: true,
      message:
        type === "demo"
          ? "Demo request received! We'll contact you within 24 hours."
          : "Message sent! We'll get back to you shortly.",
      data: { id: created.id },
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
    const where = { tenant_id: tenantId };

    if (type) where.type = type;
    if (is_read !== undefined) where.is_read = is_read === "true";
    if (isStaff(req)) {
      where.OR = [
        { assigned_to: req.user.id },
        { created_by: req.user.id },
      ];
    }

    const rows = await prisma.contact_requests.findMany({
      where,
      orderBy: { created_at: "desc" },
    });

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

    const id = Number(req.params.id);
    const where = { id, tenant_id: tenantId };
    if (isStaff(req)) {
      where.OR = [
        { assigned_to: req.user.id },
        { created_by: req.user.id },
      ];
    }

    await prisma.contact_requests.updateMany({
      where,
      data: { is_read: true },
    });
    emitAdminChanged({ scope: "contacts", action: "mark_read", id });
    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { submitContact, getContacts, markAsRead };
