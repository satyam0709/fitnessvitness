"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useUser, useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, connectGlobalSocket } from "@/lib/api";
import { LeadStatusDonut, LeadSourceArea, ChartCardMenu } from "@/components/Dashboard/DashboardCharts";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { useAdminRealtime } from "@/app/admin/AdminRealtimeProvider";
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
  const { refreshNonce: adminRefreshNonce } = useAdminRealtime();
  const { featureMap, isLoading: featuresLoading } = useTenantFeatures();
  const isPlatformAdmin =
    Number(user?.is_platform_admin) === 1 || Number(user?.isPlatformAdmin) === 1;
  const [stats, setStats] = useState(null);
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
  const [statsLoading, setStatsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
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
    if (isPlatformAdmin) {
      router.replace("/admin/dashboard");
    }
  }, [isLoaded, isPlatformAdmin, router]);

  useEffect(() => {
    if (!isLoaded || featuresLoading) return;
    if (isPlatformAdmin) return;
    // Wait until we know the auth state (not null, which means still loading)
    if (isSignedIn !== true && isSignedIn !== false) return;
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    if (isSignedIn) {
      fetchDashboard();
      fetchStats();
    }
  }, [isLoaded, isSignedIn, featuresLoading, isPlatformAdmin, fetchDashboard, fetchStats]);

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

      const onTodos = () => { if (!cancelled) queueQuietDashboardRefresh(); };
      const onMeetings = () => { if (!cancelled) queueQuietDashboardRefresh(); };
      const onCalendar = () => { if (!cancelled) queueQuietDashboardRefresh(); };
      const onAccess = () => { if (!cancelled) queueQuietDashboardRefresh(); };
      const onOpps = () => { if (!cancelled) queueQuietDashboardRefresh(); };

      s.on("todos:changed", onTodos);
      s.on("meetings:changed", onMeetings);
      s.on("calendar:changed", onCalendar);
      s.on("workspace:access", onAccess);
      s.on("opportunities:changed", onOpps);

      return () => {
        s.off("todos:changed", onTodos);
        s.off("meetings:changed", onMeetings);
        s.off("calendar:changed", onCalendar);
        s.off("workspace:access", onAccess);
        s.off("opportunities:changed", onOpps);
      };
    }

    initSocket().then((fn) => {
      cleanupFn = fn;
    });

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
  }, [isLoaded, isSignedIn, isPlatformAdmin, queueQuietDashboardRefresh]);

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
      label: "Today's Tasks",
      value: ts?.tasks_today ?? stats?.todayTasks ?? 0,
      sub: `${ts?.tasks_completed ?? stats?.taskCompleted ?? 0} Completed`,
      subNote: stats?.taskTotal != null ? `of ${stats.taskTotal} due today` : "",
      progress: Number(stats?.taskProgress ?? 0),
      progressLabel: "Completed Task",
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
      href: "/opportunities?stage=open",
      label: "Opportunities",
      value: stats?.open?.opportunities ?? 0,
      inrPill: fmtInrPill(stats?.open?.opportunities_value),
    },
    { href: "/tickets?status=open", label: "Tickets", value: stats?.open?.tickets ?? 0 },
    { href: "/contacts", label: "Contacts", value: stats?.open?.contacts ?? 0 },
    { href: "/tasks?status=processing", label: "Activities", value: stats?.open?.activities ?? 0 },
    { href: "/reminders", label: "Today's Calls", value: stats?.open?.calls ?? 0 },
    { href: "/companies", label: "Companies", value: stats?.open?.companies ?? 0 },
    { href: "/chat", label: "Messages", value: stats?.open?.messages ?? 0 },
  ];

  const periodicCards = [
    { href: "/leads", label: "Leads", value: stats?.periodic?.leads ?? 0 },
    {
      href: "/opportunities",
      label: "Opportunities",
      value: stats?.periodic?.opportunities ?? 0,
      inrPill: fmtInrPill(stats?.periodic?.opportunities_value),
    },
    { href: "/tickets", label: "Tickets", value: stats?.periodic?.tickets ?? 0 },
    { href: "/contacts", label: "Contacts", value: stats?.periodic?.contacts ?? 0 },
    { href: "/tasks", label: "Activities", value: stats?.periodic?.activities ?? 0 },
    { href: "/reminders", label: "Calls", value: stats?.periodic?.calls ?? 0 },
    { href: "/companies", label: "Companies", value: stats?.periodic?.companies ?? 0 },
    { href: "/chat", label: "Messages", value: stats?.periodic?.messages ?? 0 },
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

      <div className={styles.oprGrid}>
        <div className={styles.oprCard}>
          <div className={styles.oprCardHeader}>
            <h2 className={styles.oprTitle}>Open</h2>
          </div>
          <div className={`${styles.oprBody} ${styles.oprBodyGrid} ${styles.oprBodyGridTwoCol}`}>
            {openCards.reduce((pairs, _, idx, arr) => {
              if (idx % 2 === 0) pairs.push([arr[idx], arr[idx + 1]].filter(Boolean));
              return pairs;
            }, []).map((pair) => (
              <DashboardOprPairBlock
                key={`${pair[0]?.label}-${pair[1]?.label || "single"}`}
                left={pair[0]}
                right={pair[1]}
                loading={statsLoading}
              />
            ))}
          </div>
        </div>

        <div className={styles.oprCard}>
          <div className={styles.oprCardHeader}>
            <h2 className={styles.oprTitle}>Periodic</h2>
            <span className={styles.oprDate}>
              Today ({stats?.periodic?.date || new Date().toLocaleDateString("en-GB")})
            </span>
          </div>
          <div className={`${styles.oprBody} ${styles.oprBodyGrid} ${styles.oprBodyGridTwoCol}`}>
            {periodicCards.reduce((pairs, _, idx, arr) => {
              if (idx % 2 === 0) pairs.push([arr[idx], arr[idx + 1]].filter(Boolean));
              return pairs;
            }, []).map((pair) => (
              <DashboardOprPairBlock
                key={`${pair[0]?.label}-${pair[1]?.label || "single"}`}
                left={pair[0]}
                right={pair[1]}
                loading={statsLoading}
              />
            ))}
          </div>
        </div>

        <div className={styles.oprCard}>
          <div className={styles.oprCardHeader}>
            <h2 className={styles.oprTitle}>Result</h2>
            <span className={styles.oprDate}>
              Today ({stats?.result?.date || new Date().toLocaleDateString("en-GB")})
            </span>
          </div>
          <div className={`${styles.oprBody} ${styles.oprBodyGrid}`}>
            <DashboardOprMiniCard
              href="/tickets?status=closed"
              label="Closed Tickets"
              value={stats?.result?.closed_tickets ?? 0}
              loading={statsLoading}
              valueClassName={
                !statsLoading && (stats?.result?.closed_tickets ?? 0) > 0 ? styles.oprStrongDanger : undefined
              }
            />
            <div className={styles.oprResultOppBlock}>
              <div className={styles.oprResultOppHead}>
                <span className={styles.oprResultOppHeadTitle}>
                  Opportunities ({statsLoading ? "—" : opportunityResultPanel.totalClosed})
                </span>
                {statsLoading ? (
                  <span className={styles.skeleton} style={{ width: 56, height: 22 }} />
                ) : (
                  <span className={styles.oprResultOppHeadPill}>
                    {fmtInrPill(opportunityResultPanel.totalInr)}
                  </span>
                )}
              </div>
              <div className={styles.oprResultOppCols}>
                <Link href="/opportunities?stage=closed_won" className={styles.oprResultOppCol}>
                  <span
                    className={`${styles.oprResultOppMoney} ${styles.oprResultOppMoneyWon}`}
                  >
                    {statsLoading ? (
                      <span className={styles.skeleton} style={{ display: "inline-block", width: 52, height: 16 }} />
                    ) : (
                      fmtInrPill(opportunityResultPanel.wonVal)
                    )}
                  </span>
                  <span className={styles.oprResultOppColLabel}>Closed Won</span>
                  <div className={styles.oprResultOppColValue}>
                    {statsLoading ? (
                      <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 24 }} />
                    ) : (
                      opportunityResultPanel.won
                    )}
                  </div>
                </Link>
                <Link href="/opportunities?stage=closed_lost" className={styles.oprResultOppCol}>
                  <span
                    className={`${styles.oprResultOppMoney} ${styles.oprResultOppMoneyLost}`}
                  >
                    {statsLoading ? (
                      <span className={styles.skeleton} style={{ display: "inline-block", width: 52, height: 16 }} />
                    ) : (
                      fmtInrPill(opportunityResultPanel.lostVal)
                    )}
                  </span>
                  <span className={styles.oprResultOppColLabel}>Closed Lost</span>
                  <div className={styles.oprResultOppColValue}>
                    {statsLoading ? (
                      <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 24 }} />
                    ) : (
                      opportunityResultPanel.lost
                    )}
                  </div>
                </Link>
              </div>
            </div>
            <div className={styles.oprGroup}>
              <div className={styles.oprGroupTitle}>
                Leads ({statsLoading ? "—" : leadResultTotal})
              </div>
              <div className={styles.oprSplit}>
                <Link href="/leads?status=confirm" className={styles.oprLinkLabel}>
                  <span className={`${styles.oprStatusBadge} ${styles.oprBadgeConverted}`}>Converted</span>
                </Link>
                <strong>
                  {statsLoading ? (
                    <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 18 }} />
                  ) : (
                    stats?.result?.leads?.converted ?? 0
                  )}
                </strong>
              </div>
              <div className={styles.oprSplit}>
                <Link href="/leads?status=processing" className={styles.oprLinkLabel}>Recycled</Link>
                <strong>
                  {statsLoading ? (
                    <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 18 }} />
                  ) : (
                    stats?.result?.leads?.recycled ?? 0
                  )}
                </strong>
              </div>
              <div className={styles.oprSplit}>
                <Link href="/leads?status=cancel" className={styles.oprLinkLabel}>
                  <span className={`${styles.oprStatusBadge} ${styles.oprBadgeDead}`}>Dead</span>
                </Link>
                <strong>
                  {statsLoading ? (
                    <span className={styles.skeleton} style={{ display: "inline-block", width: 36, height: 18 }} />
                  ) : (
                    stats?.result?.leads?.dead ?? 0
                  )}
                </strong>
              </div>
            </div>
            <DashboardOprMiniCard
              href="/tasks?status=completed"
              label="Completed Activities"
              value={stats?.result?.completed_activities ?? 0}
              loading={statsLoading}
              valueClassName={
                !statsLoading && (stats?.result?.completed_activities ?? 0) > 0
                  ? styles.oprStrongDanger
                  : undefined
              }
            />
          </div>
        </div>
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

      {/* Tasks */}
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
              <i className="fas fa-filter" /> Leads
            </h2>
            <div className={styles.tabGroup}>
              {["new", "processing", "close_by"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.tabBtn} ${activeLeadTab === t ? styles.tabBtnActive : ""}`}
                  onClick={() => setActiveLeadTab(t)}
                >
                  {t === "new" ? "New" : t === "processing" ? "Processing" : "Close-by"}{" "}
                  ({leads.filter((l) => normLeadStatus(l) === t).length})
                </button>
              ))}
            </div>
          </div>

          <div className={styles.panelBody}>
            {loading ? (
              <div className={styles.emptyState}>
                <div className={styles.spinnerRing} />
                <span>Loading leads…</span>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="fas fa-filter" style={{ fontSize: 40, opacity: 0.15 }} />
                <span>There Are No Leads to Display</span>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Source</th>
                    <th>Assigned</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.slice(0, 8).map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link href={`/leads/${lead.id}`} className={styles.leadName}>
                          {lead.name}
                        </Link>
                        {lead.company_name && (
                          <span className={styles.leadCompany}>{lead.company_name}</span>
                        )}
                      </td>
                      <td>{lead.phone}</td>
                      <td>
                        <span className={styles.sourceBadge}>{lead.source}</span>
                      </td>
                      <td>{lead.assigned_name || "—"}</td>
                      <td>{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <i className="fas fa-bell" /> Schedules
            </h2>
            <div className={styles.tabGroup}>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeSchedTab === "reminder" ? styles.tabBtnActive : ""}`}
                onClick={() => setActiveSchedTab("reminder")}
              >
                Reminder ({reminders.length})
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeSchedTab === "meeting" ? styles.tabBtnActive : ""}`}
                onClick={() => setActiveSchedTab("meeting")}
              >
                Meeting ({todayMeetings.length})
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeSchedTab === "events" ? styles.tabBtnActive : ""}`}
                onClick={() => setActiveSchedTab("events")}
              >
                Events ({eventMeetings.length})
              </button>
            </div>
          </div>

          <div className={styles.panelBody}>
            {loading ? (
              <div className={styles.emptyState}>
                <div className={styles.spinnerRing} />
                <span>Loading schedules…</span>
              </div>
            ) : activeSchedTab === "reminder" ? (
              reminders.length === 0 ? (
                <div className={styles.emptyState}>
                  <i className="fas fa-bell" style={{ fontSize: 40, opacity: 0.15 }} />
                  <span>There Are No Schedules to Display</span>
                </div>
              ) : (
                <div className={styles.schedList}>
                  {reminders.slice(0, 8).map((r) => (
                    <div
                      key={r.id}
                      className={`${styles.schedItem} ${r.is_done ? styles.schedDone : ""}`}
                    >
                      <div
                        className={styles.schedIcon}
                        style={{ background: "#f9731620", color: "#f97316" }}
                      >
                        <i className="fas fa-bell" />
                      </div>
                      <div className={styles.schedInfo}>
                        <span className={styles.schedTitle}>{r.title}</span>
                        <span className={styles.schedTime}>
                          {new Date(r.remind_at).toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {r.is_done && <span className={styles.donePill}>Done</span>}
                    </div>
                  ))}
                </div>
              )
            ) : activeSchedTab === "meeting" ? (
              todayMeetings.length === 0 ? (
                <div className={styles.emptyState}>
                  <i className="fas fa-video" style={{ fontSize: 40, opacity: 0.15 }} />
                  <span>There Are No Meetings to Display</span>
                </div>
              ) : (
                <div className={styles.schedList}>
                  {todayMeetings.slice(0, 8).map((m) => (
                    <div key={m.id} className={styles.schedItem}>
                      <div
                        className={styles.schedIcon}
                        style={{ background: "#06b6d420", color: "#06b6d4" }}
                      >
                        <i className="fas fa-video" />
                      </div>
                      <div className={styles.schedInfo}>
                        <span className={styles.schedTitle}>{m.title}</span>
                        <span className={styles.schedTime}>
                          {new Date(m.start_time).toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {m.location && ` · ${m.location}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : eventMeetings.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="fas fa-calendar" style={{ fontSize: 40, opacity: 0.15 }} />
                <span>There Are No Events to Display</span>
              </div>
            ) : (
              <div className={styles.schedList}>
                {eventMeetings.slice(0, 8).map((m) => (
                  <div key={m.id} className={styles.schedItem}>
                    <div
                      className={styles.schedIcon}
                      style={{ background: "rgba(245, 196, 0, 0.15)", color: "#d4a900" }}
                    >
                      <i className="fas fa-calendar-check" />
                    </div>
                    <div className={styles.schedInfo}>
                      <span className={styles.schedTitle}>{m.title}</span>
                      <span className={styles.schedTime}>
                        {new Date(m.start_time).toLocaleString("en-IN", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.location && ` · ${m.location}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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