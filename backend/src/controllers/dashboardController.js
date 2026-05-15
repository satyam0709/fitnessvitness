const { pool } = require("../config/database");
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

async function safeSingleRow(query, params, fallback = {}) {
  try {
    const [[row]] = await pool.execute(query, params);
    return row || fallback;
  } catch (err) {
    console.error("dashboard safeSingleRow fallback:", err.message);
    return fallback;
  }
}

/** When false, CRM user only sees own assigned/created rows (matches leads route). */
function restrictToOwn(req) {
  return !canSeeAllTeamRecords(req);
}

function leadScopeSql(req, alias = "l") {
  const parts = ["1=1"];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.assigned_to = ? OR ${alias}.created_by = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function opportunityScopeSql(req, alias = "o") {
  const parts = [`${alias}.is_deleted = 0`];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.created_by = ? OR ${alias}.owner_user_id = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function ticketScopeSql(req, alias = "t") {
  const parts = [`${alias}.is_deleted = 0`];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function taskScopeSql(req, alias = "t") {
  const parts = ["1=1"];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.assigned_to = ? OR ${alias}.created_by = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function reminderScopeSql(req, alias = "r") {
  const parts = ["1=1"];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.user_id = ? OR ${alias}.assigned_to_user_id = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function contactScopeSql(req, alias = "c") {
  const parts = ["1=1"];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

function companyScopeSql(req, alias = "c") {
  const parts = [`${alias}.is_deleted = 0`];
  const params = [];
  if (restrictToOwn(req)) {
    parts.push(`(${alias}.created_by = ? OR ${alias}.assigned_to = ?)`);
    params.push(req.user.id, req.user.id);
  }
  return { where: parts.join(" AND "), params };
}

async function countMessagesPeriodic(req, todayYmd) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c
     FROM chat_thread_messages m
     INNER JOIN chat_thread_members mem ON mem.thread_id = m.thread_id AND mem.user_id = ?
     WHERE DATE(m.created_at) = ?`,
    [req.user.id, todayYmd]
  );
  return Number(row.c) || 0;
}

async function countMessagesOpenUnread(req) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c
     FROM chat_thread_messages m
     INNER JOIN chat_thread_members mem ON mem.thread_id = m.thread_id AND mem.user_id = ?
     WHERE m.id > COALESCE(mem.last_read_message_id, 0)`,
    [req.user.id]
  );
  return Number(row.c) || 0;
}

/**
 * Open / periodic / result panels — each metric is a separate query.
 */
async function loadDashboardPanels(req) {
  const todayYmd = formatYmd(new Date());
  const dateDmy = formatDmy(new Date());
  const ls = leadScopeSql(req, "l");
  const os = opportunityScopeSql(req, "o");
  const ts = ticketScopeSql(req, "t");
  const ks = taskScopeSql(req, "t");
  const rs = reminderScopeSql(req, "r");
  const cs = contactScopeSql(req, "c");
  const gs = companyScopeSql(req, "g");

  const [
    openLeadsRes,
    openOpportunitiesRes,
    openOppValueRes,
    openTicketsRes,
    openContactsRes,
    openActivitiesRes,
    openCallsRes,
    openCompaniesRes,
    openMessages,
    periodicLeadsRes,
    periodicOpportunitiesRes,
    periodicOppValueRes,
    periodicTicketsRes,
    periodicContactsRes,
    periodicActivitiesRes,
    periodicCallsRes,
    periodicCompaniesRes,
    periodicMessages,
    resultClosedTicketsRes,
    resultClosedWonRes,
    resultClosedWonValueRes,
    resultClosedLostRes,
    resultClosedLostValueRes,
    resultLeadsConvertedRes,
    resultLeadsRecycledRes,
    resultLeadsDeadRes,
    resultCompletedActivitiesRes,
  ] = await Promise.all([
    pool.execute(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${ls.where}
         AND l.status NOT IN ('confirm','cancel')`,
      ls.params
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM opportunities o
       WHERE ${os.where}
         AND o.stage NOT IN ('closed_won','closed_lost')`,
      os.params
    ),
    pool.execute(
      `SELECT COALESCE(SUM(
          CASE WHEN UPPER(COALESCE(o.currency,'INR')) = 'INR' THEN o.amount ELSE 0 END
        ), 0) AS s
       FROM opportunities o
       WHERE ${os.where}
         AND o.stage NOT IN ('closed_won','closed_lost')`,
      os.params
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tickets t
       WHERE ${ts.where}
         AND t.status NOT IN ('resolved','closed')`,
      ts.params
    ),
    pool.execute(`SELECT COUNT(*) AS c FROM contacts c WHERE ${cs.where}`, cs.params),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tasks t
       WHERE ${ks.where}
         AND t.status NOT IN ('done','completed')`,
      ks.params
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM reminders r
       WHERE ${rs.where}
         AND r.is_done = 0`,
      rs.params
    ),
    pool.execute(`SELECT COUNT(*) AS c FROM companies g WHERE ${gs.where}`, gs.params),
    countMessagesOpenUnread(req),
    pool.execute(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${ls.where} AND DATE(l.created_at) = ?`,
      [...ls.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM opportunities o
       WHERE ${os.where} AND DATE(o.created_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COALESCE(SUM(
          CASE WHEN UPPER(COALESCE(o.currency,'INR')) = 'INR' THEN o.amount ELSE 0 END
        ), 0) AS s
       FROM opportunities o
       WHERE ${os.where} AND DATE(o.created_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tickets t
       WHERE ${ts.where} AND DATE(t.created_at) = ?`,
      [...ts.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM contacts c
       WHERE ${cs.where} AND DATE(c.created_at) = ?`,
      [...cs.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tasks t
       WHERE ${ks.where} AND DATE(COALESCE(t.due_date, t.created_at)) = ?`,
      [...ks.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM reminders r
       WHERE ${rs.where} AND DATE(r.remind_at) = ?`,
      [...rs.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM companies g
       WHERE ${gs.where} AND DATE(g.created_at) = ?`,
      [...gs.params, todayYmd]
    ),
    countMessagesPeriodic(req, todayYmd),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tickets t
       WHERE ${ts.where}
         AND t.status IN ('resolved','closed')
         AND DATE(COALESCE(t.closed_at, t.updated_at)) = ?`,
      [...ts.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM opportunities o
       WHERE ${os.where}
         AND o.stage = 'closed_won'
         AND DATE(o.updated_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COALESCE(SUM(
          CASE WHEN UPPER(COALESCE(o.currency,'INR')) = 'INR' THEN o.amount ELSE 0 END
        ), 0) AS s
       FROM opportunities o
       WHERE ${os.where}
         AND o.stage = 'closed_won'
         AND DATE(o.updated_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM opportunities o
       WHERE ${os.where}
         AND o.stage = 'closed_lost'
         AND DATE(o.updated_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COALESCE(SUM(
          CASE WHEN UPPER(COALESCE(o.currency,'INR')) = 'INR' THEN o.amount ELSE 0 END
        ), 0) AS s
       FROM opportunities o
       WHERE ${os.where}
         AND o.stage = 'closed_lost'
         AND DATE(o.updated_at) = ?`,
      [...os.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${ls.where}
         AND l.status = 'confirm'
         AND DATE(l.updated_at) = ?`,
      [...ls.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${ls.where}
         AND l.status = 'processing'
         AND DATE(l.updated_at) = ?`,
      [...ls.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${ls.where}
         AND l.status = 'cancel'
         AND DATE(l.updated_at) = ?`,
      [...ls.params, todayYmd]
    ),
    pool.execute(
      `SELECT COUNT(*) AS c FROM tasks t
       WHERE ${ks.where}
         AND t.status IN ('done','completed')
         AND DATE(t.updated_at) = ?`,
      [...ks.params, todayYmd]
    ),
  ]);

  const [[openLeads]] = openLeadsRes;
  const [[openOpportunities]] = openOpportunitiesRes;
  const [[openOppValue]] = openOppValueRes;
  const [[openTickets]] = openTicketsRes;
  const [[openContacts]] = openContactsRes;
  const [[openActivities]] = openActivitiesRes;
  const [[openCalls]] = openCallsRes;
  const [[openCompanies]] = openCompaniesRes;
  const [[periodicLeads]] = periodicLeadsRes;
  const [[periodicOpportunities]] = periodicOpportunitiesRes;
  const [[periodicOppValue]] = periodicOppValueRes;
  const [[periodicTickets]] = periodicTicketsRes;
  const [[periodicContacts]] = periodicContactsRes;
  const [[periodicActivities]] = periodicActivitiesRes;
  const [[periodicCalls]] = periodicCallsRes;
  const [[periodicCompanies]] = periodicCompaniesRes;
  const [[resultClosedTickets]] = resultClosedTicketsRes;
  const [[resultClosedWon]] = resultClosedWonRes;
  const [[resultClosedWonValue]] = resultClosedWonValueRes;
  const [[resultClosedLost]] = resultClosedLostRes;
  const [[resultClosedLostValue]] = resultClosedLostValueRes;
  const [[resultLeadsConverted]] = resultLeadsConvertedRes;
  const [[resultLeadsRecycled]] = resultLeadsRecycledRes;
  const [[resultLeadsDead]] = resultLeadsDeadRes;
  const [[resultCompletedActivities]] = resultCompletedActivitiesRes;

  const open = {
    leads: Number(openLeads.c) || 0,
    opportunities: Number(openOpportunities.c) || 0,
    opportunities_value: Number(openOppValue.s) || 0,
    tickets: Number(openTickets.c) || 0,
    contacts: Number(openContacts.c) || 0,
    activities: Number(openActivities.c) || 0,
    calls: Number(openCalls.c) || 0,
    companies: Number(openCompanies.c) || 0,
    messages: openMessages,
  };

  const periodic = {
    date: dateDmy,
    leads: Number(periodicLeads.c) || 0,
    opportunities: Number(periodicOpportunities.c) || 0,
    opportunities_value: Number(periodicOppValue.s) || 0,
    tickets: Number(periodicTickets.c) || 0,
    contacts: Number(periodicContacts.c) || 0,
    activities: Number(periodicActivities.c) || 0,
    calls: Number(periodicCalls.c) || 0,
    companies: Number(periodicCompanies.c) || 0,
    messages: periodicMessages,
  };

  const result = {
    date: dateDmy,
    closed_tickets: Number(resultClosedTickets.c) || 0,
    opportunities: {
      closed_won: Number(resultClosedWon.c) || 0,
      closed_won_value: Number(resultClosedWonValue.s) || 0,
      closed_lost: Number(resultClosedLost.c) || 0,
      closed_lost_value: Number(resultClosedLostValue.s) || 0,
    },
    leads: {
      converted: Number(resultLeadsConverted.c) || 0,
      recycled: Number(resultLeadsRecycled.c) || 0,
      dead: Number(resultLeadsDead.c) || 0,
    },
    completed_activities: Number(resultCompletedActivities.c) || 0,
  };

  return { open, periodic, result, todayYmd, dateDmy };
}

async function loadTodaySummary(req, todayYmd, yesterdayYmd) {
  const uid = Number(req.user.id);
  const own = restrictToOwn(req);

  const leadOwn = own ? " AND (assigned_to = ? OR created_by = ?)" : "";
  const remOwn = own ? " AND (user_id = ? OR assigned_to_user_id = ?)" : "";
  const taskOwn = own ? " AND (assigned_to = ? OR created_by = ?)" : "";
  const todoVis = own
    ? "(t.created_by = ? OR EXISTS (SELECT 1 FROM crm_todo_assignees a WHERE a.todo_id = t.id AND a.user_id = ?))"
    : "1=1";
  const todoDayClause = "(DATE(t.todo_date) = ? OR (t.todo_date IS NULL AND DATE(t.created_at) = ?) OR DATE(t.updated_at) = ?)";

  const lpToday = own ? [todayYmd, uid, uid] : [todayYmd];
  const lpYest = own ? [yesterdayYmd, uid, uid] : [yesterdayYmd];

  const remParams = own ? [todayYmd, uid, uid] : [todayYmd];

  const taskParams = own ? [uid, uid, todayYmd, todayYmd] : [todayYmd, todayYmd];

  const todoParamsTotal = own
    ? [uid, uid, todayYmd, todayYmd, todayYmd]
    : [todayYmd, todayYmd, todayYmd];
  const todoPendingParams = own ? [uid, uid, todayYmd, todayYmd] : [todayYmd, todayYmd];

  const [
    todayLeadsRes,
    yesterdayLeadsRes,
    completedLeadsRes,
    todayFollowupsRes,
    followupCompletedRes,
    todayTasksRes,
    taskCompletedRes,
    todoBucketTotalRes,
    todoBucketDoneRes,
    todayTodosPendingRes,
  ] = await Promise.all([
    pool.execute(
      `SELECT COUNT(*) AS todayLeads FROM leads
       WHERE DATE(created_at) = ?${leadOwn}`,
      lpToday
    ),
    pool.execute(
      `SELECT COUNT(*) AS yesterdayLeads FROM leads
       WHERE DATE(created_at) = ?${leadOwn}`,
      lpYest
    ),
    pool.execute(
      `SELECT COUNT(*) AS completedLeads FROM leads
       WHERE DATE(created_at) = ?
         AND status IN ('close_by','confirm')${leadOwn}`,
      lpToday
    ),
    pool.execute(
      `SELECT COUNT(*) AS todayFollowups FROM reminders
       WHERE DATE(remind_at) = ?${remOwn}`,
      remParams
    ),
    pool.execute(
      `SELECT COUNT(*) AS followupCompleted FROM reminders
       WHERE DATE(remind_at) = ? AND is_done = 1${remOwn}`,
      remParams
    ),
    pool.execute(
      `SELECT COUNT(*) AS todayTasks FROM tasks
       WHERE 1=1
         ${taskOwn}
         AND (
           (due_date IS NOT NULL AND DATE(due_date) = ?)
           OR (due_date IS NULL AND DATE(created_at) = ?)
         )`,
      taskParams
    ),
    pool.execute(
      `SELECT COUNT(*) AS taskCompleted FROM tasks
       WHERE 1=1
         ${taskOwn}
         AND status IN ('done','completed')
         AND (
           (due_date IS NOT NULL AND DATE(due_date) = ?)
           OR (due_date IS NULL AND DATE(created_at) = ?)
         )`,
      taskParams
    ),
    pool.execute(
      `SELECT COUNT(*) AS todoBucketTotal FROM crm_todos t
       WHERE t.is_deleted = 0 AND ${todoVis} AND ${todoDayClause}`,
      todoParamsTotal
    ),
    pool.execute(
      `SELECT COUNT(*) AS todoBucketDone FROM crm_todos t
       WHERE t.is_deleted = 0 AND ${todoVis} AND ${todoDayClause} AND t.status = 'completed'`,
      todoParamsTotal
    ),
    pool.execute(
      `SELECT COUNT(*) AS todayTodosPending FROM crm_todos t
       WHERE t.is_deleted = 0 AND ${todoVis}
         AND t.status = 'pending'
         AND (DATE(t.todo_date) = ? OR (t.carry_forward = 1 AND DATE(t.todo_date) < ?))`,
      todoPendingParams
    ),
  ]);

  const [[{ todayLeads }]] = todayLeadsRes;
  const [[{ yesterdayLeads }]] = yesterdayLeadsRes;
  const [[{ completedLeads }]] = completedLeadsRes;
  const [[{ todayFollowups }]] = todayFollowupsRes;
  const [[{ followupCompleted }]] = followupCompletedRes;
  const [[{ todayTasks }]] = todayTasksRes;
  const [[{ taskCompleted }]] = taskCompletedRes;
  const [[{ todoBucketTotal }]] = todoBucketTotalRes;
  const [[{ todoBucketDone }]] = todoBucketDoneRes;
  const [[{ todayTodosPending }]] = todayTodosPendingRes;
  const nToday = Number(todayLeads) || 0;
  const nYest = Number(yesterdayLeads) || 0;
  const leads_vs_yesterday_pct =
    nYest === 0 ? (nToday > 0 ? 100 : 0) : Number((((nToday - nYest) / nYest) * 100).toFixed(2));
  const leads_converted_pct =
    nToday === 0 ? 100 : Number((((Number(completedLeads) || 0) / nToday) * 100).toFixed(2));

  const followups_today = Number(todayFollowups) || 0;
  const followups_completed = Number(followupCompleted) || 0;
  const tasks_today = Number(todayTasks) || 0;
  const tasks_completed = Number(taskCompleted) || 0;
  const todos_today = Number(todayTodosPending) || 0;
  const todos_completed = Number(todoBucketDone) || 0;

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
        : Number((((Number(todoBucketDone) || 0) / Number(todoBucketTotal)) * 100).toFixed(2)),
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

    const ls = leadScopeSql(req, "l");
    const totalLeadsScoped = await safeSingleRow(
      `SELECT COUNT(*) AS totalLeads FROM leads l WHERE ${ls.where}`,
      ls.params,
      { totalLeads: 0 }
    );
    const ks = taskScopeSql(req, "t");
    const openTasksScoped = await safeSingleRow(
      `SELECT COUNT(*) AS openTasks FROM tasks t
       WHERE ${ks.where} AND t.status NOT IN ('done','completed')`,
      ks.params,
      { openTasks: 0 }
    );
    const closedThisMonth = await safeSingleRow(
      `SELECT COUNT(*) AS closedThisMonth FROM leads l
       WHERE ${ls.where}
         AND l.status IN ('close_by','confirm')
         AND YEAR(l.created_at) = YEAR(CURDATE())
         AND MONTH(l.created_at) = MONTH(CURDATE())`,
      ls.params,
      { closedThisMonth: 0 }
    );

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
        totalLeads: Number(totalLeadsScoped.totalLeads) || 0,
        openTasks: Number(openTasksScoped.openTasks) || 0,
        closedThisMonth: Number(closedThisMonth.closedThisMonth) || 0,
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
    const userIntId = req.user.id;

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

    const own = restrictToOwn(req);
    const vis = own ? " AND (created_by = ? OR assigned_to = ?)" : "";

    const [statusRows] = await pool.execute(
      `SELECT status, COUNT(*) AS c
       FROM leads
       WHERE is_deleted = 0${vis}
         AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY status`,
      own ? [userIntId, userIntId, from, to] : [from, to]
    );

    const byStatus = {
      new: 0,
      processing: 0,
      close_by: 0,
      confirm: 0,
      cancel: 0,
    };
    for (const row of statusRows) {
      const k = String(row.status || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(byStatus, k)) {
        byStatus[k] = Number(row.c);
      }
    }

    const [dailyRows] = await pool.execute(
      `SELECT DATE(created_at) AS d, source, COUNT(*) AS c
       FROM leads
       WHERE is_deleted = 0${vis}
         AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY DATE(created_at), source
       ORDER BY d ASC`,
      own ? [userIntId, userIntId, from, to] : [from, to]
    );

    const dayList = [];
    const cursor = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
    const endRange = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());
    while (cursor <= endRange) {
      dayList.push(formatYmd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const sourceSet = new Set();
    for (const row of dailyRows) {
      if (row.source) sourceSet.add(String(row.source));
    }
    const sources = [...sourceSet].sort();

    const bySourceByDay = dayList.map((date) => {
      const row = { date };
      for (const s of sources) {
        row[s] = 0;
      }
      return row;
    });

    const idxByDate = Object.fromEntries(dayList.map((d, i) => [d, i]));
    for (const row of dailyRows) {
      const d = sqlDateToYmd(row.d);
      const i = idxByDate[d];
      if (i === undefined || !row.source) continue;
      const key = String(row.source);
      if (bySourceByDay[i][key] !== undefined) {
        bySourceByDay[i][key] = Number(row.c);
      }
    }

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
