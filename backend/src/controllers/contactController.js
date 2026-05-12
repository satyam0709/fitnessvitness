const { mainPool } = require("../config/database");
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

    // here date check and verify

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

    const [result] = await mainPool.execute(
      `INSERT INTO contact_requests (tenant_id, name, phone, email, message, type, created_by, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, name, phone, email, message || null, type, req.user?.id || null, req.user?.id || null]
    );

    emitAdminChanged({ scope: "contacts", action: "new_request", id: result.insertId });
    res.status(201).json({
      success: true,
      message:
        type === "demo"
          ? "Demo request received! We'll contact you within 24 hours."
          : "Message sent! We'll get back to you shortly.",
      data: { id: result.insertId },
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
    let where = "WHERE 1=1";
    const params = [tenantId];

    where += " AND tenant_id = ?";

    if (type) {
      where += " AND type = ?";
      params.push(type);
    }
    if (is_read !== undefined) {
      where += " AND is_read = ?";
      params.push(is_read === "true" ? 1 : 0);
    }
    if (isStaff(req)) {
      where += " AND (assigned_to = ? OR created_by = ?)";
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await mainPool.execute(
      `SELECT * FROM contact_requests ${where} ORDER BY created_at DESC`,
      params
    );

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
    const params = [id, tenantId];
    let sql = "UPDATE contact_requests SET is_read = 1 WHERE id = ? AND tenant_id = ?";
    if (isStaff(req)) {
      sql += " AND (assigned_to = ? OR created_by = ?)";
      params.push(req.user.id, req.user.id);
    }
    await mainPool.execute(sql, params);
    emitAdminChanged({ scope: "contacts", action: "mark_read", id });
    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { submitContact, getContacts, markAsRead };