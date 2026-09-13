"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useTodayFeed } from "@/lib/useTodayFeed";
import { useToast } from "@/components/Toast/ToastContext";
import { CrmFilterStrip } from "@/components/UI/CrmFilterStrip";
import styles from "./todayPage.module.css";

const FILTERS = [
  { id: "all", label: "All", color: "#64748b" },
  { id: "calls", label: "Calls", color: "#0d9488" },
  { id: "tasks", label: "Tasks", color: "#6366f1" },
  { id: "meetings", label: "Meetings", color: "#2563eb" },
  { id: "reminders", label: "Reminders", color: "#f59e0b" },
  { id: "events", label: "Events", color: "#e11d48" },
  { id: "checkins", label: "Check-ins", color: "#16a34a" },
  { id: "plans", label: "Plans", color: "#0ea5e9" },
  { id: "prospects", label: "Prospects", color: "#ea580c" },
  { id: "payments", label: "Payments", color: "#16a34a" },
];

const SOURCE_META = {
  todo: { icon: "✅", label: "Todo", border: styles.borderTodo },
  meeting: { icon: "🤝", label: "Meeting", border: styles.borderMeeting },
  reminder: { icon: "🔔", label: "Reminder", border: styles.borderReminder },
  lead_followup: { icon: "📞", label: "Lead call", border: styles.borderLead },
  client_followup: { icon: "⚖️", label: "Check-in", border: styles.borderClient },
  task: { icon: "📋", label: "Task", border: styles.borderTask },
  calendar_event: { icon: "📅", label: "Event", border: styles.borderEvent },
  google_event: { icon: "🌐", label: "Google", border: styles.borderGoogle },
  opportunity_followup: { icon: "🎯", label: "Prospect", border: styles.borderProspect },
  collection_followup: { icon: "💰", label: "Payment due", border: styles.borderPayment },
  fitness_payment_due: { icon: "💰", label: "Payment due", border: styles.borderPayment },
  fitness_client_task: { icon: "📋", label: "Client task", border: styles.borderTask },
  apple_event: { icon: "🍎", label: "Apple Calendar", border: styles.borderEvent },
};

const READ_ONLY_TYPES = new Set(["calendar_event", "google_event", "apple_event"]);

function formatHeaderDate() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function itemKey(it) {
  return `${it.source_type}:${it.source_id ?? it.id}`;
}

function daysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - due) / 86400000));
}

