const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const { tableExists } = require("../utils/schemaHelpers");

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

    if (await tableExists("leads")) {
      const conditions = [];
      if (from) {
        conditions.push(Prisma.sql`created_at >= ${from}`);
      }
      if (to) {
        conditions.push(Prisma.sql`created_at <= ${to}`);
      }
      const whereSql = conditions.length > 0 ? Prisma.join(conditions, ' AND ') : Prisma.sql`1=1`;

      const rows = await prisma.$queryRaw`
        SELECT status, COUNT(*) AS count, COALESCE(SUM(0), 0) AS total_value
        FROM leads
        WHERE ${whereSql}
        GROUP BY status
        ORDER BY count DESC
      `;

      const formattedRows = rows.map(r => ({
        status: r.status,
        count: Number(r.count),
        total_value: Number(r.total_value || 0),
      }));

      // Append opportunity Closed Won / Lost booked values (leads pipeline has no deal amounts)
      if (await tableExists("opportunities")) {
        try {
          const { getClosedWonLostInRange, getClosedWonLostLifetime } = require("../services/opportunityRevenueStats");
          const closed =
            from || to
              ? await getClosedWonLostInRange(req, from || new Date(2000, 0, 1), to || new Date())
              : await getClosedWonLostLifetime(req);
          formattedRows.push({
            status: "closed_won",
            count: closed.closed_won_count,
            total_value: closed.closed_won_value,
          });
          formattedRows.push({
            status: "closed_lost",
            count: closed.closed_lost_count,
            total_value: closed.closed_lost_value,
          });
        } catch (appendErr) {
          console.warn("getPipelineReport closed append:", appendErr.message);
        }
      }

      return res.json({ success: true, data: formattedRows });
    }

    if (await tableExists("opportunities")) {
      try {
        const conditions = [Prisma.sql`is_deleted = 0`];
        if (from) {
          conditions.push(Prisma.sql`created_at >= ${from}`);
        }
        if (to) {
          conditions.push(Prisma.sql`created_at <= ${to}`);
        }
        const whereSql = Prisma.join(conditions, ' AND ');

        const rows = await prisma.$queryRaw`
          SELECT stage AS status,
                 COUNT(*) AS count,
                 COALESCE(SUM(
                   CASE
                     WHEN stage = 'closed_won' AND UPPER(COALESCE(currency, 'INR')) = 'INR'
                       THEN COALESCE(final_amount, amount)
                     WHEN UPPER(COALESCE(currency, 'INR')) = 'INR'
                       THEN amount
                     ELSE 0
                   END
                 ), 0) AS total_value
          FROM opportunities
          WHERE ${whereSql}
          GROUP BY stage
          ORDER BY count DESC
        `;

        const formattedRows = rows.map(r => ({
          status: r.status,
          count: Number(r.count),
          total_value: Number(r.total_value || 0),
        }));

        return res.json({ success: true, data: formattedRows });
      } catch (oppErr) {
        console.warn("getPipelineReport opportunities:", oppErr.message);
      }
    }

    return res.json({ success: true, data: [] });
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

    const rows = await prisma.$queryRaw`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
             COUNT(*) AS total_leads,
             SUM(CASE WHEN status IN ('confirm') THEN 1 ELSE 0 END) AS won_leads
      FROM leads
      WHERE created_at >= ${fromDate}
        AND created_at <= ${toDate}
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY ym ASC
    `;

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
    let dateCondition;
    if (from && to) {
      dateCondition = Prisma.sql`BETWEEN ${from} AND ${to}`;
    } else if (from) {
      dateCondition = Prisma.sql`>= ${from}`;
    } else if (to) {
      dateCondition = Prisma.sql`<= ${to}`;
    } else {
      dateCondition = Prisma.sql`>= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    }

    const rows = await prisma.$queryRaw`
      SELECT
        u.id AS user_id,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name,
        u.email,
        COALESCE(t.tasks_completed, 0) AS tasks_completed,
        COALESCE(n.notes_added, 0) AS notes_added,
        COALESCE(f.calls_logged, 0) AS calls_logged,
        COALESCE(t.tasks_completed, 0) + COALESCE(n.notes_added, 0) + COALESCE(f.calls_logged, 0) AS total_activity
      FROM users u
      LEFT JOIN (
        SELECT created_by AS user_id, COUNT(*) AS tasks_completed
        FROM tasks
        WHERE status IN ('completed', 'done')
          AND updated_at ${dateCondition}
        GROUP BY created_by
      ) t ON t.user_id = u.id
      LEFT JOIN (
        SELECT created_by AS user_id, COUNT(*) AS notes_added
        FROM notes
        WHERE created_at ${dateCondition}
        GROUP BY created_by
      ) n ON n.user_id = u.id
      LEFT JOIN (
        SELECT lf.created_by AS user_id, COUNT(*) AS calls_logged
        FROM lead_followups lf
        INNER JOIN leads l ON l.id = lf.lead_id
        WHERE lf.created_at ${dateCondition}
        GROUP BY lf.created_by
      ) f ON f.user_id = u.id
      WHERE u.is_active = 1
      ORDER BY total_activity DESC, user_name ASC
    `;

    const formattedRows = rows.map(r => ({
      user_id: r.user_id,
      user_name: r.user_name,
      email: r.email,
      tasks_completed: Number(r.tasks_completed),
      notes_added: Number(r.notes_added),
      calls_logged: Number(r.calls_logged),
      total_activity: Number(r.total_activity),
    }));

    res.json({ success: true, data: formattedRows });
  } catch (err) {
    console.error("getActivityReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRevenueReport(req, res) {
  try {
    const { getClosedWonByMonth, getClosedWonLostInRange, getClosedWonLostLifetime } = require("../services/opportunityRevenueStats");
    const range = rangeFromReq(req);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || twelveMonthsAgo;
    const toDate = range.to || new Date();

    const rows = await prisma.$queryRaw`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
              COALESCE(SUM(total), 0) AS revenue_total
       FROM invoices
       WHERE created_at >= ${fromDate}
         AND created_at <= ${toDate}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY ym ASC
    `;

    const bookedMonths = await getClosedWonByMonth(req, fromDate, toDate);
    const bookedByMonth = new Map(bookedMonths.map((r) => [r.month_key, r]));

    const byMonth = new Map(rows.map((r) => [String(r.ym), Number(r.revenue_total || 0)]));
    const data = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    let invoice_total = 0;
    let booked_won_total = 0;
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const inv = Number(byMonth.get(key) || 0);
      const booked = Number(bookedByMonth.get(key)?.booked_won_total || 0);
      invoice_total += inv;
      booked_won_total += booked;
      data.push({
        month: cursor.toLocaleString("en-IN", { month: "short", year: "numeric" }),
        month_key: key,
        revenue_total: inv,
        booked_won_total: booked,
        closed_won_count: Number(bookedByMonth.get(key)?.closed_won_count || 0),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const [windowStats, lifetime] = await Promise.all([
      getClosedWonLostInRange(req, fromDate, toDate),
      getClosedWonLostLifetime(req),
    ]);

    res.json({
      success: true,
      data,
      summary: {
        invoice_total,
        booked_won_total,
        closed_won_count: windowStats.closed_won_count,
        closed_lost_count: windowStats.closed_lost_count,
        closed_lost_value: windowStats.closed_lost_value,
        lifetime_closed_won_value: lifetime.closed_won_value,
        lifetime_closed_lost_value: lifetime.closed_lost_value,
      },
    });
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

    const byStatus = await prisma.$queryRaw`
      SELECT COALESCE(status, 'unknown') AS key_label,
              COALESCE(SUM(total), 0) AS amount,
              COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ${fromDate} AND created_at <= ${toDate}
       GROUP BY COALESCE(status, 'unknown')
       ORDER BY amount DESC
    `;

    const byType = await prisma.$queryRaw`
      SELECT COALESCE(type, 'unknown') AS key_label,
              COALESCE(SUM(total), 0) AS amount,
              COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ${fromDate} AND created_at <= ${toDate}
       GROUP BY COALESCE(type, 'unknown')
       ORDER BY amount DESC
    `;

    const totRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS cnt
       FROM invoices
       WHERE created_at >= ${fromDate} AND created_at <= ${toDate}
    `;
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

    const conditions = [];
    if (from) {
      conditions.push(Prisma.sql`created_at >= ${from}`);
    }
    if (to) {
      conditions.push(Prisma.sql`created_at <= ${to}`);
    }
    const whereSql = conditions.length > 0 ? Prisma.join(conditions, ' AND ') : Prisma.sql`1=1`;

    let rows = [];
    let headers = [];

    if (type === "leads") {
      rows = await prisma.$queryRaw`
        SELECT id, name, company_name, phone, email, source, status, created_at
        FROM leads
        WHERE ${whereSql}
        ORDER BY created_at DESC
      `;
      headers = ["id", "name", "company_name", "phone", "email", "source", "status", "created_at"];
    } else if (type === "contacts") {
      rows = await prisma.$queryRaw`
        SELECT id, company_name, contact_name, designation, department, email, phone, city, state, created_at
        FROM contacts
        WHERE ${whereSql}
        ORDER BY created_at DESC
      `;
      headers = ["id", "company_name", "contact_name", "designation", "department", "email", "phone", "city", "state", "created_at"];
    } else if (type === "tasks") {
      rows = await prisma.$queryRaw`
        SELECT id, title, description, priority, status, due_date, created_at
        FROM tasks
        WHERE ${whereSql}
        ORDER BY created_at DESC
      `;
      headers = ["id", "title", "description", "priority", "status", "due_date", "created_at"];
    } else if (type === "invoices") {
      rows = await prisma.$queryRaw`
        SELECT id, invoice_number, type, customer_name, invoice_date, due_date, total, status, created_at
        FROM invoices
        WHERE ${whereSql}
        ORDER BY created_at DESC
      `;
      headers = ["id", "invoice_number", "type", "customer_name", "invoice_date", "due_date", "total", "status", "created_at"];
    } else {
      return res.status(400).json({ success: false, message: "Invalid export type" });
    }

    const csv = rowsToCsv(rows, headers);

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
