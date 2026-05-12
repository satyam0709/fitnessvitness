const { pool } = require("../config/database");

async function getPayroll(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();

    const [rows] = await pool.execute(
      `SELECT p.*,
              u.first_name,
              u.last_name,
              u.email,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM payroll p
       JOIN users u ON u.id = p.user_id
       WHERE p.month = ? AND p.year = ?
         AND (? IS NULL OR u.tenant_id = ?)
       ORDER BY u.first_name ASC, u.last_name ASC`,
      [month, year, tenantId, tenantId]
    );

    res.json({ success: true, payroll: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function upsertPayroll(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const [[urow]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [user_id, tenantId, tenantId]
    );
    if (!urow) return res.status(404).json({ success: false, message: "User not found in your tenant." });
    const {
      user_id,
      month,
      year,
      basic = 0,
      allowances = 0,
      deductions = 0,
      net,
    } = req.body;

    const payrollMonth = Number(month) || new Date().getMonth() + 1;
    const payrollYear = Number(year) || new Date().getFullYear();
    const basicAmount = Number(basic) || 0;
    const allowancesAmount = Number(allowances) || 0;
    const deductionsAmount = Number(deductions) || 0;
    const netAmount = net == null
      ? basicAmount + allowancesAmount - deductionsAmount
      : Number(net) || 0;

    await pool.execute(
      `INSERT INTO payroll (user_id, month, year, basic, allowances, deductions, net)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         basic = VALUES(basic),
         allowances = VALUES(allowances),
         deductions = VALUES(deductions),
         net = VALUES(net)`,
      [
        user_id,
        payrollMonth,
        payrollYear,
        basicAmount,
        allowancesAmount,
        deductionsAmount,
        netAmount,
      ]
    );

    const [[record]] = await pool.execute(
      `SELECT id
       FROM payroll
       WHERE user_id = ? AND month = ? AND year = ?
       LIMIT 1`,
      [user_id, payrollMonth, payrollYear]
    );

    res.json({ success: true, id: record?.id || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markPayrollPaid(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    await pool.execute(
      `UPDATE payroll p
       JOIN users u ON u.id = p.user_id
       SET p.paid_at = NOW()
       WHERE p.id = ? AND (? IS NULL OR u.tenant_id = ?)`,
      [req.params.id, tenantId, tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAppraisals(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    let where = "(? IS NULL OR u.tenant_id = ?)";
    const params = [];
    params.push(tenantId, tenantId);

    if (req.query.user_id) {
      where += " AND a.user_id = ?";
      params.push(req.query.user_id);
    }

    if (req.query.period) {
      where += " AND a.period = ?";
      params.push(req.query.period);
    }

    const [rows] = await pool.execute(
      `SELECT a.*,
              u.first_name,
              u.last_name,
              u.email,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM appraisals a
       JOIN users u ON u.id = a.user_id
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );

    res.json({ success: true, appraisals: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createAppraisal(req, res) {
  try {
    const tenantId = req.user?.tenantId || null;
    const { user_id, period, rating, comments } = req.body;
    const [[urow]] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND (? IS NULL OR tenant_id = ?) LIMIT 1",
      [user_id, tenantId, tenantId]
    );
    if (!urow) return res.status(404).json({ success: false, message: "User not found in your tenant." });

    const [result] = await pool.execute(
      `INSERT INTO appraisals (user_id, period, rating, comments)
       VALUES (?, ?, ?, ?)`,
      [user_id, period, rating, comments || null]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getPayroll,
  upsertPayroll,
  markPayrollPaid,
  getAppraisals,
  createAppraisal,
};
