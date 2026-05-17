"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import CrmShellModal from "@/components/Dashboard/CrmShellModal";
import AddLeadModal from "@/components/Leads/AddLeadModal";
import MeetingFormModal from "@/components/Meetings/MeetingFormModal";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import QuickTodoModal from "@/components/Dashboard/QuickTodoModal.jsx";
import { useToast } from "@/components/Toast/ToastContext";
import TaskModal from "@/components/Tasks/TaskModal";
import styles from "@/components/Dashboard/CrmShellModal.module.css";

function toSqlDateTime(local) {
  if (!local) return null;
  const s = String(local).replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function userLabel(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `User #${u.id}`;
}

const REM_FREQ = [
  { key: "once", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half Yearly" },
  { key: "yearly", label: "Yearly" },
];

function useResetOnOpen(open, resetFn) {
  useEffect(() => {
    if (open) resetFn();
  }, [open, resetFn]);
}

export function QuickTaskModal({ open, onClose }) {
  return <TaskModal open={open} onClose={onClose} />;
}

export function QuickReminderModal({ open, onClose }) {
  const id = useId();
  const { showToast } = useToast();
  useAuth();
  const [users, setUsers] = useState([]);
  const [freq, setFreq] = useState("once");
  const [remindAt, setRemindAt] = useState("");
  const [tagUserIds, setTagUserIds] = useState([]);
  const [template, setTemplate] = useState("");
  const [sendInstant, setSendInstant] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [waAuto, setWaAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const reset = useCallback(() => {
    setFreq("once");
    setRemindAt("");
    setTagUserIds([]);
    setTemplate("");
    setSendInstant(false);
    setTitle("");
    setMessage("");
    setAssignedTo("");
    setWaAuto(false);
    setErr("");
    setSaving(false);
  }, []);

  useResetOnOpen(open, reset);

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

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!title.trim() || !message.trim() || !remindAt) {
      setErr("Title, message, and date are required.");
      return;
    }
    let note = message.trim();
    if (freq !== "once") note = `[${freq}] ${note}`;
    if (template) note = `[template:${template}] ${note}`;
    if (sendInstant) note = `[instant] ${note}`;
    if (waAuto) note = `[whatsapp:auto] ${note}`;
    if (tagUserIds.length > 0) {
      const names = tagUserIds
        .map((uid) => users.find((u) => String(u.id) === uid))
        .filter(Boolean)
        .map((u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email);
      if (names.length) note = `${note}\n\n— With: ${names.join(", ")}`;
    }

    const reminderType =
      template === "follow_up"
        ? "follow_up"
        : template === "payment"
          ? "payment"
          : template === "meeting"
            ? "meeting"
            : "general";

    setSaving(true);
    try {
      const res = await apiFetch("/reminders", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          note,
          remind_at: toSqlDateTime(remindAt),
          assigned_to_user_id: assignedTo ? Number(assignedTo) : null,
          reminder_type: reminderType,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not create reminder");
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("crm-reminders-changed"));
      }
      showToast("Reminder added successfully");
      reset();
      onClose?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShellModal open={open} title="Add Reminder" onClose={onClose} wide>
      <form
        className={styles.form}
        onSubmit={onSubmit}
        data-gramm="false"
        data-gramm_editor="false"
      >
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <div className={styles.field}>
            <span className={styles.label}>Frequency</span>
            <div className={styles.radioRow} role="radiogroup">
              {REM_FREQ.map((f) => (
                <label key={f.key} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name={`${id}-rf`}
                    checked={freq === f.key}
                    onChange={() => setFreq(f.key)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <p className={styles.hint}>
              Frequency and tags are also reflected in the note; assignee and template type are stored on the reminder record.
            </p>
          </div>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-assign`}>
                Assign to (optional)
              </label>
              <select
                id={`${id}-assign`}
                className={styles.select}
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
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-ra`}>
                Date <span className={styles.req}>*</span>
              </label>
              <input
                id={`${id}-ra`}
                type="datetime-local"
                className={styles.input}
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
                required
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-ru`}>Tag users in note (optional)</label>
            <select
              id={`${id}-ru`}
              className={`${styles.select} ${styles.multiSelect}`}
              multiple
              value={tagUserIds}
              onChange={(e) =>
                setTagUserIds(Array.from(e.target.selectedOptions, (o) => o.value))
              }
            >
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                </option>
              ))}
            </select>
            <p className={styles.hint}>Hold Ctrl/Cmd to select multiple.</p>
          </div>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-tpl`}>Reminder Template</label>
              <select
                id={`${id}-tpl`}
                className={styles.select}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="">Select…</option>
                <option value="follow_up">Follow up</option>
                <option value="payment">Payment</option>
                <option value="meeting">Meeting prep</option>
              </select>
            </div>
            <div className={styles.toggleRow}>
              <span className={styles.label}>Send Instant</span>
              <button
                type="button"
                className={`${styles.switch} ${sendInstant ? styles.switchOn : ""}`}
                onClick={() => setSendInstant((v) => !v)}
                aria-pressed={sendInstant}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-rt`}>
              Title <span className={styles.req}>*</span>
            </label>
            <input
              id={`${id}-rt`}
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter Title"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-rm`}>
              Message <span className={styles.req}>*</span>
            </label>
            <textarea
              id={`${id}-rm`}
              className={styles.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter Message"
              required
            />
          </div>
          <p className={styles.sectionTitle}>Automation</p>
          <div className={styles.toggleRow}>
            <span className={styles.label}>Whatsapp Automation</span>
            <button
              type="button"
              className={`${styles.switch} ${waAuto ? styles.switchOn : ""}`}
              onClick={() => setWaAuto((v) => !v)}
              aria-pressed={waAuto}
            >
              <span className={styles.switchKnob} />
            </button>
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </form>
    </CrmShellModal>
  );
}

export function QuickMeetingModal({ open, onClose }) {
  return <MeetingFormModal open={open} onClose={onClose} initialMeeting={null} />;
}

export function QuickNoteModal({ open, onClose }) {
  const id = useId();
  useAuth();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const reset = useCallback(() => {
    setContent("");
    setErr("");
    setSaving(false);
  }, []);

  useResetOnOpen(open, reset);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!content.trim()) {
      setErr("Notes are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/v2/notes", {
        method: "POST",
        body: JSON.stringify({
          title: null,
          content: content.trim(),
          lead_id: null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not save note");
        return;
      }
      reset();
      onClose?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShellModal open={open} title="Add Notes" onClose={onClose}>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-nb`}>
              Notes <span className={styles.req}>*</span>
            </label>
            <textarea
              id={`${id}-nb`}
              className={styles.textarea}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter Notes"
              required
              rows={8}
            />
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </form>
    </CrmShellModal>
  );
}

/**
 * Mount once in dashboard layout. Uses QuickCreateContext (header + /…/new routes).
 */
export default function QuickCreateLayer() {
  const { active, close } = useQuickCreate();
  return (
    <>
      <AddLeadModal open={active === "lead"} onClose={close} onCreated={close} />
      <QuickTaskModal open={active === "task"} onClose={close} />
      <QuickReminderModal open={active === "reminder"} onClose={close} />
      <QuickMeetingModal open={active === "meeting"} onClose={close} />
      <QuickTodoModal open={active === "todo"} onClose={close} />
      <QuickNoteModal open={active === "note"} onClose={close} />
    </>
  );
}
