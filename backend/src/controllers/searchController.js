const { pool } = require("../config/database");

async function search(req, res) {
  try {
    const { q } = req.query;
    const tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, results: [] });
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required" });
    }

    const like = `%${q.trim()}%`;

    const [leads] = await pool.execute(
      `SELECT 'lead' as type, id, name as title, email as subtitle, status as meta, created_at
       FROM leads
       WHERE tenant_id = ? AND (name LIKE ? OR email LIKE ? OR company_name LIKE ?)
       LIMIT 5`,
      [tenantId, like, like, like]
    );

    const [tasks] = await pool.execute(
      `SELECT 'task' as type, id, title, description as subtitle, status as meta, created_at
       FROM tasks
       WHERE tenant_id = ? AND (title LIKE ? OR description LIKE ?)
       LIMIT 5`,
      [tenantId, like, like]
    );

    const [customers] = await pool.execute(
      `SELECT 'customer' as type, id, name as title, email as subtitle, company as meta, created_at
       FROM customers
       WHERE tenant_id = ? AND (name LIKE ? OR email LIKE ? OR company LIKE ?)
       LIMIT 5`,
      [tenantId, like, like, like]
    );

    const [notes] = await pool.execute(
      `SELECT 'note' as type, id, title, LEFT(content, 80) as subtitle, NULL as meta, created_at
       FROM notes
       WHERE tenant_id = ? AND (title LIKE ? OR content LIKE ?)
       LIMIT 5`,
      [tenantId, like, like]
    );

    const results = [...leads, ...tasks, ...customers, ...notes].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json({ success: true, results, query: q.trim() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { search };