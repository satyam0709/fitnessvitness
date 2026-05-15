const { pool } = require("../config/database");

async function search(req, res) {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, results: [] });
    }

    const like = `%${q.trim()}%`;

    const [leads] = await pool.execute(
      `SELECT 'lead' as type, id, name as title, email as subtitle, status as meta, created_at
       FROM leads
       WHERE (name LIKE ? OR email LIKE ? OR company_name LIKE ?)
       LIMIT 5`,
      [like, like, like]
    );

    const [tasks] = await pool.execute(
      `SELECT 'task' as type, id, title, description as subtitle, status as meta, created_at
       FROM tasks
       WHERE (title LIKE ? OR description LIKE ?)
       LIMIT 5`,
      [like, like]
    );

    const [customers] = await pool.execute(
      `SELECT 'customer' as type, id, name as title, email as subtitle, company as meta, created_at
       FROM customers
       WHERE (name LIKE ? OR email LIKE ? OR company LIKE ?)
       LIMIT 5`,
      [like, like, like]
    );

    const [notes] = await pool.execute(
      `SELECT 'note' as type, id, title, LEFT(content, 80) as subtitle, NULL as meta, created_at
       FROM notes
       WHERE (title LIKE ? OR content LIKE ?)
       LIMIT 5`,
      [like, like]
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