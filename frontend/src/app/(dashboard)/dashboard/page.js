"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useUser, useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, connectGlobalSocket } from "@/lib/api";
import { useTodayFeed } from "@/lib/useTodayFeed";
import { getDashboardStats, getAllClients, importClientsExcel, exportClientsExcel, getTransactionSummaryYearly, getFitnessTransactionCharts } from "@/lib/fitnessApi";
import { LeadStatusDonut, LeadSourceArea, ChartCardMenu } from "@/components/Dashboard/DashboardCharts";
import { FitnessTransactionPies } from "@/components/FitnessTransactionPies/FitnessTransactionPies";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { taskStatusForDb } from "@/lib/taskStatus";
import { useTenantFeatures } from "@/contexts/TenantFeaturesContext";
import styles from "./dashboard.module.css";

function normLeadStatus(lead) {
  return String(lead?.status || "").toLowerCase();
}

function sameCalendarDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isTaskToday(t) {
  const today = new Date();
  if (t.due_date) return sameCalendarDay(t.due_date, today);
  return sameCalendarDay(t.created_at, today);
}

function isTaskTomorrow(t) {
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  if (t.due_date) return sameCalendarDay(t.due_date, tom);
  return false;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAhead(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Always show rupee amount (matches dashboard reference, incl. ₹ 0). */
function fmtInrPill(n) {
  const v = Math.round(Number(n) || 0);
  return `₹ ${v.toLocaleString("en-IN")}`;
}

function TodayOverviewWidget({ summary }) {
  const by = summary?.by_type || {};
  const rows = [
    { icon: "📞", label: "Lead Follow-ups", key: "lead_followup" },
    { icon: "🤝", label: "Meetings", key: "meeting" },
    { icon: "🔔", label: "Reminders", key: "reminder" },
    { icon: "⚖️", label: "Client Check-ins", key: "client_followup" },
    { icon: "✅", label: "Todos", key: "todo" },
    { icon: "📋", label: "CRM Tasks", key: "task" },
    { icon: "📅", label: "Calendar Events", key: "calendar_event" },
    { icon: "🎯", label: "Prospect follow-ups", key: "opportunity_followup" },
  ];
  if (Number(by.google_event ?? 0) > 0) {
    rows.push({ icon: "🌐", label: "Google Calendar", key: "google_event" });
  }
  const total = Number(summary?.total ?? 0);
  const allClear = total === 0;

  return (
    <div className={styles.todayWidget}>
      <div className={styles.todayWidgetHead}>
        <h2 className={styles.todayWidgetTitle}>Today&apos;s Tasks</h2>
        <Link href="/today" className={styles.todayWidgetLink}>
          Open Command Center →
        </Link>
      </div>
      {allClear ? (
        <p className={styles.todayWidgetClear}>✅ All clear for today!</p>
      ) : (
        <>
          <ul className={styles.todayWidgetList}>
            {rows.map((r) => (
              <li key={r.key} className={styles.todayWidgetRow}>
                <span>{r.icon}</span>
                <span>{r.label}</span>
                <span className={styles.todayWidgetCount}>{by[r.key] ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className={styles.todayWidgetFooter}>
            {total} task{total === 1 ? "" : "s"} need attention today
          </p>
        </>
      )}
    </div>
  );
}

function DashboardOprMiniCard({ href, label, value, loading, inrPill, valueClassName }) {
  return (
    <Link href={href} className={styles.oprMiniCard}>
      {inrPill != null ? <span className={styles.oprMiniCardPill}>{inrPill}</span> : null}
      <span className={styles.oprMiniCardLabel}>{label}</span>
      <span className={`${styles.oprMiniCardValue} ${valueClassName || ""}`.trim()}>
        {loading ? (
          <span className={styles.skeleton} style={{ display: "inline-block", width: 44, height: 28 }} />
        ) : (
          value
        )}
      </span>
    </Link>
  );
}

function DashboardOprPairBlock({ left, right, loading }) {
  return (
    <div className={`${styles.oprResultOppBlock} ${styles.oprPairBlock}`}>
      <div className={styles.oprResultOppCols}>
        <Link href={left.href} className={`${styles.oprResultOppCol} ${styles.oprPairCol}`}>
          {left.inrPill != null ? (
            <span className={`${styles.oprResultOppMoney} ${styles.oprResultOppMoneyWon}`}>
              {loading ? (
                <span className={styles.skeleton} style={{ display: "inline-block", width: 52, height: 16 }} />
              ) : (
                left.inrPill
              )}
            </span>
          ) : null}
          <span className={styles.oprResultOppColLabel}>{left.label}</span>
          <div className={styles.oprResultOppColValue}>
            {loading ? (
              <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 24 }} />
            ) : (
              left.value
            )}
          </div>
        </Link>
        <Link href={right.href} className={`${styles.oprResultOppCol} ${styles.oprPairCol}`}>
          {right.inrPill != null ? (
            <span className={`${styles.oprResultOppMoney} ${styles.oprResultOppMoneyWon}`}>
              {loading ? (
                <span className={styles.skeleton} style={{ display: "inline-block", width: 52, height: 16 }} />
              ) : (
                right.inrPill
              )}
            </span>
          ) : null}
          <span className={styles.oprResultOppColLabel}>{right.label}</span>
          <div className={styles.oprResultOppColValue}>
            {loading ? (
              <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 24 }} />
            ) : (
              right.value
            )}
          </div>
        </Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const { confirm } = useConfirmDialog();
  const { isSignedIn } = useAuth();
  const { refreshNonce: roleRefreshNonce } = useUserRole();
  const adminRefreshNonce = 0;
  const { featureMap, isLoading: featuresLoading } = useTenantFeatures();
  const isPlatformAdmin =
    Number(user?.is_platform_admin) === 1 || Number(user?.isPlatformAdmin) === 1;
  const [stats, setStats] = useState(null);
  const [fitnessStats, setFitnessStats] = useState(null);
  const [fitnessTxCharts, setFitnessTxCharts] = useState(null);
  const [fitnessLoading, setFitnessLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const [leads, setLeads] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [todos, setTodos] = useState([]);
  const [notes, setNotes] = useState([]);
  const [insights, setInsights] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [dashboardError, setDashboardError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [activeLeadTab, setActiveLeadTab] = useState("new");
  const [activeSchedTab, setActiveSchedTab] = useState("reminder");
  const [taskTab, setTaskTab] = useState("today");
  const [todoPriTab, setTodoPriTab] = useState("high");
  const [noteModal, setNoteModal] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const quietRefreshTimerRef = useRef(null);
  const quietRefreshInFlightRef = useRef(false);

  const firstName = user?.firstName || "User";
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.emailAddresses?.[0]?.emailAddress || "User";

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const hasLeadFeature = Boolean(featureMap?.lead_management || featureMap?.leads);
  const hasTaskFeature = Boolean(featureMap?.task_management || featureMap?.tasks);

  const { summary: todayFeedSummary, refreshQuiet: refreshTodaySummary } = useTodayFeed({
    enabled: isLoaded && isSignedIn === true && !isPlatformAdmin,
  });

  const fetchStats = useCallback(
    async (opts = {}) => {
      if (!isSignedIn) return;
      const quiet = opts.quiet === true;
      if (!quiet) {
        setStatsLoading(true);
        setStatsError(null);
      }
      try {
        const statsRes = await apiFetch("/dashboard/stats");
        if (!statsRes.ok) {
          const errBody = await statsRes.json().catch(() => ({}));
          setStatsError(errBody.message || `Could not load stats (${statsRes.status})`);
          return;
        }
        const d = await statsRes.json();
        setStats(d.data || d);
        setStatsError(null);
      } catch (e) {
        setStatsError(e.message || "Network error");
      } finally {
        if (!quiet) setStatsLoading(false);
      }
    },
    [isSignedIn]
  );

  const fetchDashboard = useCallback(async (opts = {}) => {
    if (!isSignedIn) return;
    if (featuresLoading) return;
    const quiet = opts.quiet === true;
    if (!quiet) setLoading(true);
    setDashboardError(null);
    try {
      const requests = [];
      if (hasLeadFeature) {
        requests.push(["leads", apiFetch("/leads")]);
        requests.push(["insights", apiFetch("/dashboard/insights")]);
        requests.push(["notes", apiFetch("/v2/notes")]);
      }
      if (hasTaskFeature) {
        requests.push(["reminders", apiFetch("/reminders?limit=50")]);
        requests.push(["meetings", apiFetch("/meetings?limit=100")]);
        requests.push(["tasks", apiFetch("/tasks?my=true")]);
        requests.push(["todos", apiFetch("/todos?scope=today&status=pending")]);
      }
      const settled = await Promise.allSettled(requests.map(([, p]) => p));
      const byKey = Object.fromEntries(requests.map(([k], i) => [k, settled[i]]));

      if (!hasLeadFeature) {
        setLeads([]);
        setInsights(null);
        setNotes([]);
      }
      if (!hasTaskFeature) {
        setReminders([]);
        setMeetings([]);
        setTasks([]);
        setTodos([]);
      }

      if (byKey.leads?.status === "fulfilled" && byKey.leads.value.ok) {
        const d = await byKey.leads.value.json();
        setLeads(d.leads || d.data || []);
      }
      if (byKey.reminders?.status === "fulfilled" && byKey.reminders.value.ok) {
        const d = await byKey.reminders.value.json();
        setReminders(d.reminders || d.data || []);
      }
      if (byKey.meetings?.status === "fulfilled" && byKey.meetings.value.ok) {
        const d = await byKey.meetings.value.json();
        setMeetings(d.meetings || d.data || []);
      }
      if (byKey.tasks?.status === "fulfilled" && byKey.tasks.value.ok) {
        const d = await byKey.tasks.value.json();
        setTasks(d.data || []);
      }
      if (byKey.todos?.status === "fulfilled" && byKey.todos.value.ok) {
        const d = await byKey.todos.value.json();
        setTodos(d.data || []);
      }
      if (byKey.insights?.status === "fulfilled" && byKey.insights.value.ok) {
        const d = await byKey.insights.value.json();
        setInsights(d.data || null);
      }
      if (byKey.notes?.status === "fulfilled" && byKey.notes.value.ok) {
        const d = await byKey.notes.value.json();
        setNotes(d.notes || d.data || []);
      }
    } catch (e) {
      console.error("Dashboard fetch error:", e);
      setDashboardError(e?.message || "Could not load dashboard data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [featuresLoading, hasLeadFeature, hasTaskFeature, isSignedIn]);

  const queueQuietDashboardRefresh = useCallback(() => {
    if (quietRefreshTimerRef.current) clearTimeout(quietRefreshTimerRef.current);
    quietRefreshTimerRef.current = setTimeout(async () => {
      if (quietRefreshInFlightRef.current) return;
      quietRefreshInFlightRef.current = true;
      try {
        await fetchDashboard({ quiet: true });
      } finally {
        quietRefreshInFlightRef.current = false;
      }
    }, 250);
  }, [fetchDashboard]);

  useEffect(
    () => () => {
      if (quietRefreshTimerRef.current) clearTimeout(quietRefreshTimerRef.current);
    },
    []
  );

  // Single init: run once when auth + features are both ready.
  // Use a ref so identity changes on fetchDashboard (from hasLeadFeature/hasTaskFeature
  // settling) don't trigger additional fetches after the first one completes.
  const initDoneRef = useRef(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (isPlatformAdmin) router.replace("/dashboard");
  }, [isLoaded, isPlatformAdmin, router]);

  useEffect(() => {
    if (!isLoaded || featuresLoading) return;
    if (isPlatformAdmin) return;
    // Wait until we know the auth state (not null, which means still loading)
    if (isSignedIn !== true && isSignedIn !== false) return;
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    if (isSignedIn) {
      const fetchSchedule = async () => {
        try {
          setScheduleLoading(true);
          const today = new Date();
          const from = today.toISOString().slice(0, 10);
          const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const res = await apiFetch(`/calendar/feed?from=${from}&to=${to}`);
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.success) {
            setSchedule(Array.isArray(json.items) ? json.items : []);
          }
        } catch {
          /* ignore */
        } finally {
          setScheduleLoading(false);
        }
      };
      
      void fetchDashboard();
      void fetchStats();
      void fetchSchedule();
      loadFitnessStats();
    }
  }, [isLoaded, isSignedIn, featuresLoading, isPlatformAdmin, fetchDashboard, fetchStats]);

  // Fetch fitness CRM stats
  const loadFitnessStats = useCallback(async () => {
    setFitnessLoading(true);
    try {
      const y = new Date().getFullYear();
      const mo = new Date().getMonth() + 1;
      const da = new Date().getDate();
      const pad = (n) => String(n).padStart(2, "0");
      const date_from = `${y}-${pad(mo)}-01`;
      const date_to = `${y}-${pad(mo)}-${pad(da)}`;

      const [stats, financial, charts] = await Promise.all([
        getDashboardStats(),
        getTransactionSummaryYearly(),
        getFitnessTransactionCharts({ date_from, date_to }).catch(() => null),
      ]);
      setFitnessStats({
        ...stats,
        monthly_revenue: financial.totals.received,
        monthly_profit: financial.totals.profit,
        total_pending: financial.totals.pending
      });
      setFitnessTxCharts(charts);
    } catch (e) {
      console.error("Fitness stats error:", e);
      setFitnessStats(null);
      setFitnessTxCharts(null);
    } finally {
      setFitnessLoading(false);
    }
  }, []);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setImporting(true);
    try {
      const res = await importClientsExcel(formData);
      let msg = `Import complete: ${res.importedCount} clients imported.`;
      if (res.errors && res.errors.length > 0) {
        msg += `\n\nErrors encountered:\n` + res.errors.join('\n');
      }
      alert(msg);
      loadFitnessStats();
    } catch (err) {
      console.error("Import error:", err);
      alert(err.message || "Failed to import clients");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    try {
      await exportClientsExcel();
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export clients");
    }
  };

  useEffect(() => {
    if (isSignedIn && !isPlatformAdmin) loadFitnessStats();
  }, [isSignedIn, isPlatformAdmin, loadFitnessStats]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    if (isPlatformAdmin) return undefined;
    const t = setInterval(() => {
      fetchStats({ quiet: true });
    }, 30000);
    return () => clearInterval(t);
  // fetchStats is stable (depends only on isSignedIn primitive), so this is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, isPlatformAdmin]);

  // Only re-fetch stats when nonces actually change, not on initial mount.
  const nonceMountedRef = useRef(false);
  useEffect(() => {
    if (!nonceMountedRef.current) {
      nonceMountedRef.current = true;
      return;
    }
    if (!isLoaded) return;
    if (isPlatformAdmin) return;
    fetchStats({ quiet: true });
  }, [isLoaded, isPlatformAdmin, adminRefreshNonce, roleRefreshNonce, fetchStats]);

  useEffect(() => {
    if (isPlatformAdmin) return undefined;
    function onTodosChanged() {
      queueQuietDashboardRefresh();
    }
    window.addEventListener("crm-todos-changed", onTodosChanged);
    return () => window.removeEventListener("crm-todos-changed", onTodosChanged);
  }, [isPlatformAdmin, queueQuietDashboardRefresh]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    if (isPlatformAdmin) return undefined;
    let cancelled = false;
    let cleanupFn;

    async function initSocket() {
      const s = await connectGlobalSocket(true);
      if (cancelled || !s) return;

      const onRefresh = () => {
        if (cancelled) return;
        queueQuietDashboardRefresh();
        refreshTodaySummary();
      };
      const onFitness = () => {
        if (!cancelled) {
          loadFitnessStats();
          refreshTodaySummary();
        }
      };

      s.on("todos:changed", onRefresh);
      s.on("meetings:changed", onRefresh);
      s.on("calendar:changed", onRefresh);
      s.on("tasks:changed", onRefresh);
      s.on("crm-tasks-changed", onRefresh);
      s.on("reminders:changed", onRefresh);
      s.on("leads:changed", onRefresh);
      s.on("workspace:access", onRefresh);
      s.on("opportunities:changed", onRefresh);
      s.on("fitness:changed", onFitness);

      return () => {
        s.off("todos:changed", onRefresh);
        s.off("meetings:changed", onRefresh);
        s.off("calendar:changed", onRefresh);
        s.off("tasks:changed", onRefresh);
        s.off("crm-tasks-changed", onRefresh);
        s.off("reminders:changed", onRefresh);
        s.off("leads:changed", onRefresh);
        s.off("workspace:access", onRefresh);
        s.off("opportunities:changed", onRefresh);
        s.off("fitness:changed", onFitness);
      };
    }

    initSocket().then((fn) => {
      cleanupFn = fn;
    });

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
  }, [isLoaded, isSignedIn, isPlatformAdmin, queueQuietDashboardRefresh, refreshTodaySummary, loadFitnessStats]);

  const filteredLeads = useMemo(
    () => leads.filter((l) => normLeadStatus(l) === activeLeadTab),
    [leads, activeLeadTab]
  );

  const todayMeetings = useMemo(
    () => meetings.filter((m) => sameCalendarDay(m.start_time, new Date())),
    [meetings]
  );

  const eventMeetings = useMemo(() => {
    const limit = daysAhead(30);
    return meetings.filter((m) => {
      const t = new Date(m.start_time);
      return t > endOfToday() && t <= limit;
    });
  }, [meetings]);

  const tasksToday = useMemo(() => tasks.filter(isTaskToday), [tasks]);
  const tasksTomorrow = useMemo(() => tasks.filter(isTaskTomorrow), [tasks]);
  const visibleTasks = taskTab === "today" ? tasksToday : tasksTomorrow;

  const todosByPri = useMemo(() => {
    const p = String(todoPriTab).toLowerCase();
    return todos.filter((t) => String(t.priority || "").toLowerCase() === p);
  }, [todos, todoPriTab]);

  const ts = stats?.today_summary;
  const statCards = [
    {
      label: "Today's Leads",
      value: ts?.leads_today ?? stats?.todayLeads ?? 0,
      sub: `${Number(ts?.leads_vs_yesterday_pct ?? stats?.leadGrowth ?? 0).toFixed(2)}% increase`,
      subNote: "vs Yesterday",
      progress: Number(stats?.leads_converted_pct ?? stats?.leadProgress ?? 0),
      progressLabel: "Converted Lead",
      color: "#22c55e",
      icon: "fa-filter",
    },
    {
      label: "Today's Followups",
      value: ts?.followups_today ?? stats?.todayFollowups ?? 0,
      sub: `${ts?.followups_completed ?? stats?.followupCompleted ?? 0} Completed`,
      subNote:
        stats?.followupTotal != null ? `of ${stats.followupTotal} due today` : "",
      progress: Number(stats?.followupProgress ?? 0),
      progressLabel: "Completed Followup",
      color: "#ef4444",
      icon: "fa-share",
    },
    {
      label: "Active Clients",
      value: fitnessStats?.active_clients ?? 0,
      sub: `${fitnessStats?.expiring_soon ?? 0} Expiring Soon`,
      subNote: fitnessStats?.need_attention ? `${fitnessStats.need_attention} Need Attention` : "",
      progress: fitnessStats?.active_clients > 0 ? ((fitnessStats.active_clients - fitnessStats.need_attention) / fitnessStats.active_clients) * 100 : 100,
      progressLabel: "Client Health",
      color: "#10b981",
      icon: "fa-users",
    },
    {
      label: "Consultations",
      value: fitnessStats?.monthly_consultations ?? 0,
      sub: "This Month",
      subNote: "Goal: 20",
      progress: Math.min(100, ((fitnessStats?.monthly_consultations ?? 0) / 20) * 100),
      progressLabel: "Monthly Goal",
      color: "#8b5cf6",
      icon: "fa-stethoscope",
    },
    {
      label: "Today's Activities",
      value: stats?.open?.activities ?? 0,
      sub: `${stats?.open?.calls ?? 0} Pending Calls`,
      progress: Number(stats?.result?.tasks?.completion_rate ?? 0),
      progressLabel: "Activity Progress",
      color: "#f97316",
      icon: "fa-list-check",
    },
    {
      label: "Today's Todos",
      value: ts?.todos_today ?? stats?.todayTodos ?? 0,
      sub: `${ts?.todos_completed ?? stats?.todoCompleted ?? 0} Completed`,
      subNote: stats?.todoTotal != null ? `of ${stats.todoTotal} in today's bucket` : "",
      progress: Number(stats?.todoProgress ?? 0),
      progressLabel: "Completed Todo",
      color: "#0ea5e9",
      icon: "fa-clipboard-list",
    },
  ];

  const opportunityResultPanel = useMemo(() => {
    const o = stats?.result?.opportunities;
    const won = Number(o?.closed_won) || 0;
    const lost = Number(o?.closed_lost) || 0;
    const wonVal = Number(o?.closed_won_value) || 0;
    const lostVal = Number(o?.closed_lost_value) || 0;
    return {
      won,
      lost,
      wonVal,
      lostVal,
      totalClosed: won + lost,
      totalInr: wonVal + lostVal,
    };
  }, [stats]);

  const leadResultTotal = useMemo(() => {
    const L = stats?.result?.leads;
    return (
      (Number(L?.converted) || 0) + (Number(L?.recycled) || 0) + (Number(L?.dead) || 0)
    );
  }, [stats]);

  const insightRange = insights?.dateRange;
  const rangeLabel =
    insightRange &&
    `From ${insightRange.from?.split("-").reverse().join("-")} to ${insightRange.to?.split("-").reverse().join("-")}`;

  const openCards = [
    { href: "/leads?status=processing", label: "Leads", value: stats?.open?.leads ?? 0 },
    {
      href: "/opportunities?view=pipeline",
      label: "Opportunities",
      value: stats?.open?.opportunities ?? 0,
      inrPill: fmtInrPill(stats?.open?.opportunities_value),
    },
    { href: "/tickets?status=open", label: "Tickets", value: stats?.open?.tickets ?? 0 },
    { href: "/contacts", label: "Contacts", value: stats?.open?.contacts ?? 0 },
    { href: "/tasks?status=processing", label: "Activities", value: stats?.open?.activities ?? 0 },
    { href: "/reminders", label: "Today's Calls", value: stats?.open?.calls ?? 0 },
    { href: "/companies", label: "Companies", value: stats?.open?.companies ?? 0 },
    { href: "/notifications", label: "Messages", value: stats?.open?.messages ?? 0 },
  ];

  const periodicCards = [
    { href: "/leads", label: "Leads", value: stats?.periodic?.leads ?? 0 },
    {
      href: "/opportunities?view=all",
      label: "Opportunities",
      value: stats?.periodic?.opportunities ?? 0,
      inrPill: fmtInrPill(stats?.periodic?.opportunities_value),
    },
    { href: "/tickets", label: "Tickets", value: stats?.periodic?.tickets ?? 0 },
    { href: "/contacts", label: "Contacts", value: stats?.periodic?.contacts ?? 0 },
    { href: "/tasks", label: "Activities", value: stats?.periodic?.activities ?? 0 },
    { href: "/reminders", label: "Calls", value: stats?.periodic?.calls ?? 0 },
    { href: "/companies", label: "Companies", value: stats?.periodic?.companies ?? 0 },
    { href: "/notifications", label: "Messages", value: stats?.periodic?.messages ?? 0 },
  ];

  async function toggleTodoDone(todo) {
    const done = todo.status === "completed";
    const next = done ? "pending" : "completed";
    try {
      const res = await apiFetch(`/todos/${todo.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setActionError("Could not update todo");
        return;
      }
      setActionError(null);
      await fetchDashboard();
      await fetchStats({ quiet: true });
    } catch {
      setActionError("Could not update todo");
    }
  }

  async function toggleTaskDone(task) {
    const done = task.status === "done" || task.status === "completed";
    const next = done ? "new" : "completed";
    try {
      const res = await apiFetch(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: taskStatusForDb(next) }),
      });
      if (!res.ok) {
        setActionError("Could not update task");
        return;
      }
      setActionError(null);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: next } : t))
      );
      await fetchStats({ quiet: true });
    } catch {
      setActionError("Could not update task");
    }
  }

  async function deleteNote(n) {
    const msg = buildDeleteMessage({
      singular: "note",
      name: n.title?.trim() || null,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/v2/notes/${n.id}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError("Could not delete note");
        return;
      }
      setActionError(null);
      setNotes((prev) => prev.filter((x) => x.id !== n.id));
    } catch {
      setActionError("Could not delete note");
    }
  }

  async function submitNote(e) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      const res = await apiFetch("/v2/notes", {
        method: "POST",
        body: JSON.stringify({
          title: noteTitle.trim() || null,
          content: noteContent.trim(),
        }),
      });
      if (!res.ok) {
        setActionError("Could not save note");
        return;
      }
      const json = await res.json();
      if (json.data) {
        setNotes((prev) => [json.data, ...prev]);
      } else {
        await fetchDashboard();
      }
      setNoteModal(false);
      setNoteTitle("");
      setNoteContent("");
      setActionError(null);
    } catch {
      setActionError("Could not save note");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* <div className={styles.welcomeBanner}>
        <div className={styles.welcomeText}>
          <span className={styles.greetLabel}>{greeting}</span>
          <h1 className={styles.greetName}>
            Welcome back, <span className={styles.nameHighlight}>{firstName}</span>
          </h1>
          <span className={styles.roleBadge}>
            <i className="fas fa-shield-halved" />
            {String(user?.publicMetadata?.role || "Staff")}
          </span>
        </div>
        <div className={styles.welcomeDecor} aria-hidden="true" />
      </div> */}

      {statsError ? (
        <div className={styles.statsErrorBanner} role="alert">
          <span>{statsError}</span>
          <button
            type="button"
            className={styles.statsErrorRetry}
            onClick={() => fetchStats({ quiet: false })}
          >
            Retry
          </button>
        </div>
      ) : null}
      {dashboardError ? (
        <div className={styles.statsErrorBanner} role="alert">
          <span>{dashboardError}</span>
          <button type="button" className={styles.statsErrorRetry} onClick={fetchDashboard}>
            Try again
          </button>
        </div>
      ) : null}
      {actionError ? (
        <div className={styles.statsErrorBanner} role="alert">
          <span>{actionError}</span>
        </div>
      ) : null}

      <TodayOverviewWidget summary={todayFeedSummary} />

      <div className={styles.oprGrid} aria-label="Prospects and pipeline">
        <article className={styles.oprCard}>
          <header className={styles.oprCardHeader}>
            <h3 className={styles.oprTitle}>Open pipeline</h3>
          </header>
          <div className={styles.oprBody}>
            <DashboardOprMiniCard
              href="/opportunities?view=pipeline"
              label="Open prospects"
              value={stats?.open?.opportunities ?? 0}
              inrPill={fmtInrPill(stats?.open?.opportunities_value)}
              loading={statsLoading}
            />
          </div>
        </article>
        <article className={styles.oprCard}>
          <header className={styles.oprCardHeader}>
            <h3 className={styles.oprTitle}>Created today</h3>
          </header>
          <div className={styles.oprBody}>
            <DashboardOprMiniCard
              href="/opportunities?view=all"
              label="New prospects"
              value={stats?.periodic?.opportunities ?? 0}
              inrPill={fmtInrPill(stats?.periodic?.opportunities_value)}
              loading={statsLoading}
            />
          </div>
        </article>
        <article className={styles.oprCard}>
          <header className={styles.oprCardHeader}>
            <h3 className={styles.oprTitle}>Closed today</h3>
          </header>
          <div className={styles.oprBody}>
            <DashboardOprPairBlock
              loading={statsLoading}
              left={{
                href: "/opportunities?view=won",
                label: "Won",
                value: opportunityResultPanel.won,
                inrPill: fmtInrPill(opportunityResultPanel.wonVal),
              }}
              right={{
                href: "/opportunities?view=lost",
                label: "Lost",
                value: opportunityResultPanel.lost,
                inrPill: fmtInrPill(opportunityResultPanel.lostVal),
              }}
            />
          </div>
        </article>
      </div>

      <div className={styles.fitnessCRMCard}>
        <div className={styles.fitnessHeader}>
          <div className={styles.fitnessTitleGroup}>
            <i className={`fas fa-dumbbell ${styles.fitnessIcon}`} />
            <h2 className={styles.fitnessTitle}>Fitness CRM Dashboard</h2>
          </div>
          <div className={styles.fitnessActions}>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className={styles.fitnessBtn}
              disabled={importing}
            >
              <i className={importing ? "fas fa-spinner fa-spin" : "fas fa-file-import"} />
              {importing ? "Importing..." : "Import Excel"}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: "none" }} 
              accept=".xlsx,.xls" 
              onChange={handleImport}
            />
            <button onClick={handleExport} className={styles.fitnessBtn}>
              <i className="fas fa-file-export" /> Export
            </button>
            <Link href="/clients" className={styles.fitnessBtn}>
              <i className="fas fa-users" /> View Clients
            </Link>
            <Link href="/business-tracker" className={styles.fitnessBtn}>
              <i className="fas fa-chart-line" /> Business Tracker
            </Link>
          </div>
        </div>
        <div className={styles.fitnessStatsGrid}>
          <Link href="/clients?status=Active" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.active_clients || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>Active Clients</div>
          </Link>
          <Link href="/clients?filter=overdue" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue} style={{ color: "#ef4444" }}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.overdue_followups || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>Overdue Follow Ups</div>
          </Link>
          <Link href="/clients?filter=expiring" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue} style={{ color: "#f59e0b" }}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.expiring_soon || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>Plans Expiring Soon</div>
          </Link>
          <Link href="/clients?filter=attention" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue} style={{ color: "#8b5cf6" }}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.need_attention || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>Need Attention</div>
          </Link>
          <Link href="/clients?filter=High Risk" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue} style={{ color: "#ef4444" }}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.high_risk_clients || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>High Risk Clients</div>
          </Link>
          <Link href="/clients?status=Hold" className={styles.fitnessStatItem}>
            <div className={styles.fitnessStatValue} style={{ color: "#64748b" }}>
              {fitnessLoading ? <span className={styles.skeleton} style={{ width: 40, height: 40 }} /> : (fitnessStats?.on_hold || 0)}
            </div>
            <div className={styles.fitnessStatLabel}>On Hold</div>
          </Link>
        </div>

        {/* Financial Quick Summary */}
        <div className={styles.financialStrip}>
          <div className={styles.finItem}>
            <span className={styles.finLabel}>Monthly Revenue</span>
            <span className={styles.finValue}>{fmtInrPill(fitnessStats?.monthly_revenue || 0)}</span>
          </div>
          <div className={styles.finItem}>
            <span className={styles.finLabel}>Monthly Profit</span>
            <span className={styles.finValue} style={{color: "#10b981"}}>{fmtInrPill(fitnessStats?.monthly_profit || 0)}</span>
          </div>
          <div className={styles.finItem}>
            <span className={styles.finLabel}>Total Pending</span>
            <span className={styles.finValue} style={{color: "#ef4444"}}>{fmtInrPill(fitnessStats?.total_pending || 0)}</span>
          </div>
          <Link href="/business-tracker" className={styles.finLink}>Full Report <i className="fas fa-chevron-right" /></Link>
        </div>

        {/* Proactive Alerts Section */}
        {fitnessStats?.proactive_alerts?.length > 0 && (
          <div className={styles.fitnessAlertsSection}>
            <div className={styles.fitnessAlertsHeader}>
              <i className="fas fa-bell-on" style={{ color: '#ef4444' }} />
              <span>Critical Action Required</span>
            </div>
            <div className={styles.fitnessAlertsGrid}>
              {fitnessStats.proactive_alerts.map(alert => (
                <div key={alert.id} className={styles.fitnessAlertItem}>
                  <div className={styles.fitnessAlertIcon}>
                    <i className={alert.entity_type === 'fitness_expiry' ? "fas fa-clock" : "fas fa-calendar-exclamation"} />
                  </div>
                  <div className={styles.fitnessAlertContent}>
                    <div className={styles.fitnessAlertTitle}>{alert.title}</div>
                    <div className={styles.fitnessAlertBody}>{alert.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.statsGrid}>
        {statCards.map((card) => (
          <div key={card.label} className={styles.statCard}>
            <div className={styles.statTop}>
              <div className={styles.statInfo}>
                <span className={styles.statLabel}>{card.label}</span>
                <span className={styles.statValue}>
                  {statsLoading ? (
                    <span className={styles.skeleton} style={{ width: 40, height: 28 }} />
                  ) : (
                    card.value
                  )}
                </span>
              </div>
              <div
                className={styles.statIcon}
                style={{ color: card.color, background: `${card.color}18` }}
              >
                <i className={`fas ${card.icon}`} />
              </div>
            </div>

            <div className={styles.statMeta}>
              <span
                className={styles.statSubBadge}
                style={{ background: `${card.color}22`, color: card.color }}
              >
                {card.sub}
              </span>
              {card.subNote ? (
                <span className={styles.statSubNote}>{card.subNote}</span>
              ) : null}
            </div>

            <div className={styles.progressRow}>
              <span className={styles.progressLabel}>{card.progressLabel}</span>
              <span className={styles.progressPct} style={{ color: card.color }}>
                {Number(card.progress || 0).toFixed(2)} %
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${Math.min(100, Number(card.progress) || 0)}%`,
                  background: card.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>


      {/* Schedule */}
      <div className={`${styles.panel} ${styles.tasksPanel}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <i className="fas fa-calendar-alt" /> Upcoming Schedule
          </h2>
          <Link href="/calendar" className={styles.viewAllBtn}>View Calendar</Link>
        </div>
        <div className={styles.panelBody}>
          {scheduleLoading ? (
            <div className={styles.emptyState}>
              <div className={styles.spinnerRing} />
              <span>Loading schedule…</span>
            </div>
          ) : schedule.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-calendar-day" style={{ fontSize: 40, opacity: 0.15 }} />
              <span>No events scheduled for this week</span>
            </div>
          ) : (
            <div className={styles.taskList}>
              {schedule.slice(0, 8).map((it) => {
                const isToday = it.start.slice(0, 10) === new Date().toISOString().slice(0, 10);
                const timeStr = new Date(it.start).toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={it.id} className={styles.taskRow}>
                    <div className={styles.scheduleDot} style={{ background: it.type === 'meeting' ? '#ef4444' : it.type === 'fitness' ? '#10b981' : '#f97316' }} />
                    <div className={styles.taskMain}>
                      <span className={styles.taskTitle}>{it.title}</span>
                      <div className={styles.taskMeta}>
                        {isToday ? "Today" : new Date(it.start).toLocaleDateString("en-IN")} at {timeStr}
                        {it.description ? ` · ${it.description}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className={`${styles.panel} ${styles.tasksPanel}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <i className="fas fa-calendar-check" /> Tasks
          </h2>
          <div className={styles.tabGroup}>
            <button
              type="button"
              className={`${styles.tabBtn} ${taskTab === "today" ? styles.tabBtnActive : ""}`}
              onClick={() => setTaskTab("today")}
            >
              Today ({tasksToday.length})
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${taskTab === "tomorrow" ? styles.tabBtnActive : ""}`}
              onClick={() => setTaskTab("tomorrow")}
            >
              Tomorrow ({tasksTomorrow.length})
            </button>
          </div>
        </div>
        <div className={styles.panelBody}>
          {loading ? (
            <div className={styles.emptyState}>
              <div className={styles.spinnerRing} />
              <span>Loading tasks…</span>
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-calendar" style={{ fontSize: 40, opacity: 0.15 }} />
              <span>There Are No Tasks To Display</span>
            </div>
          ) : (
            <div className={styles.taskList}>
              {visibleTasks.slice(0, 12).map((t) => (
                <div key={t.id} className={styles.taskRow}>
                  <button
                    type="button"
                    className={`${styles.taskCheck} ${t.status === "done" || t.status === "completed" ? styles.taskCheckDone : ""}`}
                    onClick={() => toggleTaskDone(t)}
                    aria-label={t.status === "done" || t.status === "completed" ? "Mark not done" : "Mark done"}
                  >
                    {t.status === "done" || t.status === "completed" ? <i className="fas fa-check" /> : null}
                  </button>
                  <div className={styles.taskMain}>
                    <span className={styles.taskTitle}>{t.title}</span>
                    <div className={styles.taskMeta}>
                      {t.due_date
                        ? `Due ${new Date(t.due_date).toLocaleDateString("en-IN")}`
                        : "No due date"}
                      {t.lead_id ? (
                        <>
                          {" · "}
                          <Link href={`/leads/${t.lead_id}`} className={styles.leadName}>
                            Lead #{t.lead_id}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Todos */}
      <div className={`${styles.panel} ${styles.tasksPanel}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <i className="fas fa-clipboard-list" /> Todos
          </h2>
          <div className={styles.tabGroup}>
            {["high", "medium", "low"].map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.tabBtn} ${todoPriTab === p ? styles.tabBtnActive : ""}`}
                onClick={() => setTodoPriTab(p)}
              >
                {p === "high" ? "High" : p === "medium" ? "Medium" : "Low"} (
                {todos.filter((t) => String(t.priority || "").toLowerCase() === p).length})
              </button>
            ))}
          </div>
        </div>
        <div className={styles.panelBody}>
          {loading ? (
            <div className={styles.emptyState}>
              <div className={styles.spinnerRing} />
              <span>Loading todos…</span>
            </div>
          ) : todosByPri.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-clipboard-list" style={{ fontSize: 40, opacity: 0.15 }} />
              <span>There Are No Todos to Display</span>
            </div>
          ) : (
            <div className={styles.taskList}>
              {todosByPri.slice(0, 12).map((t) => (
                <div key={t.id} className={styles.taskRow}>
                  <button
                    type="button"
                    className={`${styles.taskCheck} ${t.status === "completed" ? styles.taskCheckDone : ""}`}
                    onClick={() => toggleTodoDone(t)}
                    aria-label={t.status === "completed" ? "Mark pending" : "Mark done"}
                  >
                    {t.status === "completed" ? <i className="fas fa-check" /> : null}
                  </button>
                  <div className={styles.taskMain}>
                    <span className={styles.taskTitle}>{t.body}</span>
                    <div className={styles.taskMeta}>
                      {t.todo_date
                        ? `Due ${new Date(`${t.todo_date}T12:00:00`).toLocaleDateString("en-IN")}`
                        : "No date"}
                      {t.frequency && t.frequency !== "once" ? ` · ${String(t.frequency).replace(/_/g, " ")}` : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky notes */}
      <div className={`${styles.panel} ${styles.stickyPanel}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <i className="fas fa-bookmark" /> Sticky Notes
          </h2>
          <button
            type="button"
            className={styles.addNoteBtn}
            onClick={() => setNoteModal(true)}
          >
            <i className="fas fa-plus" /> Add Note
          </button>
        </div>
        <div className={styles.panelBody}>
          {loading ? (
            <div className={styles.emptyState}>
              <div className={styles.spinnerRing} />
              <span>Loading notes…</span>
            </div>
          ) : notes.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-bookmark" style={{ fontSize: 40, opacity: 0.15 }} />
              <span>There Are No Sticky Notes To Display</span>
            </div>
          ) : (
            <div className={styles.notesGrid}>
              {notes.slice(0, 12).map((n) => (
                <div key={n.id} className={styles.noteCard}>
                  <button
                    type="button"
                    className={styles.noteDelete}
                    onClick={() => deleteNote(n)}
                    aria-label="Delete note"
                  >
                    <i className="fas fa-trash" />
                  </button>
                  {n.title ? <div className={styles.noteCardTitle}>{n.title}</div> : null}
                  <div className={styles.noteCardBody}>{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className={styles.chartsGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div>
              <h3 className={styles.chartCardTitle}>Lead Status</h3>
              {rangeLabel ? <div className={styles.chartMeta}>{rangeLabel}</div> : null}
              <span className={styles.userTag}>{displayName}</span>
            </div>
            <ChartCardMenu />
          </div>
          <div className={styles.chartCardBody}>
            {loading && !insights ? (
              <div className={styles.emptyState} style={{ minHeight: 200 }}>
                <div className={styles.spinnerRing} />
              </div>
            ) : (
              <LeadStatusDonut byStatus={insights?.byStatus} />
            )}
          </div>
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div>
              <h3 className={styles.chartCardTitle}>Lead Source</h3>
              {rangeLabel ? <div className={styles.chartMeta}>{rangeLabel}</div> : null}
              <span className={styles.userTag}>{displayName}</span>
            </div>
            <ChartCardMenu />
          </div>
          <div className={styles.chartCardBody}>
            {loading && !insights ? (
              <div className={styles.emptyState} style={{ minHeight: 200 }}>
                <div className={styles.spinnerRing} />
              </div>
            ) : (
              <LeadSourceArea
                bySourceByDay={insights?.bySourceByDay || []}
                sources={insights?.sources || []}
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles.bottomGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <i className="fas fa-stethoscope" /> Recent Consultations
            </h2>
            <Link href="/consultations" className={styles.viewAllBtn}>View All</Link>
          </div>

          <div className={styles.panelBody}>
            {loading ? (
              <div className={styles.emptyState}>
                <div className={styles.spinnerRing} />
                <span>Loading consultations…</span>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {/* We would fetch these specifically, but for now we'll use the schedule feed if it has consultations */}
                  {schedule.filter(s => s.description?.includes('Consultation')).slice(0, 8).map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.start).toLocaleDateString("en-IN")}</td>
                      <td>{s.title.replace('Consultation: ', '')}</td>
                      <td><span className={styles.sourceBadge}>Review</span></td>
                      <td>-</td>
                    </tr>
                  ))}
                  {schedule.filter(s => s.description?.includes('Consultation')).length === 0 && (
                    <tr><td colSpan="4" className={styles.emptyRow}>No recent consultations</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <i className="fas fa-flag-checkered" /> Fitness Milestones
            </h2>
            <div className={styles.tabGroup}>
              <button className={styles.tabBtnActive}>Upcoming</button>
            </div>
          </div>

          <div className={styles.panelBody}>
            {loading ? (
              <div className={styles.emptyState}>
                <div className={styles.spinnerRing} />
                <span>Loading milestones…</span>
              </div>
            ) : (
              <div className={styles.schedList}>
                {schedule.filter(s => s.type === 'fitness').slice(0, 8).map((m) => (
                  <div key={m.id} className={styles.schedItem}>
                    <div
                      className={styles.schedIcon}
                      style={{ background: "#10b98120", color: "#10b981" }}
                    >
                      <i className="fas fa-star" />
                    </div>
                    <div className={styles.schedInfo}>
                      <span className={styles.schedTitle}>{m.title}</span>
                      <span className={styles.schedTime}>
                        {new Date(m.start).toLocaleDateString("en-IN")} · {m.description}
                      </span>
                    </div>
                  </div>
                ))}
                {schedule.filter(s => s.type === 'fitness').length === 0 && (
                  <div className={styles.emptyState}>No milestones this week</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isPlatformAdmin ? (
        <FitnessTransactionPies data={fitnessTxCharts} loading={fitnessLoading} />
      ) : null}

      {noteModal && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-modal-title"
          onClick={() => {
            setNoteModal(false);
            setNoteTitle("");
            setNoteContent("");
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h2 id="note-modal-title" className={styles.modalTitle}>
              New sticky note
            </h2>
            <form onSubmit={submitNote}>
              <div className={styles.modalField}>
                <label htmlFor="note-title">Title (optional)</label>
                <input
                  id="note-title"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Short title"
                />
              </div>
              <div className={styles.modalField}>
                <label htmlFor="note-body">Content</label>
                <textarea
                  id="note-body"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write your note…"
                  required
                />
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.modalBtnGhost}
                  onClick={() => {
                    setNoteModal(false);
                    setNoteTitle("");
                    setNoteContent("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.modalBtnPrimary} disabled={savingNote}>
                  {savingNote ? "Saving…" : "Save note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}