const { pool } = require("../config/database");

async function getAttendance(req, res) {
  try {
    const { tenantId } = req;
    const { date, userId } = req.query;
    let query = "SELECT * FROM hr_attendance WHERE tenant_id = ?";
    const params = [tenantId];
    if (date) { query += " AND date = ?"; params.push(date); }
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    query += " ORDER BY date DESC, created_at DESC";
    const [rows] = await pool.execute(query, params);
    res.json({ attendance: rows });
  } catch (err) {
    console.error("getAttendance error:", err);
    res.status(500).json({ error: "Failed to get attendance" });
  }
}

async function markAttendance(req, res) {
  try {
    const { tenantId } = req;
    const { date, status, notes } = req.body;
    if (!date || !status) return res.status(400).json({ error: "Date and status required" });
    const [existing] = await pool.execute(
      "SELECT id FROM hr_attendance WHERE tenant_id = ? AND user_id = ? AND date = ?",
      [tenantId, req.user.id, date]
    );
    if (existing.length) {
      await pool.execute(
        "UPDATE hr_attendance SET status = ?, notes = ?, updated_at = NOW() WHERE id = ?",
        [status, notes || "", existing[0].id]
      );
      return res.json({ success: true, message: "Attendance updated" });
    }
    const [result] = await pool.execute(
      "INSERT INTO hr_attendance (tenant_id, user_id, date, status, notes) VALUES (?, ?, ?, ?, ?)",
      [tenantId, req.user.id, date, status, notes || ""]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("markAttendance error:", err);
    res.status(500).json({ error: "Failed to mark attendance" });
  }
}

async function getLeaves(req, res) {
  try {
    const { tenantId } = req;
    const { userId, status } = req.query;
    let query = "SELECT * FROM hr_leaves WHERE tenant_id = ?";
    const params = [tenantId];
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    if (status) { query += " AND status = ?"; params.push(status); }
    query += " ORDER BY start_date DESC";
    const [rows] = await pool.execute(query, params);
    res.json({ leaves: rows });
  } catch (err) {
    console.error("getLeaves error:", err);
    res.status(500).json({ error: "Failed to get leaves" });
  }
}

async function createLeaveRequest(req, res) {
  try {
    const { tenantId } = req;
    const { startDate, endDate, leaveType, reason } = req.body;
    if (!startDate || !endDate || !leaveType) return res.status(400).json({ error: "Missing required fields" });
    const [result] = await pool.execute(
      "INSERT INTO hr_leaves (tenant_id, user_id, start_date, end_date, leave_type, reason, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      [tenantId, req.user.id, startDate, endDate, leaveType, reason || ""]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("createLeaveRequest error:", err);
    res.status(500).json({ error: "Failed to create leave request" });
  }
}

async function approveLeave(req, res) {
  try {
    const { leaveId } = req.params;
    const { tenantId } = req;
    await pool.execute("UPDATE hr_leaves SET status = 'approved', approved_by = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?", [req.user.id, leaveId, tenantId]);
    res.json({ success: true });
  } catch (err) {
    console.error("approveLeave error:", err);
    res.status(500).json({ error: "Failed to approve leave" });
  }
}

async function rejectLeave(req, res) {
  try {
    const { leaveId } = req.params;
    const { tenantId } = req;
    await pool.execute("UPDATE hr_leaves SET status = 'rejected', approved_by = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?", [req.user.id, leaveId, tenantId]);
    res.json({ success: true });
  } catch (err) {
    console.error("rejectLeave error:", err);
    res.status(500).json({ error: "Failed to reject leave" });
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