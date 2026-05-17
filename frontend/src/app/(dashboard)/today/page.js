"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useTodayFeed } from "@/lib/useTodayFeed";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "./todayPage.module.css";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "calls", label: "📞 Calls" },
  { id: "tasks", label: "📋 Tasks" },
  { id: "meetings", label: "🤝 Meetings" },
  { id: "reminders", label: "🔔 Reminders" },
  { id: "events", label: "📅 Events" },
  { id: "checkins", label: "⚖️ Check-ins" },
  { id: "plans", label: "🍽 Plans" },
  { id: "prospects", label: "🎯 Prospects" },
  { id: "payments", label: "💰 Payments" },
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
};

const READ_ONLY_TYPES = new Set(["calendar_event", "google_event"]);

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
    case "calendar_event":
    case "google_event": {
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
  if (filterId === "tasks") return item.source_type === "task";
  if (filterId === "meetings") return item.source_type === "meeting";
  if (filterId === "reminders") return item.source_type === "reminder";
  if (filterId === "events") {
    return item.source_type === "calendar_event" || item.source_type === "google_event";
  }
  if (filterId === "checkins") return item.source_type === "client_followup";
  if (filterId === "plans") {
    return (
      item.source_type === "todo" &&
      String(item.meta?.todo_category || "").toLowerCase() === "send_meal_plan"
    );
  }
  if (filterId === "prospects") return item.source_type === "opportunity_followup";
  if (filterId === "payments") return item.source_type === "collection_followup";
  return true;
}

function canMarkDone(item) {
  return !READ_ONLY_TYPES.has(item.source_type) && !item.meta?.readOnly;
}

function TodayCard({ item, onDone, doing, showDoneButton = true }) {
  const meta = SOURCE_META[item.source_type] || SOURCE_META.todo;
  const dueTime = formatDueTime(item);
  const overdueDays = item.is_overdue ? daysOverdue(item.due_date) : 0;
  const showDone = showDoneButton && canMarkDone(item);
  const parts = [];
  if (item.client_name) parts.push(item.client_name);
  if (item.source_type === "collection_followup" && item.meta?.pending_inr != null) {
    parts.push(`₹${Number(item.meta.pending_inr).toLocaleString("en-IN")} pending`);
  }
  if (dueTime) parts.push(`at ${dueTime}`);
  if (overdueDays > 0) parts.push(`🔴 ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`);

  return (
    <article className={`${styles.card} ${meta.border}`}>
      <div className={styles.cardRow1}>
        <div className={styles.cardTitleWrap}>
          <span className={styles.badge}>
            {meta.icon} {meta.label}
          </span>
          <span className={styles.cardTitle}>{item.title}</span>
          {item.priority === "high" ? <span className={styles.priorityHigh}>HIGH</span> : null}
          {item.priority === "medium" ? <span className={styles.priorityMed}>MED</span> : null}
        </div>
      </div>
      {parts.length ? <div className={styles.cardRow2}>{parts.join(" · ")}</div> : null}
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
  const { loading, error, summary, items, load } = useTodayFeed({ enabled: isLoaded });
  const [filter, setFilter] = useState("all");
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Today&apos;s Command Center</h1>
        <p className={styles.subtitle}>{formatHeaderDate()}</p>
        <div className={styles.stats}>
          <span className={`${styles.statChip} ${styles.statOverdue}`}>
            🔴 {overdueCount} Overdue
          </span>
          <span className={`${styles.statChip} ${styles.statDue}`}>
            🟡 {dueTodayCount} Due Today
          </span>
          <span className={`${styles.statChip} ${styles.statDone}`}>
            ✅ {sessionDoneCount} Done This Session
          </span>
        </div>
      </header>

      <div className={styles.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`${styles.filterBtn} ${filter === f.id ? styles.filterActive : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading ? (
        <div className={styles.cardList}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : (
        <>
          {overdueItems.length > 0 ? (
            <section className={styles.section}>
              <h2 className={`${styles.sectionHeader} ${styles.sectionOverdue}`}>
                ⚠️ Overdue — {overdueItems.length} items from before today
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

          <section className={styles.section}>
            <h2 className={`${styles.sectionHeader} ${styles.sectionToday}`}>
              📅 Today — {todayItems.length} items
            </h2>
            {todayItems.length === 0 && overdueItems.length === 0 ? (
              <p className={styles.empty}>✅ All clear for today!</p>
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

          {filteredDone.length > 0 ? (
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
                ✅ Done Today ({filteredDone.length}) {doneExpanded ? "▼" : "▶"}
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
