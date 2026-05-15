const { pool } = require("../config/database");

async function getPayroll(req, res) {
  try {
    const { userId, month, year } = req.query;
    let query = "SELECT * FROM hr_payroll WHERE 1=1";
    const params = [];
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    if (month && year) { query += " AND month = ? AND year = ?"; params.push(month, year); }
    query += " ORDER BY year DESC, month DESC";
    const [rows] = await pool.execute(query, params);
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
    const [existing] = await pool.execute(
      "SELECT id FROM hr_payroll WHERE user_id = ? AND month = ? AND year = ?",
      [userId, month, year]
    );
    if (existing.length) {
      await pool.execute(
        `UPDATE hr_payroll SET salary = ?, bonuses = ?, deductions = ?, net_pay = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [salary || 0, bonuses || 0, deductions || 0, netPay || 0, notes || "", existing[0].id]
      );
      return res.json({ success: true, id: existing[0].id });
    }
    const [result] = await pool.execute(
      `INSERT INTO hr_payroll (user_id, month, year, salary, bonuses, deductions, net_pay, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, month, year, salary || 0, bonuses || 0, deductions || 0, netPay || 0, notes || ""]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("upsertPayroll error:", err);
    res.status(500).json({ error: "Failed to save payroll" });
  }
}

async function markPayrollPaid(req, res) {
  try {
    const { payrollId } = req.params;
    await pool.execute(
      "UPDATE hr_payroll SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?",
      [payrollId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("markPayrollPaid error:", err);
    res.status(500).json({ error: "Failed to mark payroll paid" });
  }
}

async function getAppraisals(req, res) {
  try {
    const { userId, year } = req.query;
    let query = "SELECT * FROM hr_appraisals WHERE 1=1";
    const params = [];
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    if (year) { query += " AND year = ?"; params.push(year); }
    query += " ORDER BY year DESC, created_at DESC";
    const [rows] = await pool.execute(query, params);
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
    const [result] = await pool.execute(
      `INSERT INTO hr_appraisals (user_id, year, rating, strengths, improvements, comments)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, year, rating || 0, strengths || "", improvements || "", comments || ""]
    );
    res.status(201).json({ success: true, id: result.insertId });
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