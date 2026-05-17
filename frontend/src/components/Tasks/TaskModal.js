"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import { taskStatusForDb } from "@/lib/taskStatus";
import CrmShellModal from "@/components/Dashboard/CrmShellModal";
import shell from "@/components/Dashboard/CrmShellModal.module.css";
import styles from "./TaskModal.module.css";

const CLIENT_CATEGORIES = [
  { value: "diet_review", label: "Diet Review" },
  { value: "meal_plan", label: "Meal Plan" },
  { value: "weight_checkin", label: "Weight Check-in" },
  { value: "supplement_check", label: "Supplement Check" },
  { value: "plan_renewal", label: "Plan Renewal" },
  { value: "payment_followup", label: "Payment Follow-up" },
  { value: "client_call", label: "Client Call" },
];

const INTERNAL_CATEGORIES = [
  { value: "admin", label: "Admin" },
  { value: "general", label: "General" },
  { value: "payment_followup", label: "Payment Follow-up" },
];

const CATEGORY_LABEL = {
  diet_review: "Diet Review",
  meal_plan: "Meal Plan",
  weight_checkin: "Weight Check-in",
  supplement_check: "Supplement Check",
  plan_renewal: "Plan Renewal",
  payment_followup: "Payment Follow-up",
  client_call: "Client Call",
  admin: "Admin",
  general: "General",
};

const FREQ_OPTS = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function categoryTitlePart(cat) {
  return CATEGORY_LABEL[cat] || "Task";
}

function priOnClass(priority, p) {
  if (priority !== p) return "";
  if (p === "low") return styles.priBtnOnLow;
  if (p === "high") return styles.priBtnOnHigh;
  return styles.priBtnOnMedium;
}

