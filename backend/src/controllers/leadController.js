const { pool } = require("../config/database");

async function getLeads(req, res) {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where  = "1=1";
    const params = [];

    if (search) {
      where += " AND (l.name LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR l.phone LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (status) { where += " AND l.status = ?"; params.push(status); }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM leads l WHERE ${where}`,
      params
    );

    const [leads] = await pool.execute(
      `SELECT l.*,
              u.full_name as assigned_name,
              u.email as assigned_email
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ success: true, total, leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getLead(req, res) {
  try {
    const { id } = req.params;

    const [[lead]] = await pool.execute(
      `SELECT l.*,
              u.full_name as assigned_name,
              u.email as assigned_email
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = ?`,
      [id]
    );
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    // Fetch linked tasks, notes, reminders, meetings
    const [tasks]     = await pool.execute("SELECT * FROM tasks WHERE lead_id = ? ORDER BY created_at DESC", [id]);
    const [notes]     = await pool.execute("SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC", [id]);
    const [reminders] = await pool.execute("SELECT * FROM reminders WHERE lead_id = ? ORDER BY remind_at ASC", [id]);
    const [meetings]  = await pool.execute("SELECT * FROM meetings WHERE lead_id = ? ORDER BY start_time ASC", [id]);

    res.json({ success: true, lead, tasks, notes, reminders, meetings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createLead(req, res) {
  try {
    const { name, email, phone, company, source, status, assigned_to, notes } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    const [result] = await pool.execute(
      `INSERT INTO leads (name, email, phone, company, source, status, assigned_to, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        email    || null,
        phone    || null,
        company  || null,
        source   || "Website",
        status   || "new",
        assigned_to ? Number(assigned_to) : null,
        notes    || null,
      ]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateLead(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phone, company, source, status, assigned_to, notes } = req.body;

    await pool.execute(
      `UPDATE leads SET
         name=?, email=?, phone=?, company=?, source=?, status=?, assigned_to=?, notes=?
       WHERE id=?`,
      [
        name    || null,
        email   || null,
        phone   || null,
        company || null,
        source  || "Website",
        status  || "new",
        assigned_to ? Number(assigned_to) : null,
        notes   || null,
        id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateLeadStatus(req, res) {
  try {
    const { status } = req.body;
    await pool.execute("UPDATE leads SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteLead(req, res) {
  try {
    await pool.execute("DELETE FROM leads WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getLeads, getLead, createLead, updateLead, updateLeadStatus, deleteLead };