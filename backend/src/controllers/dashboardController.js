const prisma = require("../config/prisma");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");

function formatYmd(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDmy(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseYmd(s) {
  const p = String(s).slice(0, 10);
  const [y, m, d] = p.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function sqlDateToYmd(v) {
  if (!v) return "";
  if (v instanceof Date) return formatYmd(v);
  return String(v).slice(0, 10);
}

/** Inclusive start / exclusive end for a local calendar day (YYYY-MM-DD). */
function dayRange(ymd) {
  const start = parseYmd(ymd);
  if (!start) {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { gte: s, lt: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1) };
  }
  return {
    gte: start,
    lt: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1),
  };
}

function emptyPanels() {
  return {
    open: {
      leads: 0,
      opportunities: 0,
      opportunities_value: 0,
      tickets: 0,
      contacts: 0,
      activities: 0,
      calls: 0,
      companies: 0,
      messages: 0,
    },
    periodic: {
      date: formatDmy(new Date()),
      leads: 0,
      opportunities: 0,
      opportunities_value: 0,
      tickets: 0,
      contacts: 0,
      activities: 0,
      calls: 0,
      companies: 0,
      messages: 0,
    },
    result: {
      date: formatDmy(new Date()),
      closed_tickets: 0,
      opportunities: {
        closed_won: 0,
        closed_won_value: 0,
        closed_lost: 0,
        closed_lost_value: 0,
        closed_won_today: 0,
        closed_won_value_today: 0,
        closed_lost_today: 0,
        closed_lost_value_today: 0,
      },
      leads: {
        converted: 0,
        recycled: 0,
        dead: 0,
      },
      completed_activities: 0,
    },
  };
}

function emptyTodaySummary() {
  return {
    leads_today: 0,
    leads_vs_yesterday_pct: 0,
    leads_converted_pct: 0,
    followups_today: 0,
    followups_completed: 0,
    tasks_today: 0,
    tasks_completed: 0,
    todos_today: 0,
    todos_completed: 0,
    _followupTotal: 0,
    _taskTotal: 0,
    _todoTotal: 0,
    _followupProgress: 100,
    _taskProgress: 100,
    _todoProgress: 100,
  };
}

async function safeCount(model, where, fallback = 0) {
  try {
    return Number(await prisma[model].count({ where })) || 0;
  } catch (err) {
    console.error(`dashboard safeCount(${model}) fallback:`, err.message);
    return fallback;
  }
}

/** When false, CRM user only sees own assigned/created rows (matches leads route). */
function restrictToOwn(req) {
  return !canSeeAllTeamRecords(req);
}

function leadScope(req) {
  if (!restrictToOwn(req)) return {};
  const uid = req.user.id;
  return { OR: [{ assigned_to: uid }, { created_by: uid }] };
}

function opportunityScope(req) {
  const where = { is_deleted: false };
  if (restrictToOwn(req)) {
    const uid = req.user.id;
    where.OR = [{ created_by: uid }, { owner_user_id: uid }];
  }
  return where;
}

function ticketScope(req) {
  const where = { is_deleted: false };
  if (restrictToOwn(req)) {
    const uid = req.user.id;
    where.OR = [{ created_by: uid }, { assigned_to: uid }];
  }
  return where;
}

function taskScope(req) {
  if (!restrictToOwn(req)) return {};
  const uid = req.user.id;
  return { OR: [{ assigned_to: uid }, { created_by: uid }] };
}

function reminderScope(req) {
  if (!restrictToOwn(req)) return {};
  const uid = req.user.id;
  return { OR: [{ user_id: uid }, { assigned_to_user_id: uid }] };
}

function contactScope(req) {
  if (!restrictToOwn(req)) return {};
  const uid = req.user.id;
  return { OR: [{ created_by: uid }, { assigned_to: uid }] };
}

function companyScope(req) {
  const where = { is_deleted: false };
  if (restrictToOwn(req)) {
    const uid = req.user.id;
    where.OR = [{ created_by: uid }, { assigned_to: uid }];
  }
  return where;
}

function todoVisibility(req) {
  if (!restrictToOwn(req)) return {};
  const uid = req.user.id;
  return {
    OR: [
      { created_by: uid },
      { crm_todo_assignees: { some: { user_id: uid } } },
    ],
  };
}

function andWhere(...parts) {
  const filtered = parts.filter((p) => p && Object.keys(p).length > 0);
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}

const INR_CURRENCY = {
  OR: [{ currency: null }, { currency: "INR" }, { currency: "inr" }],
};

/**
 * SUM of opportunity amounts in INR only (matches UPPER(COALESCE(currency,'INR')) = 'INR').
 * When useFinalAmount, uses COALESCE(final_amount, amount).
 */
async function sumOpportunityInr(where, { useFinalAmount = false } = {}) {
  try {
    const fullWhere = andWhere(where, INR_CURRENCY);
    if (!useFinalAmount) {
      const r = await prisma.opportunities.aggregate({
        where: fullWhere,
        _sum: { amount: true },
      });
      return Number(r._sum.amount) || 0;
    }
    const rows = await prisma.opportunities.findMany({
      where: fullWhere,
      select: { amount: true, final_amount: true },
    });
    return rows.reduce((sum, row) => sum + Number(row.final_amount ?? row.amount ?? 0), 0);
  } catch (err) {
    console.error("dashboard sumOpportunityInr fallback:", err.message);
    return 0;
  }
}

async function countMessagesPeriodic(req, todayYmd) {
  try {
    const range = dayRange(todayYmd);
    return await prisma.chat_thread_messages.count({
      where: {
        created_at: range,
        chat_threads: {
          chat_thread_members: {
            some: { user_id: req.user.id },
          },
        },
      },
    });
  } catch (err) {
    console.error("dashboard countMessagesPeriodic fallback:", err.message);
    return 0;
  }
}

async function countMessagesOpenUnread(req) {
  try {
    const members = await prisma.chat_thread_members.findMany({
      where: { user_id: req.user.id },
      select: { thread_id: true, last_read_message_id: true },
    });
    if (!members.length) return 0;
    return await prisma.chat_thread_messages.count({
      where: {
        OR: members.map((m) => ({
          thread_id: m.thread_id,
          id: { gt: m.last_read_message_id || 0 },
        })),
      },
    });
  } catch (err) {
    console.error("dashboard countMessagesOpenUnread fallback:", err.message);
    return 0;
  }
}

/**
 * Open / periodic / result panels — each metric is a separate query.
 */
async function loadDashboardPanels(req) {
  const todayYmd = formatYmd(new Date());
  const dateDmy = formatDmy(new Date());
  const today = dayRange(todayYmd);

  const ls = leadScope(req);
  const os = opportunityScope(req);
  const ts = ticketScope(req);
  const ks = taskScope(req);
  const rs = reminderScope(req);
  const cs = contactScope(req);
  const gs = companyScope(req);

  const openOppWhere = andWhere(os, {
    stage: { notIn: ["closed_won", "closed_lost"] },
  });
  const periodicOppWhere = andWhere(os, { created_at: today });
  const closedWonTodayWhere = andWhere(os, {
    stage: "closed_won",
    closed_won_at: today,
  });
  const closedLostTodayWhere = andWhere(os, {
    stage: "closed_lost",
    closed_lost_at: today,
  });
  const lifetimeWonWhere = andWhere(os, { stage: "closed_won" });
  const lifetimeLostWhere = andWhere(os, { stage: "closed_lost" });

  const taskDueOrCreatedToday = {
    OR: [
      { due_date: { gte: today.gte, lt: today.lt } },
      { AND: [{ due_date: null }, { created_at: today }] },
    ],
  };

  const ticketClosedToday = {
    OR: [
      { closed_at: today },
      { AND: [{ closed_at: null }, { updated_at: today }] },
    ],
  };

  const [
    openLeads,
    openOpportunities,
    openOppValue,
    openTickets,
    openContacts,
    openActivities,
    openCalls,
    openCompanies,
    openMessages,
    periodicLeads,
    periodicOpportunities,
    periodicOppValue,
    periodicTickets,
    periodicContacts,
    periodicActivities,
    periodicCalls,
    periodicCompanies,
    periodicMessages,
    resultClosedTickets,
    resultClosedWon,
    resultClosedWonValue,
    resultClosedLost,
    resultClosedLostValue,
    lifetimeClosedWon,
    lifetimeClosedWonValue,
    lifetimeClosedLost,
    lifetimeClosedLostValue,
    resultLeadsConverted,
    resultLeadsRecycled,
    resultLeadsDead,
    resultCompletedActivities,
  ] = await Promise.all([
    prisma.leads.count({
      where: andWhere(ls, { status: { notIn: ["confirm", "cancel"] } }),
    }),
    prisma.opportunities.count({ where: openOppWhere }),
    sumOpportunityInr(openOppWhere),
    prisma.tickets.count({
      where: andWhere(ts, { status: { notIn: ["resolved", "closed"] } }),
    }),
    prisma.contacts.count({ where: cs }),
    prisma.tasks.count({
      where: andWhere(ks, { status: { notIn: ["done", "completed"] } }),
    }),
    prisma.reminders.count({
      where: andWhere(rs, { is_done: false }),
    }),
    prisma.companies.count({ where: gs }),
    countMessagesOpenUnread(req),
    prisma.leads.count({
      where: andWhere(ls, { created_at: today }),
    }),
    prisma.opportunities.count({ where: periodicOppWhere }),
    sumOpportunityInr(periodicOppWhere),
    prisma.tickets.count({
      where: andWhere(ts, { created_at: today }),
    }),
    prisma.contacts.count({
      where: andWhere(cs, { created_at: today }),
    }),
    prisma.tasks.count({
      where: andWhere(ks, taskDueOrCreatedToday),
    }),
    prisma.reminders.count({
      where: andWhere(rs, { remind_at: today }),
    }),
    prisma.companies.count({
      where: andWhere(gs, { created_at: today }),
    }),
    countMessagesPeriodic(req, todayYmd),
    prisma.tickets.count({
      where: andWhere(ts, { status: { in: ["resolved", "closed"] } }, ticketClosedToday),
    }),
    prisma.opportunities.count({ where: closedWonTodayWhere }),
    sumOpportunityInr(closedWonTodayWhere, { useFinalAmount: true }),
    prisma.opportunities.count({ where: closedLostTodayWhere }),
    sumOpportunityInr(closedLostTodayWhere),
    prisma.opportunities.count({ where: lifetimeWonWhere }),
    sumOpportunityInr(lifetimeWonWhere, { useFinalAmount: true }),
    prisma.opportunities.count({ where: lifetimeLostWhere }),
    sumOpportunityInr(lifetimeLostWhere),
    prisma.leads.count({
      where: andWhere(ls, { status: "confirm", updated_at: today }),
    }),
    prisma.leads.count({
      where: andWhere(ls, { status: "processing", updated_at: today }),
    }),
    prisma.leads.count({
      where: andWhere(ls, { status: "cancel", updated_at: today }),
    }),
    prisma.tasks.count({
      where: andWhere(ks, {
        status: { in: ["done", "completed"] },
        updated_at: today,
      }),
    }),
  ]);

  const open = {
    leads: Number(openLeads) || 0,
    opportunities: Number(openOpportunities) || 0,
    opportunities_value: Number(openOppValue) || 0,
    tickets: Number(openTickets) || 0,
    contacts: Number(openContacts) || 0,
    activities: Number(openActivities) || 0,
    calls: Number(openCalls) || 0,
    companies: Number(openCompanies) || 0,
    messages: openMessages,
  };

  const periodic = {
    date: dateDmy,
    leads: Number(periodicLeads) || 0,
    opportunities: Number(periodicOpportunities) || 0,
    opportunities_value: Number(periodicOppValue) || 0,
    tickets: Number(periodicTickets) || 0,
    contacts: Number(periodicContacts) || 0,
    activities: Number(periodicActivities) || 0,
    calls: Number(periodicCalls) || 0,
    companies: Number(periodicCompanies) || 0,
    messages: periodicMessages,
  };

  const result = {
    date: dateDmy,
    closed_tickets: Number(resultClosedTickets) || 0,
    opportunities: {
      closed_won: Number(lifetimeClosedWon) || 0,
      closed_won_value: Number(lifetimeClosedWonValue) || 0,
      closed_lost: Number(lifetimeClosedLost) || 0,
      closed_lost_value: Number(lifetimeClosedLostValue) || 0,
      closed_won_today: Number(resultClosedWon) || 0,
      closed_won_value_today: Number(resultClosedWonValue) || 0,
      closed_lost_today: Number(resultClosedLost) || 0,
      closed_lost_value_today: Number(resultClosedLostValue) || 0,
    },
    leads: {
      converted: Number(resultLeadsConverted) || 0,
      recycled: Number(resultLeadsRecycled) || 0,
      dead: Number(resultLeadsDead) || 0,
    },
    completed_activities: Number(resultCompletedActivities) || 0,
  };

  return { open, periodic, result, todayYmd, dateDmy };
}

async function loadTodaySummary(req, todayYmd, yesterdayYmd) {
  const today = dayRange(todayYmd);
  const yesterday = dayRange(yesterdayYmd);
  const ls = leadScope(req);
  const rs = reminderScope(req);
  const ks = taskScope(req);
  const tv = todoVisibility(req);
  const todayDate = parseYmd(todayYmd);

  const taskDueOrCreatedToday = {
    OR: [
      { due_date: { gte: today.gte, lt: today.lt } },
      { AND: [{ due_date: null }, { created_at: today }] },
    ],
  };

  const todoDayClause = {
    OR: [
      { todo_date: todayDate },
      { AND: [{ todo_date: null }, { created_at: today }] },
      { updated_at: today },
    ],
  };

  const [
    nToday,
    nYest,
    completedLeads,
    followups_today,
    followups_completed,
    tasks_today,
    tasks_completed,
    todoBucketTotal,
    todos_completed,
    todos_today,
  ] = await Promise.all([
    prisma.leads.count({
      where: andWhere(ls, { created_at: today }),
    }),
    prisma.leads.count({
      where: andWhere(ls, { created_at: yesterday }),
    }),
    prisma.leads.count({
      where: andWhere(ls, {
        created_at: today,
        status: { in: ["close_by", "confirm"] },
      }),
    }),
    prisma.reminders.count({
      where: andWhere(rs, { remind_at: today }),
    }),
    prisma.reminders.count({
      where: andWhere(rs, { remind_at: today, is_done: true }),
    }),
    prisma.tasks.count({
      where: andWhere(ks, taskDueOrCreatedToday),
    }),
    prisma.tasks.count({
      where: andWhere(ks, { status: { in: ["done", "completed"] } }, taskDueOrCreatedToday),
    }),
    prisma.crm_todos.count({
      where: andWhere({ is_deleted: false }, tv, todoDayClause),
    }),
    prisma.crm_todos.count({
      where: andWhere(
        { is_deleted: false },
        tv,
        todoDayClause,
        { status: "completed" }
      ),
    }),
    prisma.crm_todos.count({
      where: andWhere(
        { is_deleted: false },
        tv,
        { status: "pending" },
        {
          OR: [
            { todo_date: todayDate },
            {
              AND: [
                { carry_forward: true },
                { todo_date: { lt: todayDate } },
              ],
            },
          ],
        }
      ),
    }),
  ]);

  const leads_vs_yesterday_pct =
    nYest === 0 ? (nToday > 0 ? 100 : 0) : Number((((nToday - nYest) / nYest) * 100).toFixed(2));
  const leads_converted_pct =
    nToday === 0 ? 100 : Number((((Number(completedLeads) || 0) / nToday) * 100).toFixed(2));

  return {
    leads_today: nToday,
    leads_vs_yesterday_pct,
    leads_converted_pct,
    followups_today,
    followups_completed,
    tasks_today,
    tasks_completed,
    todos_today,
    todos_completed,
    _followupTotal: followups_today,
    _taskTotal: tasks_today,
    _todoTotal: Number(todoBucketTotal) || 0,
    _followupProgress:
      followups_today === 0 ? 100 : Number(((followups_completed / followups_today) * 100).toFixed(2)),
    _taskProgress: tasks_today === 0 ? 100 : Number(((tasks_completed / tasks_today) * 100).toFixed(2)),
    _todoProgress:
      Number(todoBucketTotal) === 0
        ? 100
        : Number((((Number(todos_completed) || 0) / Number(todoBucketTotal)) * 100).toFixed(2)),
  };
}

async function getDashboardOpr(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { open, periodic, result, todayYmd } = await loadDashboardPanels(req);

    res.json({
      success: true,
      data: {
        date: todayYmd,
        sections: {
          open: {
            leads: open.leads,
            opportunities: open.opportunities,
            opportunities_value: open.opportunities_value,
            tickets: open.tickets,
            contacts: open.contacts,
            activities: open.activities,
            calls: open.calls,
            companies: open.companies,
            messages: open.messages,
          },
          periodic: {
            leads: periodic.leads,
            opportunities: periodic.opportunities,
            opportunities_value: periodic.opportunities_value,
            tickets: periodic.tickets,
            contacts: periodic.contacts,
            activities: periodic.activities,
            calls: periodic.calls,
            companies: periodic.companies,
            messages: periodic.messages,
          },
          result: {
            closed_tickets: result.closed_tickets,
            opportunities: {
              closed_won: result.opportunities.closed_won,
              closed_lost: result.opportunities.closed_lost,
              closed_won_value: result.opportunities.closed_won_value,
              closed_lost_value: result.opportunities.closed_lost_value,
              closed_won_today: result.opportunities.closed_won_today,
              closed_lost_today: result.opportunities.closed_lost_today,
              closed_won_value_today: result.opportunities.closed_won_value_today,
              closed_lost_value_today: result.opportunities.closed_lost_value_today,
            },
            leads: result.leads,
            completed_activities: result.completed_activities,
          },
        },
      },
    });
  } catch (err) {
    console.error("getDashboardOpr error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getDashboardStats(req, res) {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Proactively check for Fitness CRM notifications (expiries, dues)
    try {
      const { checkAndGenerateFitnessNotifications } = require("../services/fitnessNotificationService");
      await checkAndGenerateFitnessNotifications(uid);
    } catch (e) {
      console.warn("Failed to generate proactive fitness notifications:", e.message);
    }

    let panels;
    try {
      panels = await loadDashboardPanels(req);
    } catch (err) {
      console.error("getDashboardStats loadDashboardPanels fallback:", err.message);
      const fallback = emptyPanels();
      panels = {
        open: fallback.open,
        periodic: fallback.periodic,
        result: fallback.result,
        todayYmd: formatYmd(new Date()),
      };
    }
    const { open, periodic, result, todayYmd } = panels;
    const yPrev = new Date();
    yPrev.setDate(yPrev.getDate() - 1);
    const yesterdayYmd = formatYmd(yPrev);

    let today_summary_raw;
    try {
      today_summary_raw = await loadTodaySummary(req, todayYmd, yesterdayYmd);
    } catch (err) {
      console.error("getDashboardStats loadTodaySummary fallback:", err.message);
      today_summary_raw = emptyTodaySummary();
    }
    const today_summary = {
      leads_today: today_summary_raw.leads_today,
      leads_vs_yesterday_pct: today_summary_raw.leads_vs_yesterday_pct,
      followups_today: today_summary_raw.followups_today,
      followups_completed: today_summary_raw.followups_completed,
      tasks_today: today_summary_raw.tasks_today,
      tasks_completed: today_summary_raw.tasks_completed,
      todos_today: today_summary_raw.todos_today,
      todos_completed: today_summary_raw.todos_completed,
    };

    const ls = leadScope(req);
    const ks = taskScope(req);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [totalLeads, openTasks, closedThisMonth] = await Promise.all([
      safeCount("leads", ls, 0),
      safeCount("tasks", andWhere(ks, { status: { notIn: ["done", "completed"] } }), 0),
      safeCount(
        "leads",
        andWhere(ls, {
          status: { in: ["close_by", "confirm"] },
          created_at: { gte: monthStart, lt: nextMonth },
        }),
        0
      ),
    ]);

    res.json({
      success: true,
      data: {
        open,
        periodic,
        result,
        today_summary,
        leads_converted_pct: today_summary_raw.leads_converted_pct,
        todayLeads: today_summary.leads_today,
        leadGrowth: today_summary.leads_vs_yesterday_pct,
        leadProgress: today_summary_raw.leads_converted_pct,
        todayFollowups: today_summary.followups_today,
        followupCompleted: today_summary.followups_completed,
        followupTotal: today_summary_raw._followupTotal,
        followupProgress: today_summary_raw._followupProgress,
        todayTasks: today_summary.tasks_today,
        taskCompleted: today_summary.tasks_completed,
        taskTotal: today_summary_raw._taskTotal,
        taskProgress: today_summary_raw._taskProgress,
        todayTodos: today_summary.todos_today,
        todoCompleted: today_summary.todos_completed,
        todoTotal: today_summary_raw._todoTotal,
        todoProgress: today_summary_raw._todoProgress,
        totalLeads,
        openTasks,
        closedThisMonth,
        sections: {
          open,
          periodic,
          result,
        },
      },
    });
  } catch (err) {
    console.error("getDashboardStats error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Lead analytics for dashboard charts: status distribution + source trend in a date range.
 * Query: from, to (YYYY-MM-DD). Defaults to last 7 days including today.
 */
async function getDashboardInsights(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const todayLocal = formatYmd(new Date());
    const toStr = (req.query.to && String(req.query.to).slice(0, 10)) || todayLocal;
    let endD = parseYmd(toStr) || new Date();
    const fromRaw = req.query.from && String(req.query.from).slice(0, 10);
    let startD = fromRaw ? parseYmd(fromRaw) : new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 6);
    if (!startD) startD = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 6);
    if (startD > endD) {
      const t = startD;
      startD = endD;
      endD = t;
    }

    const from = formatYmd(startD);
    const to = formatYmd(endD);
    const rangeStart = parseYmd(from);
    const rangeEndExclusive = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() + 1);

    const baseWhere = andWhere(
      { is_deleted: false },
      leadScope(req),
      { created_at: { gte: rangeStart, lt: rangeEndExclusive } }
    );

    const statusGroups = await prisma.leads.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    });

    const byStatus = {
      new: 0,
      processing: 0,
      close_by: 0,
      confirm: 0,
      cancel: 0,
    };
    for (const row of statusGroups) {
      const k = String(row.status || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(byStatus, k)) {
        byStatus[k] = Number(row._count._all) || 0;
      }
    }

    const leadRows = await prisma.leads.findMany({
      where: baseWhere,
      select: { created_at: true, source: true },
    });

    const dayList = [];
    const cursor = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
    const endRange = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());
    while (cursor <= endRange) {
      dayList.push(formatYmd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const counts = new Map();
    const sourceSet = new Set();
    for (const row of leadRows) {
      if (!row.source) continue;
      const source = String(row.source);
      sourceSet.add(source);
      const d = sqlDateToYmd(row.created_at);
      const key = `${d}\0${source}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sources = [...sourceSet].sort();

    const bySourceByDay = dayList.map((date) => {
      const row = { date };
      for (const s of sources) {
        row[s] = counts.get(`${date}\0${s}`) || 0;
      }
      return row;
    });

    res.json({
      success: true,
      data: {
        dateRange: { from, to },
        byStatus,
        sources,
        bySourceByDay,
      },
    });
  } catch (err) {
    console.error("getDashboardInsights error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getDashboardStats, getDashboardInsights, getDashboardOpr };
