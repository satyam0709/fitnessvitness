const prisma = require("../config/prisma");
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

function num(v) {
  if (v == null) return 0;
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  return Number(v) || 0;
}

function createdAtWhere(from, to) {
  const where = {};
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;
  }
  return where;
}

async function getPipelineReport(req, res) {
  try {
    const { from, to } = rangeFromReq(req);

    if (await tableExists("leads")) {
      const grouped = await prisma.leads.groupBy({
        by: ["status"],
        where: createdAtWhere(from, to),
        _count: { _all: true },
      });

      const formattedRows = grouped
        .map((r) => ({
          status: r.status,
          count: Number(r._count._all),
          total_value: 0,
        }))
        .sort((a, b) => b.count - a.count);

      if (await tableExists("opportunities")) {
        try {
          const {
            getClosedWonLostInRange,
            getClosedWonLostLifetime,
          } = require("../services/opportunityRevenueStats");
          const closed =
            from || to
              ? await getClosedWonLostInRange(
                  req,
                  from || new Date(2000, 0, 1),
                  to || new Date()
                )
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
        const where = { is_deleted: false, ...createdAtWhere(from, to) };
        const rows = await prisma.opportunities.findMany({
          where,
          select: {
            stage: true,
            amount: true,
            final_amount: true,
            currency: true,
          },
        });
        const byStage = {};
        for (const o of rows) {
          const st = o.stage;
          if (!byStage[st]) byStage[st] = { status: st, count: 0, total_value: 0 };
          byStage[st].count += 1;
          const currency = String(o.currency || "INR").toUpperCase();
          if (currency === "INR") {
            if (st === "closed_won") {
              byStage[st].total_value += num(o.final_amount ?? o.amount);
            } else {
              byStage[st].total_value += num(o.amount);
            }
          }
        }
        const formattedRows = Object.values(byStage).sort((a, b) => b.count - a.count);
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

    const leads = await prisma.leads.findMany({
      where: {
        created_at: { gte: fromDate, lte: toDate },
      },
      select: { created_at: true, status: true },
    });

    const byMonth = new Map();
    for (const l of leads) {
      const key = monthKey(l.created_at);
      if (!key) continue;
      if (!byMonth.has(key)) byMonth.set(key, { total_leads: 0, won_leads: 0 });
      const row = byMonth.get(key);
      row.total_leads += 1;
      if (l.status === "confirm") row.won_leads += 1;
    }

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
    let dateFrom = from;
    let dateTo = to;
    if (!dateFrom && !dateTo) {
      dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 30);
    }

    const updatedAt = {};
    const createdAt = {};
    if (dateFrom) {
      updatedAt.gte = dateFrom;
      createdAt.gte = dateFrom;
    }
    if (dateTo) {
      updatedAt.lte = dateTo;
      createdAt.lte = dateTo;
    }

    const users = await prisma.users.findMany({
      where: { is_active: true },
      select: { id: true, first_name: true, last_name: true, email: true },
    });

    const [tasks, notes, followups] = await Promise.all([
      prisma.tasks.groupBy({
        by: ["created_by"],
        where: {
          status: { in: ["completed", "done"] },
          updated_at: updatedAt,
        },
        _count: { _all: true },
      }),
      prisma.notes.groupBy({
        by: ["created_by"],
        where: { created_at: createdAt },
        _count: { _all: true },
      }),
      prisma.lead_followups.groupBy({
        by: ["created_by"],
        where: { created_at: createdAt },
        _count: { _all: true },
      }),
    ]);

    const taskMap = Object.fromEntries(tasks.map((t) => [t.created_by, t._count._all]));
    const noteMap = Object.fromEntries(notes.map((n) => [n.created_by, n._count._all]));
    const callMap = Object.fromEntries(
      followups.map((f) => [f.created_by, f._count._all])
    );

    const formattedRows = users
      .map((u) => {
        const tasks_completed = Number(taskMap[u.id] || 0);
        const notes_added = Number(noteMap[u.id] || 0);
        const calls_logged = Number(callMap[u.id] || 0);
        const user_name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
        return {
          user_id: u.id,
          user_name,
          email: u.email,
          tasks_completed,
          notes_added,
          calls_logged,
          total_activity: tasks_completed + notes_added + calls_logged,
        };
      })
      .sort(
        (a, b) =>
          b.total_activity - a.total_activity ||
          String(a.user_name).localeCompare(String(b.user_name))
      );

    res.json({ success: true, data: formattedRows });
  } catch (err) {
    console.error("getActivityReport", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getRevenueReport(req, res) {
  try {
    const {
      getClosedWonByMonth,
      getClosedWonLostInRange,
      getClosedWonLostLifetime,
    } = require("../services/opportunityRevenueStats");
    const range = rangeFromReq(req);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || twelveMonthsAgo;
    const toDate = range.to || new Date();

    const invoices = await prisma.invoices.findMany({
      where: { created_at: { gte: fromDate, lte: toDate } },
      select: { created_at: true, total: true },
    });
    const invByMonth = new Map();
    for (const inv of invoices) {
      const key = monthKey(inv.created_at);
      if (!key) continue;
      invByMonth.set(key, (invByMonth.get(key) || 0) + num(inv.total));
    }

    const bookedMonths = await getClosedWonByMonth(req, fromDate, toDate);
    const bookedByMonth = new Map(bookedMonths.map((r) => [r.month_key, r]));

    const data = [];
    const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    let invoice_total = 0;
    let booked_won_total = 0;
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const inv = Number(invByMonth.get(key) || 0);
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

async function getInvoiceMixReport(req, res) {
  try {
    const range = rangeFromReq(req);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const fromDate = range.from || twelveMonthsAgo;
    const toDate = range.to || new Date();
    const where = { created_at: { gte: fromDate, lte: toDate } };

    const [byStatusRows, byTypeRows, totalsAgg] = await Promise.all([
      prisma.invoices.groupBy({
        by: ["status"],
        where,
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.invoices.groupBy({
        by: ["type"],
        where,
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.invoices.aggregate({
        where,
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const byStatus = byStatusRows
      .map((r) => ({
        key_label: r.status || "unknown",
        amount: num(r._sum.total),
        cnt: Number(r._count._all),
      }))
      .sort((a, b) => b.amount - a.amount);

    const byType = byTypeRows
      .map((r) => ({
        key_label: r.type || "unknown",
        amount: num(r._sum.total),
        cnt: Number(r._count._all),
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({
      success: true,
      data: {
        byStatus,
        byType,
        totals: {
          amount: num(totalsAgg._sum.total),
          count: Number(totalsAgg._count._all || 0),
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
    const where = createdAtWhere(from, to);

    let rows = [];
    let headers = [];

    if (type === "leads") {
      rows = await prisma.leads.findMany({
        where,
        select: {
          id: true,
          name: true,
          company_name: true,
          phone: true,
          email: true,
          source: true,
          status: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
      });
      headers = [
        "id",
        "name",
        "company_name",
        "phone",
        "email",
        "source",
        "status",
        "created_at",
      ];
    } else if (type === "contacts") {
      rows = await prisma.contacts.findMany({
        where,
        select: {
          id: true,
          company_name: true,
          contact_name: true,
          designation: true,
          department: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
      });
      headers = [
        "id",
        "company_name",
        "contact_name",
        "designation",
        "department",
        "email",
        "phone",
        "city",
        "state",
        "created_at",
      ];
    } else if (type === "tasks") {
      rows = await prisma.tasks.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          status: true,
          due_date: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
      });
      headers = [
        "id",
        "title",
        "description",
        "priority",
        "status",
        "due_date",
        "created_at",
      ];
    } else if (type === "invoices") {
      rows = await prisma.invoices.findMany({
        where,
        select: {
          id: true,
          invoice_number: true,
          type: true,
          customer_name: true,
          invoice_date: true,
          due_date: true,
          total: true,
          status: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
      });
      headers = [
        "id",
        "invoice_number",
        "type",
        "customer_name",
        "invoice_date",
        "due_date",
        "total",
        "status",
        "created_at",
      ];
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
