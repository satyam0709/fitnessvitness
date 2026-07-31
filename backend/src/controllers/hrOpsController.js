const prisma = require("../config/prisma");

async function getPayroll(req, res) {
  try {
    const { userId, month, year } = req.query;
    const where = {};
    if (userId) where.user_id = Number(userId);
    if (month && year) {
      where.month = Number(month);
      where.year = Number(year);
    }

    const rows = await prisma.hr_payroll.findMany({
      where,
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    res.json({ payroll: rows });
  } catch (err) {
    console.error("getPayroll error:", err);
    res.status(500).json({ error: "Failed to get payroll" });
  }
}

async function upsertPayroll(req, res) {
  try {
    const { userId, month, year, salary, bonuses, deductions, netPay, notes } = req.body;
    if (!userId || !month || !year) return res.status(400).json({ error: "Missing required fields" });

    const existing = await prisma.hr_payroll.findFirst({
      where: {
        user_id: Number(userId),
        month: Number(month),
        year: Number(year),
      },
      select: { id: true },
    });

    const data = {
      salary: salary || 0,
      bonuses: bonuses || 0,
      deductions: deductions || 0,
      net_pay: netPay || 0,
      notes: notes || "",
    };

    if (existing) {
      await prisma.hr_payroll.update({
        where: { id: existing.id },
        data: { ...data, updated_at: new Date() },
      });
      return res.json({ success: true, id: existing.id });
    }

    const created = await prisma.hr_payroll.create({
      data: {
        user_id: Number(userId),
        month: Number(month),
        year: Number(year),
        ...data,
      },
    });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    console.error("upsertPayroll error:", err);
    res.status(500).json({ error: "Failed to save payroll" });
  }
}

async function markPayrollPaid(req, res) {
  try {
    const { payrollId } = req.params;
    await prisma.hr_payroll.update({
      where: { id: Number(payrollId) },
      data: {
        status: "paid",
        paid_at: new Date(),
        updated_at: new Date(),
      },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("markPayrollPaid error:", err);
    res.status(500).json({ error: "Failed to mark payroll paid" });
  }
}

async function getAppraisals(req, res) {
  try {
    const { userId, year } = req.query;
    const where = {};
    if (userId) where.user_id = Number(userId);
    if (year) where.year = Number(year);

    const rows = await prisma.hr_appraisals.findMany({
      where,
      orderBy: [{ year: "desc" }, { created_at: "desc" }],
    });
    res.json({ appraisals: rows });
  } catch (err) {
    console.error("getAppraisals error:", err);
    res.status(500).json({ error: "Failed to get appraisals" });
  }
}

async function createAppraisal(req, res) {
  try {
    const { userId, year, rating, strengths, improvements, comments } = req.body;
    if (!userId || !year) return res.status(400).json({ error: "Missing required fields" });

    const created = await prisma.hr_appraisals.create({
      data: {
        user_id: Number(userId),
        year: Number(year),
        rating: rating || 0,
        strengths: strengths || "",
        improvements: improvements || "",
        comments: comments || "",
      },
    });
    res.status(201).json({ success: true, id: created.id });
  } catch (err) {
    console.error("createAppraisal error:", err);
    res.status(500).json({ error: "Failed to create appraisal" });
  }
}

module.exports = {
  getPayroll,
  upsertPayroll,
  markPayrollPaid,
  getAppraisals,
  createAppraisal,
};
