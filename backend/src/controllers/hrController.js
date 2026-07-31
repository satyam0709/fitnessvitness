const prisma = require("../config/prisma");

async function getAttendance(req, res) {
  try {
    const { date, userId } = req.query;
    const where = {};
    if (date) where.date = new Date(String(date).slice(0, 10));
    if (userId) where.user_id = Number(userId);
    const attendance = await prisma.hr_attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { created_at: "desc" }],
    });
    res.json({ attendance });
  } catch (err) {
    console.error("getAttendance error:", err);
    res.status(500).json({ error: "Failed to get attendance" });
  }
}

async function markAttendance(req, res) {
  try {
    const { date, status, notes } = req.body;
    if (!date || !status) return res.status(400).json({ error: "Date and status required" });
    const day = new Date(String(date).slice(0, 10));
    const existing = await prisma.hr_attendance.findFirst({
      where: { user_id: req.user.id, date: day },
    });
    if (existing) {
      await prisma.hr_attendance.update({
        where: { id: existing.id },
        data: { status, notes: notes || "", updated_at: new Date() },
      });
      return res.json({ success: true, message: "Attendance updated" });
    }
    const created = await prisma.hr_attendance.create({
      data: {
        user_id: req.user.id,
        date: day,
        status,
        notes: notes || "",
      },
    });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    console.error("markAttendance error:", err);
    res.status(500).json({ error: "Failed to mark attendance" });
  }
}

async function getLeaves(req, res) {
  try {
    const { userId, status } = req.query;
    const where = {};
    if (userId) where.user_id = Number(userId);
    if (status) where.status = String(status);
    const leaves = await prisma.hr_leaves.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    res.json({ leaves });
  } catch (err) {
    console.error("getLeaves error:", err);
    res.status(500).json({ error: "Failed to get leaves" });
  }
}

async function createLeaveRequest(req, res) {
  try {
    const { startDate, endDate, leaveType, reason } = req.body;
    if (!startDate || !endDate || !leaveType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const created = await prisma.hr_leaves.create({
      data: {
        user_id: req.user.id,
        start_date: new Date(String(startDate).slice(0, 10)),
        end_date: new Date(String(endDate).slice(0, 10)),
        leave_type: leaveType,
        reason: reason || "",
        status: "pending",
      },
    });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    console.error("createLeaveRequest error:", err);
    res.status(500).json({ error: "Failed to create leave request" });
  }
}

async function approveLeave(req, res) {
  try {
    const leaveId = Number(req.params.leaveId || req.params.id);
    await prisma.hr_leaves.update({
      where: { id: leaveId },
      data: { status: "approved", approved_by: req.user.id, updated_at: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("approveLeave error:", err);
    res.status(500).json({ error: "Failed to approve leave" });
  }
}

async function rejectLeave(req, res) {
  try {
    const leaveId = Number(req.params.leaveId || req.params.id);
    await prisma.hr_leaves.update({
      where: { id: leaveId },
      data: { status: "rejected", approved_by: req.user.id, updated_at: new Date() },
    });
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
