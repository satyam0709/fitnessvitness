const { pool } = require("../config/database");

function monthKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function queryDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function rangeFromReq(req) {
  const from = queryDate(req.query.date_from);
  const to = queryDate(req.query.date_to);
  return { from, to };
}

function csvEscape(v) {
  if (v == null) return "";
  const t = String(v);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function rowsToCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

async function getPipelineReport(req, res) {
  try {
    const { from, to } = rangeFromReq(req);
    const where = ["1=1"];
    const params = [];
    if (from) {
      where.push("created_at >= ?");
      params.push(from);
    }
    if (to) {
      where.push("created_at <= ?");
      params.push(to);
    }

    const [rows] = await pool.query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(0), 0) AS total_value
       FROM leads
       WHERE ${where.join(" AND ")}
       GROUP BY status
       ORDER BY count DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getPipelineReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getConversionReport(req, res) {
  try {
    const range = rangeFromReq(req);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || sixMonthsAgo;
    const toDate = range.to || new Date();

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
              COUNT(*) AS total_leads,
              SUM(CASE WHEN status IN ('confirm') THEN 1 ELSE 0 END) AS won_leads
       FROM leads
       WHERE 1=1
         AND created_at >= ?
         AND created_at <= ?
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY ym ASC`,
      [fromDate, toDate]
    );
    const byMonth = new Map(rows.map((r) => [String(r.ym), r]));
    const data = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const row = byMonth.get(key) || {};
      const total = Number(row.total_leads || 0);
      const won = Number(row.won_leads || 0);
      data.push({
        month: cursor.toLocaleString("en-IN", { month: "short", year: "numeric" }),
        month_key: key,
        total_leads: total,
        won_leads: won,
        conversion_rate: total > 0 ? Number(((won / total) * 100).toFixed(2)) : 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("getConversionReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getActivityReport(req, res) {
  try {
    const { from, to } = rangeFromReq(req);
    const dateClause = from && to
      ? "BETWEEN ? AND ?"
      : from
        ? ">= ?"
        : to
          ? "<= ?"
          : ">= DATE_SUB(NOW(), INTERVAL 30 DAY)";
    const dateParams = from && to ? [from, to] : from ? [from] : to ? [to] : [];

    const [rows] = await pool.query(
      `SELECT
         u.id AS user_id,
         u.full_name AS user_name,
         u.email,
         COALESCE(t.tasks_completed, 0) AS tasks_completed,
         COALESCE(n.notes_added, 0) AS notes_added,
         COALESCE(f.calls_logged, 0) AS calls_logged,
         COALESCE(t.tasks_completed, 0) + COALESCE(n.notes_added, 0) + COALESCE(f.calls_logged, 0) AS total_activity
       FROM users u
       LEFT JOIN (
         SELECT created_by AS user_id, COUNT(*) AS tasks_completed
         FROM tasks
         WHERE 1=1
           AND status IN ('completed', 'done')
           AND updated_at ${dateClause}
         GROUP BY created_by
       ) t ON t.user_id = u.id
       LEFT JOIN (
         SELECT created_by AS user_id, COUNT(*) AS notes_added
         FROM notes
         WHERE 1=1
           AND created_at ${dateClause}
         GROUP BY created_by
       ) n ON n.user_id = u.id
       LEFT JOIN (
         SELECT lf.created_by AS user_id, COUNT(*) AS calls_logged
         FROM lead_followups lf
         INNER JOIN leads l ON l.id = lf.lead_id
         WHERE 1=1
           AND lf.created_at ${dateClause}
         GROUP BY lf.created_by
       ) f ON f.user_id = u.id
       WHERE u.is_active = 1
       ORDER BY total_activity DESC, user_name ASC`,
      [...dateParams, ...dateParams, ...dateParams]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("getActivityReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRevenueReport(req, res) {
  try {
    const range = rangeFromReq(req);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || twelveMonthsAgo;
    const toDate = range.to || new Date();

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
              COALESCE(SUM(total), 0) AS revenue_total
       FROM invoices
       WHERE 1=1
         AND created_at >= ?
         AND created_at <= ?
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY ym ASC`,
      [fromDate, toDate]
    );
    const byMonth = new Map(rows.map((r) => [String(r.ym), Number(r.revenue_total || 0)]));
    const data = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      data.push({
        month: cursor.toLocaleString("en-IN", { month: "short", year: "numeric" }),
        month_key: key,
        revenue_total: Number(byMonth.get(key) || 0),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("getRevenueReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/** Invoice aggregates for pie charts: by status and by type (same date range as revenue report). */
async function getInvoiceMixReport(req, res) {
  try {
    const range = rangeFromReq(req);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || twelveMonthsAgo;
    const toDate = range.to || new Date();

    const [byStatus] = await pool.query(
      `SELECT COALESCE(status, 'unknown') AS key_label,
              COALESCE(SUM(total), 0) AS amount,
              COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY COALESCE(status, 'unknown')
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );
    const [byType] = await pool.query(
      `SELECT COALESCE(type, 'unknown') AS key_label,
              COALESCE(SUM(total), 0) AS amount,
              COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY COALESCE(type, 'unknown')
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );
    const [totRows] = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ? AND created_at <= ?`,
      [fromDate, toDate]
    );
    const totRow = totRows[0] || { amount: 0, cnt: 0 };

    const num = (v) => Number(v) || 0;
    res.json({
      success: true,
      data: {
        byStatus: byStatus.map((r) => ({
          key_label: r.key_label,
          amount: num(r.amount),
          cnt: num(r.cnt),
        })),
        byType: byType.map((r) => ({
          key_label: r.key_label,
          amount: num(r.amount),
          cnt: num(r.cnt),
        })),
        totals: {
          amount: num(totRow.amount),
          count: num(totRow.cnt),
        },
      },
    });
  } catch (err) {
    console.error("getInvoiceMixReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function exportReportCsv(req, res) {
  try {
    const type = String(req.params.type || "").toLowerCase();
    const { from, to } = rangeFromReq(req);
    const exports = {
      leads: {
        sql: `SELECT id, name, company_name, phone, email, source, status, created_at
              FROM leads
              WHERE 1=1
                AND (? IS NULL OR created_at >= ?)
                AND (? IS NULL OR created_at <= ?)
              ORDER BY created_at DESC`,
        params: [from, from, to, to],
        headers: ["id", "name", "company_name", "phone", "email", "source", "status", "created_at"],
      },
      contacts: {
        sql: `SELECT id, company_name, contact_name, designation, department, email, phone, city, state, created_at
              FROM contacts
              WHERE (? IS NULL OR created_at >= ?)
                AND (? IS NULL OR created_at <= ?)
              ORDER BY created_at DESC`,
        params: [from, from, to, to],
        headers: ["id", "company_name", "contact_name", "designation", "department", "email", "phone", "city", "state", "created_at"],
      },
      tasks: {
        sql: `SELECT id, title, description, priority, status, due_date, created_at
              FROM tasks
              WHERE 1=1
                AND (? IS NULL OR created_at >= ?)
                AND (? IS NULL OR created_at <= ?)
              ORDER BY created_at DESC`,
        params: [from, from, to, to],
        headers: ["id", "title", "description", "priority", "status", "due_date", "created_at"],
      },
      invoices: {
        sql: `SELECT id, invoice_number, type, customer_name, invoice_date, due_date, total, status, created_at
              FROM invoices
              WHERE 1=1
                AND (? IS NULL OR created_at >= ?)
                AND (? IS NULL OR created_at <= ?)
              ORDER BY created_at DESC`,
        params: [from, from, to, to],
        headers: ["id", "invoice_number", "type", "customer_name", "invoice_date", "due_date", "total", "status", "created_at"],
      },
    };

    const cfg = exports[type];
    if (!cfg) return res.status(400).json({ success: false, message: "Invalid export type" });

    const [rows] = await pool.query(cfg.sql, cfg.params);
    const csv = rowsToCsv(rows, cfg.headers);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="reports-${type}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("exportReportCsv", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getPipelineReport,
  getConversionReport,
  getActivityReport,
  getRevenueReport,
  getInvoiceMixReport,
  exportReportCsv,
};
