const { pool } = require("../config/database");

// ── Attendance ───────────────────────────────────────────────

async function getAttendance(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { month, year } = req.query;
    const m = Number(month) || new Date().getMonth() + 1;
    const y = Number(year) || new Date().getFullYear();

    const [rows] = await pool.execute(
      `SELECT a.*,
              u.first_name, u.last_name, u.email,
              CONCAT(u.first_name, ' ', u.last_name) as user_name
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE MONTH(a.date) = ? AND YEAR(a.date) = ?
         AND (? IS NULL OR u.tenant_id = ?)
       ORDER BY a.date DESC, u.first_name ASC`,
      [m, y, tenantId, tenantId]
    );
    res.json({ success: true, records: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAttendance(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { user_id, date, check_in, check_out, status, note } = req.body;
    const [[urow]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [user_id, tenantId, tenantId]
    );
    if (!urow) return res.status(404).json({ success: false, message: "User not found in your tenant." });
    await pool.execute(
      `INSERT INTO attendance (user_id, date, check_in, check_out, status, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE check_in=VALUES(check_in), check_out=VALUES(check_out),
                               status=VALUES(status), note=VALUES(note)`,
      [user_id, date, check_in || null, check_out || null, status || "present", note || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── Leaves ───────────────────────────────────────────────────

async function getLeaves(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { status } = req.query;
    const params = [];
    let where = "(? IS NULL OR u.tenant_id = ?)";
    params.push(tenantId, tenantId);
    if (status) {
      where += " AND lr.status = ?";
      params.push(status);
    }

    const [rows] = await pool.execute(
      `SELECT lr.*,
              CONCAT(u.first_name, ' ', u.last_name) as user_name,
              u.email,
              CONCAT(a.first_name, ' ', a.last_name) as approver_name
       FROM leave_requests lr
       JOIN  users u ON u.id = lr.user_id
       LEFT JOIN users a ON a.id = lr.approved_by
       WHERE ${where}
       ORDER BY lr.created_at DESC`,
      params
    );
    res.json({ success: true, leaves: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createLeaveRequest(req, res) {
  try {
    const { leave_type, from_date, to_date, reason } = req.body;

    const tenantId = req.user?.tenantId || null;
    const actorId = Number(req.user?.id);
    if (!actorId) return res.status(401).json({ success: false, message: "Not authenticated" });

    const [[user]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [actorId, tenantId, tenantId]
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const days = Math.ceil((new Date(to_date) - new Date(from_date)) / 86400000) + 1;

    const [result] = await pool.execute(
      `INSERT INTO leave_requests (user_id, leave_type, from_date, to_date, days, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, leave_type || "annual", from_date, to_date, days, reason || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function approveLeave(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const actorId = Number(req.user?.id);
    const [[approver]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [actorId, tenantId, tenantId]
    );
    await pool.execute(
      `UPDATE leave_requests lr
       JOIN users u ON u.id = lr.user_id
       SET lr.status='approved', lr.approved_by=?
       WHERE lr.id=? AND (? IS NULL OR u.tenant_id = ?)`,
      [approver?.id || null, req.params.id, tenantId, tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function rejectLeave(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const actorId = Number(req.user?.id);
    const [[approver]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [actorId, tenantId, tenantId]
    );
    await pool.execute(
      `UPDATE leave_requests lr
       JOIN users u ON u.id = lr.user_id
       SET lr.status='rejected', lr.approved_by=?
       WHERE lr.id=? AND (? IS NULL OR u.tenant_id = ?)`,
      [approver?.id || null, req.params.id, tenantId, tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getAttendance,
  markAttendance,
  getLeaves,
  createLeaveRequest,
  approveLeave,
  rejectLeave,
};
