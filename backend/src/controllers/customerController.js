const { pool } = require("../config/database");

async function getCustomers(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = "is_deleted = 0 AND (? IS NULL OR tenant_id = ?)";
    const params = [tenantId, tenantId];

    if (search) {
      where += " AND (name LIKE ? OR email LIKE ? OR company LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM customers WHERE ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT * FROM customers WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ success: true, total, customers: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createCustomer(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { name, email, phone, company, city, country, lead_id } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO customers (tenant_id, name, email, phone, company, city, country, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        name,
        email || null,
        phone || null,
        company || null,
        city || null,
        country || "India",
        lead_id || null,
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateCustomer(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { name, email, phone, company, city, country } = req.body;
    await pool.execute(
      `UPDATE customers SET name=?, email=?, phone=?, company=?, city=?, country=?
       WHERE id=? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)`,
      [
        name,
        email || null,
        phone || null,
        company || null,
        city || null,
        country || "India",
        req.params.id,
        tenantId,
        tenantId,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteCustomer(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    await pool.execute(
      "UPDATE customers SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND is_deleted = 0 AND (? IS NULL OR tenant_id = ?)",
      [
      req.params.id,
      tenantId,
      tenantId,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getCustomers, createCustomer, updateCustomer, deleteCustomer };