export default function TaskModal({ open, onClose, task, onSaved }) {
  const id = useId();
  const { showToast } = useToast();
  const isEdit = Boolean(task?.id);

  const [users, setUsers] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState("client");
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState([]);
  const [clientPick, setClientPick] = useState(null);
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [frequency, setFrequency] = useState("once");
  const [titleTouched, setTitleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const categories = taskType === "client" ? CLIENT_CATEGORIES : INTERNAL_CATEGORIES;

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setTaskType("client");
    setClientId("");
    setClientQuery("");
    setClientHits([]);
    setClientPick(null);
    setCategory("general");
    setPriority("medium");
    setDueDate("");
    setAssignedTo("");
    setFrequency("once");
    setTitleTouched(false);
    setErr("");
    setSaving(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title || "");
      setDescription(task.description || "");
      setTaskType(task.task_type === "internal" ? "internal" : "client");
      setClientId(task.client_id ? String(task.client_id) : "");
      setClientPick(
        task.client_id
          ? { id: task.client_id, full_name: task.client_name || "", health_goal: "" }
          : null
      );
      setClientQuery(task.client_name || "");
      setCategory(task.task_category || "general");
      setPriority(task.priority || "medium");
      setDueDate(task.due_date ? String(task.due_date).slice(0, 10) : "");
      setAssignedTo(task.assigned_to ? String(task.assigned_to) : "");
      setFrequency(task.frequency || "once");
      setTitleTouched(true);
    } else {
      reset();
    }
  }, [open, task, reset]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await apiFetch("/users");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setUsers(json.data.filter((u) => u.is_active !== 0));
        }
      } catch {
        setUsers([]);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || taskType !== "client") return undefined;
    const q = clientQuery.trim();
    if (q.length < 1) {
      setClientHits([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/fitness/clients?search=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setClientHits(json.data.slice(0, 15));
        } else {
          setClientHits([]);
        }
      } catch {
        setClientHits([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [open, clientQuery, taskType]);

  useEffect(() => {
    if (!open || titleTouched) return;
    if (taskType === "client" && clientPick?.full_name) {
      setTitle(`${categoryTitlePart(category)} - ${clientPick.full_name}`);
    }
  }, [open, taskType, clientPick, category, titleTouched]);

  useEffect(() => {
    if (taskType === "internal" && !INTERNAL_CATEGORIES.some((c) => c.value === category)) {
      setCategory("general");
    }
    if (taskType === "client" && !CLIENT_CATEGORIES.some((c) => c.value === category)) {
      setCategory("diet_review");
    }
  }, [taskType, category]);

  const bodyPayload = useMemo(
    () => ({
      title: title.trim(),
      description: description.trim() || null,
      task_type: taskType,
      client_id: taskType === "client" && clientId ? Number(clientId) : null,
      task_category: category,
      priority,
      due_date: dueDate || null,
      assigned_to: assignedTo ? Number(assignedTo) : null,
      frequency,
      status: task?.status ? taskStatusForDb(task.status) : undefined,
    }),
    [
      title,
      description,
      taskType,
      clientId,
      category,
      priority,
      dueDate,
      assignedTo,
      frequency,
      task?.status,
    ]
  );

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (!dueDate) {
      setErr("Due date is required.");
      return;
    }
    if (taskType === "client" && !clientId) {
      setErr("Please select a client.");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit ? `/tasks/${task.id}` : "/tasks";
      const method = isEdit ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not save task");
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("crm-tasks-changed"));
      }
      showToast(isEdit ? "Task updated" : "Task created");
      onSaved?.(json.data);
      reset();
      onClose?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShellModal open={open} title={isEdit ? "Edit Task" : "New Task"} onClose={onClose}>
      <form className={shell.form} onSubmit={onSubmit}>
        <div className={shell.body}>
          {err ? <p className={shell.err}>{err}</p> : null}

          <section className={styles.section} aria-labelledby={`${id}-sec-basics`}>
            <h3 id={`${id}-sec-basics`} className={styles.sectionTitle}>
              Basics
            </h3>
            <div className={shell.field}>
              <label className={shell.label} htmlFor={`${id}-title`}>
                Title <span className={shell.req}>*</span>
              </label>
              <input
                id={`${id}-title`}
                className={shell.input}
                value={title}
                onChange={(e) => {
                  setTitleTouched(true);
                  setTitle(e.target.value);
                }}
                placeholder="e.g. Diet Review - Priya Sharma"
                required
              />
            </div>
            <div className={shell.field}>
              <span className={shell.label} id={`${id}-type-label`}>
                Task type <span className={shell.req}>*</span>
              </span>
              <div className={styles.seg} role="group" aria-labelledby={`${id}-type-label`}>
                <button
                  type="button"
                  className={`${styles.segBtn} ${taskType === "client" ? styles.segBtnOn : ""}`}
                  onClick={() => setTaskType("client")}
                >
                  Client task
                </button>
                <button
                  type="button"
                  className={`${styles.segBtn} ${taskType === "internal" ? styles.segBtnOn : ""}`}
                  onClick={() => {
                    setTaskType("internal");
                    setClientId("");
                    setClientPick(null);
                    setClientQuery("");
                    setClientHits([]);
                  }}
                >
                  Internal task
                </button>
              </div>
            </div>
          </section>

          {taskType === "client" ? (
            <section className={styles.section} aria-labelledby={`${id}-sec-client`}>
              <h3 id={`${id}-sec-client`} className={styles.sectionTitle}>
                Client
              </h3>
              <div className={`${shell.field} ${styles.clientWrap}`}>
                <label className={shell.label} htmlFor={`${id}-client`}>
                  Search client <span className={shell.req}>*</span>
                </label>
                <input
                  id={`${id}-client`}
                  className={shell.input}
                  value={clientQuery}
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setClientPick(null);
                    setClientId("");
                  }}
                  placeholder="Type name to search…"
                  autoComplete="off"
                />
                {clientPick ? (
                  <p className={styles.clientPicked}>Selected: {clientPick.full_name}</p>
                ) : null}
                {clientHits.length > 0 && !clientPick ? (
                  <ul className={styles.clientList}>
                    {clientHits.map((c) => (
                      <li key={c.id || c.client_id}>
                        <button
                          type="button"
                          className={styles.clientOpt}
                          onClick={() => {
                            setClientPick({
                              id: c.id,
                              full_name: c.full_name,
                              health_goal: c.health_goal,
                            });
                            setClientId(String(c.id));
                            setClientQuery(c.full_name);
                            setClientHits([]);
                            setTitleTouched(false);
                          }}
                        >
                          <strong>{c.full_name}</strong>
                          {c.health_goal ? <span className={styles.sub}>{c.health_goal}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby={`${id}-sec-details`}>
            <h3 id={`${id}-sec-details`} className={styles.sectionTitle}>
              Details
            </h3>
            <div className={shell.row2}>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-cat`}>
                  Category <span className={shell.req}>*</span>
                </label>
                <select
                  id={`${id}-cat`}
                  className={shell.select}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setTitleTouched(false);
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={shell.field}>
                <span className={shell.label} id={`${id}-pri-label`}>
                  Priority <span className={shell.req}>*</span>
                </span>
                <div className={styles.priRow} role="group" aria-labelledby={`${id}-pri-label`}>
                  {["low", "medium", "high"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`${styles.priBtn} ${priOnClass(priority, p)}`}
                      onClick={() => setPriority(p)}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={shell.row2}>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-due`}>
                  Due date <span className={shell.req}>*</span>
                </label>
                <input
                  id={`${id}-due`}
                  type="date"
                  className={shell.input}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-freq`}>
                  Frequency
                </label>
                <select
                  id={`${id}-freq`}
                  className={shell.select}
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  {FREQ_OPTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={shell.field}>
              <label className={shell.label} htmlFor={`${id}-asg`}>
                Assigned to
              </label>
              <select
                id={`${id}-asg`}
                className={shell.select}
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div className={shell.field}>
              <label className={shell.label} htmlFor={`${id}-desc`}>
                Description
              </label>
              <textarea
                id={`${id}-desc`}
                className={shell.textarea}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes, context, or instructions for this task…"
              />
            </div>
          </section>
        </div>

        <footer className={shell.footer}>
          <button type="button" className={shell.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={shell.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create task"}
          </button>
        </footer>
      </form>
    </CrmShellModal>
  );
}

export { CATEGORY_LABEL, CLIENT_CATEGORIES };