function formatDueTime(item) {
  const timedTypes = new Set([
    "meeting",
    "calendar_event",
    "google_event",
    "apple_event",
    "task",
    "opportunity_followup",
  ]);
  if (!timedTypes.has(item.source_type)) return null;
  const start = item.meta?.start_time || item.meta?.start_at || item.due_date;
  if (!start) return null;
  try {
    const d = new Date(start);
    if (item.meta?.all_day && item.source_type !== "meeting") return null;
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function getViewHref(item) {
  const id = item.source_id ?? item.id;
  switch (item.source_type) {
    case "todo":
      return `/todos?highlight=${id}`;
    case "meeting":
      return `/meetings?highlight=${id}`;
    case "reminder":
      return `/reminders?highlight=${id}`;
    case "task":
      return `/tasks?highlight=${id}`;
    case "lead_followup":
      return `/leads/${id}`;
    case "opportunity_followup":
      return `/opportunities?highlight=${id}`;
    case "client_followup":
      return `/clients/${item.client_id || id}`;
    case "collection_followup":
      return `/collections?highlight=${id}`;
    case "fitness_payment_due":
      return item.client_id ? `/clients/${item.client_id}` : `/business-tracker?highlight=${id}`;
    case "fitness_client_task":
      return item.client_id ? `/clients/${item.client_id}` : "/clients";
    case "calendar_event":
    case "google_event":
    case "apple_event": {
      const d = item.due_date ? String(item.due_date).slice(0, 10) : "";
      return d ? `/calendar?date=${d}` : "/calendar";
    }
    default:
      return "/";
  }
}

function matchesFilter(item, filterId) {
  if (filterId === "all") return true;
  if (filterId === "calls") {
    return item.source_type === "lead_followup" || item.source_type === "client_followup";
  }
  if (filterId === "tasks") {
    return item.source_type === "task" || item.source_type === "fitness_client_task";
  }
  if (filterId === "meetings") return item.source_type === "meeting";
  if (filterId === "reminders") return item.source_type === "reminder";
  if (filterId === "events") {
    return (
      item.source_type === "calendar_event" ||
      item.source_type === "google_event" ||
      item.source_type === "apple_event"
    );
  }
  if (filterId === "checkins") return item.source_type === "client_followup";
  if (filterId === "plans") {
    return (
      item.source_type === "todo" &&
      String(item.meta?.todo_category || "").toLowerCase() === "send_meal_plan"
    );
  }
  if (filterId === "prospects") return item.source_type === "opportunity_followup";
  if (filterId === "payments") {
    return item.source_type === "collection_followup" || item.source_type === "fitness_payment_due";
  }
  return true;
}

function canMarkDone(item) {
  return !READ_ONLY_TYPES.has(item.source_type) && !item.meta?.readOnly;
}

function TodayCard({ item, onDone, doing, showDoneButton = true }) {
  const meta = SOURCE_META[item.source_type] || SOURCE_META.todo;
  const overdueDays = item.is_overdue ? daysOverdue(item.due_date) : 0;
  const showDone = showDoneButton && canMarkDone(item);
  const dueLabel =
    item.due_display?.label ||
    (formatDueTime(item) ? `Today · ${formatDueTime(item)}` : null) ||
    "No date set";
  const subtitle = item.subtitle || null;
  const actionHint = item.action_label || null;
  const relative = item.due_display?.relative;
  const duePillClass =
    relative === "Overdue" || relative === "Past due"
      ? styles.duePillOverdue
      : relative === "Today"
        ? styles.duePillToday
        : relative === "Tomorrow"
          ? styles.duePillTomorrow
          : styles.duePillUpcoming;

  return (
    <article className={`${styles.card} ${meta.border}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardMain}>
          <div className={styles.cardTitleRow}>
            <span className={styles.badge}>
              {meta.icon} {meta.label}
            </span>
            {item.priority === "high" ? <span className={styles.priorityHigh}>HIGH</span> : null}
            {item.priority === "medium" ? <span className={styles.priorityMed}>MED</span> : null}
          </div>
          <h3 className={styles.cardTitle}>{item.title}</h3>
          {actionHint ? <p className={styles.actionHint}>{actionHint}</p> : null}
          {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          {item.client_name && !subtitle?.includes(item.client_name) ? (
            <p className={styles.cardClient}>{item.client_name}</p>
          ) : null}
          {overdueDays > 0 ? (
            <p className={styles.overdueHint}>
              🔴 {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
            </p>
          ) : null}
        </div>
        <div className={`${styles.duePill} ${duePillClass}`}>
          <span className={styles.duePillLabel}>When</span>
          <span className={styles.duePillValue}>{dueLabel}</span>
        </div>
      </div>
      <div className={styles.cardActions}>
        {showDone ? (
          <button
            type="button"
            className={styles.btnDone}
            disabled={doing}
            onClick={() => onDone(item)}
          >
            ✅ Done
          </button>
        ) : null}
        <Link href={getViewHref(item)} className={styles.btnView}>
          View
        </Link>
      </div>
    </article>
  );
}

export default function TodayPage() {
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const { loading, error, summary, items, upcoming, load } = useTodayFeed({ enabled: isLoaded });
  const [filter, setFilter] = useState("all");
  const [bucket, setBucket] = useState("all");
  const [doneSession, setDoneSession] = useState([]);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [doingKey, setDoingKey] = useState(null);
  const [sessionDoneCount, setSessionDoneCount] = useState(0);
  const [optimisticItems, setOptimisticItems] = useState(null);

  useEffect(() => {
    setOptimisticItems(null);
  }, [items]);

  const displayItems = optimisticItems ?? items;
  const doneKeys = useMemo(() => new Set(doneSession.map(itemKey)), [doneSession]);

  const filteredActive = useMemo(() => {
    return displayItems.filter((it) => !doneKeys.has(itemKey(it)) && matchesFilter(it, filter));
  }, [displayItems, doneKeys, filter]);

  const overdueItems = useMemo(
    () => filteredActive.filter((it) => it.is_overdue === 1),
    [filteredActive]
  );
  const todayItems = useMemo(
    () => filteredActive.filter((it) => it.is_overdue !== 1),
    [filteredActive]
  );

  const filteredDone = useMemo(
    () => doneSession.filter((it) => matchesFilter(it, filter)),
    [doneSession, filter]
  );
  const filteredUpcoming = useMemo(
    () => (upcoming || []).filter((it) => !doneKeys.has(itemKey(it)) && matchesFilter(it, filter)),
    [upcoming, doneKeys, filter]
  );

  const handleDone = async (item) => {
    const key = itemKey(item);
    if (doneKeys.has(key)) return;
    setDoingKey(key);
    const snapshot = displayItems;
    setOptimisticItems(displayItems.filter((it) => itemKey(it) !== key));
    setDoneSession((prev) => [...prev, item]);
    setSessionDoneCount((c) => c + 1);

    try {
      const res = await apiFetch(
        `/today/${encodeURIComponent(item.source_type)}/${encodeURIComponent(
          item.source_id ?? item.id
        )}/done`,
        { method: "PATCH" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Could not mark done");
      }
      setOptimisticItems(null);
      void load(true);
    } catch (e) {
      setOptimisticItems(snapshot);
      setDoneSession((prev) => prev.filter((it) => itemKey(it) !== key));
      setSessionDoneCount((c) => Math.max(0, c - 1));
      showToast(e.message || "Failed to mark done", "error");
    } finally {
      setDoingKey(null);
    }
  };

  const overdueCount = summary?.overdue ?? overdueItems.length;
  const dueTodayCount = summary?.due_today ?? todayItems.length;

  const typeCounts = useMemo(() => {
    const pool = displayItems.filter((it) => !doneKeys.has(itemKey(it)));
    const out = {};
    for (const f of FILTERS) {
      out[f.id] = f.id === "all" ? pool.length : pool.filter((it) => matchesFilter(it, f.id)).length;
    }
    return out;
  }, [displayItems, doneKeys]);

  const showOverdue = bucket === "all" || bucket === "overdue";
  const showToday = bucket === "all" || bucket === "today";
  const showUpcoming = bucket === "all";
  const showDone = bucket === "all" || bucket === "done";

  useEffect(() => {
    if (bucket === "done") setDoneExpanded(true);
  }, [bucket]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Today&apos;s Command Center</h1>
        <p className={styles.subtitle}>{formatHeaderDate()}</p>
        <CrmFilterStrip
          ariaLabel="Today status"
          activeKey={bucket}
          items={[
            { key: "all", label: "All Today", count: (overdueCount || 0) + (dueTodayCount || 0), color: "#64748b" },
            { key: "overdue", label: "Overdue", count: overdueCount, color: "#dc2626" },
            { key: "today", label: "Due Today", count: dueTodayCount, color: "#f59e0b" },
            { key: "done", label: "Done This Session", count: sessionDoneCount, color: "#16a34a" },
          ]}
          onSelect={(key) => setBucket((prev) => (prev === key ? "all" : key || "all"))}
        />
        <CrmFilterStrip
          ariaLabel="Filter by type"
          activeKey={filter}
          items={FILTERS.map((f) => ({
            key: f.id,
            label: f.label,
            count: typeCounts[f.id] || 0,
            color: f.color,
          }))}
          onSelect={(key) => setFilter(key || "all")}
        />
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading ? (
        <div className={styles.cardList}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : (
        <>
          {showOverdue && overdueItems.length > 0 ? (
            <section className={styles.section}>
              <h2 className={`${styles.sectionHeader} ${styles.sectionOverdue}`}>
                Overdue — {overdueItems.length} items from before today
              </h2>
              <div className={styles.cardList}>
                {overdueItems.map((it) => (
                  <TodayCard
                    key={itemKey(it)}
                    item={it}
                    onDone={handleDone}
                    doing={doingKey === itemKey(it)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {showToday ? (
            <section className={styles.section}>
              <h2 className={`${styles.sectionHeader} ${styles.sectionToday}`}>
                Today — {todayItems.length} items
              </h2>
              {todayItems.length === 0 && overdueItems.length === 0 ? (
                <p className={styles.empty}>All clear for today!</p>
              ) : (
                <div className={styles.cardList}>
                  {todayItems.map((it) => (
                    <TodayCard
                      key={itemKey(it)}
                      item={it}
                      onDone={handleDone}
                      doing={doingKey === itemKey(it)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {showUpcoming && filteredUpcoming.length > 0 ? (
            <section className={styles.section}>
              <h2 className={`${styles.sectionHeader} ${styles.sectionUpcoming}`}>
                Upcoming — {filteredUpcoming.length} next up
              </h2>
              <div className={styles.cardList}>
                {filteredUpcoming.map((it) => (
                  <TodayCard
                    key={`upcoming-${itemKey(it)}`}
                    item={it}
                    onDone={handleDone}
                    doing={doingKey === itemKey(it)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {showDone && filteredDone.length > 0 ? (
            <section className={styles.section}>
              <h2
                className={`${styles.sectionHeader} ${styles.sectionDone}`}
                onClick={() => setDoneExpanded((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setDoneExpanded((v) => !v);
                }}
                role="button"
                tabIndex={0}
              >
                Done Today ({filteredDone.length}) {doneExpanded ? "▼" : "▶"}
              </h2>
              {doneExpanded ? (
                <div className={styles.cardList}>
                  {filteredDone.map((it) => (
                    <TodayCard
                      key={`done-${itemKey(it)}`}
                      item={it}
                      onDone={() => {}}
                      doing={false}
                      showDoneButton={false}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
