const { pool } = require("../config/database");
const { emitAdminChanged } = require("../realtime/meetingsRealtime");

async function getTasks(req, res) {
  try {
    const { status, assigned_to, page = 1, limit = 100 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where  = "1=1";
    const params = [];

    if (status)      { where += " AND t.status = ?";      params.push(status); }
    if (assigned_to) { where += " AND t.assigned_to = ?"; params.push(assigned_to); }

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM tasks t WHERE ${where}`,
      params
    );

    const [tasks] = await pool.execute(
      `SELECT t.*,
              CONCAT(u.first_name, ' ', u.last_name) as assigned_name,
              u.email as assigned_email,
              l.name as lead_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE ${where}
       ORDER BY
         FIELD(t.status, 'todo', 'in_progress', 'done'),
         FIELD(t.priority, 'high', 'medium', 'low'),
         t.due_date ASC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ success: true, total, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getTask(req, res) {
  try {
    const [[task]] = await pool.execute(
      `SELECT t.*,
              CONCAT(u.first_name, ' ', u.last_name) as assigned_name,
              u.email as assigned_email,
              l.name as lead_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createTask(req, res) {
  try {
    const { title, description, status, priority, assigned_to, lead_id, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: "Title is required" });

    const [result] = await pool.execute(
      `INSERT INTO tasks (title, description, status, priority, assigned_to, lead_id, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        description  || null,
        status       || "todo",
        priority     || "medium",
        assigned_to  ? Number(assigned_to) : null,
        lead_id      ? Number(lead_id)     : null,
        due_date     || null,
      ]
    );
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "create" });
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTask(req, res) {
  try {
    const { title, description, status, priority, assigned_to, lead_id, due_date } = req.body;
    await pool.execute(
      `UPDATE tasks SET
         title=?, description=?, status=?, priority=?, assigned_to=?, lead_id=?, due_date=?
       WHERE id=?`,
      [
        title        || null,
        description  || null,
        status       || "todo",
        priority     || "medium",
        assigned_to  ? Number(assigned_to) : null,
        lead_id      ? Number(lead_id)     : null,
        due_date     || null,
        req.params.id,
      ]
    );
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "update" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTaskStatus(req, res) {
  try {
    const { status } = req.body;
    const valid = ["todo", "in_progress", "done"];
    if (!valid.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    await pool.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, req.params.id]);
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "status" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteTask(req, res) {
  try {
    await pool.execute("DELETE FROM tasks WHERE id = ?", [req.params.id]);
    emitAdminChanged({ scope: "stats", reason: "tasks", action: "delete" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getTasks, getTask, createTask, updateTask, updateTaskStatus, deleteTask };