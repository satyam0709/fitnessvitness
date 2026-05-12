"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { useToast } from "@/components/Toast/ToastContext";
import CrmShellModal from "@/components/Dashboard/CrmShellModal";
import styles from "@/components/Dashboard/CrmShellModal.module.css";

const FREQ_OPTS = [
  { key: "once", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half-Yearly" },
  { key: "yearly", label: "Yearly" },
];

function ymdToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function userLabel(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `User #${u.id}`;
}

function useResetOnOpen(open, resetFn) {
  useEffect(() => {
    if (open) resetFn();
  }, [open, resetFn]);
}

export default function QuickTodoModal({ open, onClose }) {
  const id = useId();
  const { showToast } = useToast();
  useAuth();
  const { me } = useUserRole();
  const [users, setUsers] = useState([]);
  const [freq, setFreq] = useState("once");
  const [todoDate, setTodoDate] = useState("");
  const [priority, setPriority] = useState("high");
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [carryForward, setCarryForward] = useState(true);
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const reset = useCallback(() => {
    setFreq("once");
    setTodoDate(ymdToday());
    setPriority("high");
    setAssigneeIds(me?.id ? [String(me.id)] : []);
    setCarryForward(true);
    setBody("");
    setFile(null);
    setErr("");
    setSaving(false);
    setListening(false);
  }, [me?.id]);

  useResetOnOpen(open, reset);

  useEffect(() => {
    if (open && me?.id) {
      setAssigneeIds((prev) => (prev.length ? prev : [String(me.id)]));
    }
  }, [open, me?.id]);

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

  function startVoice() {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setErr("Voice input is not supported in this browser.");
      return;
    }
    if (listening && recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
      setListening(false);
      return;
    }
    setErr("");
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (ev) => {
      const text = Array.from(ev.results)
        .map((x) => x[0]?.transcript)
        .filter(Boolean)
        .join(" ");
      if (text) setBody((b) => (b ? `${b} ${text}` : text));
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = r;
    setListening(true);
    r.start();
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!body.trim()) {
      setErr("Todo text is required.");
      return;
    }
    if (!assigneeIds.length) {
      setErr("Select at least one user.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("body", body.trim());
      fd.append("frequency", freq);
      fd.append("todo_date", todoDate || ymdToday());
      fd.append("priority", priority);
      fd.append("carry_forward", carryForward ? "1" : "0");
      assigneeIds.forEach((uid) => fd.append("assignee_ids[]", uid));
      if (file) fd.append("attachment", file);

      const res = await apiFetch("/todos", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not create todo");
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("crm-todos-changed"));
      }
      showToast("Todo added successfully");
      reset();
      onClose?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShellModal open={open} title="Add Todo" onClose={onClose} wide>
      <form className={styles.form} onSubmit={onSubmit} data-gramm="false" data-gramm_editor="false">
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <div className={styles.field}>
            <span className={styles.label}>Frequency</span>
            <div className={styles.radioRow} role="radiogroup">
              {FREQ_OPTS.map((f) => (
                <label key={f.key} className={styles.radioLabel}>
                  <input type="radio" name={`${id}-fq`} checked={freq === f.key} onChange={() => setFreq(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-dt`}>
                Date <span className={styles.req}>*</span>
              </label>
              <input
                id={`${id}-dt`}
                type="date"
                className={styles.input}
                value={todoDate}
                onChange={(e) => setTodoDate(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-pr`}>
                Priority <span className={styles.req}>*</span>
              </label>
              <select
                id={`${id}-pr`}
                className={styles.select}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-us`}>
                User <span className={styles.req}>*</span>
              </label>
              <select
                id={`${id}-us`}
                className={`${styles.select} ${styles.multiSelect}`}
                multiple
                value={assigneeIds}
                onChange={(e) => setAssigneeIds(Array.from(e.target.selectedOptions, (o) => o.value))}
                size={Math.min(6, Math.max(3, users.length || 3))}
              >
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>Hold Ctrl/Cmd to select multiple.</p>
            </div>
            <div className={styles.toggleRow} style={{ alignSelf: "flex-start", marginTop: 28 }}>
              <span className={styles.label}>Carry Forward</span>
              <button
                type="button"
                className={`${styles.switch} ${carryForward ? styles.switchOn : ""}`}
                onClick={() => setCarryForward((v) => !v)}
                aria-pressed={carryForward}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-bd`}>
              Todo <span className={styles.req}>*</span>
            </label>
            <textarea
              id={`${id}-bd`}
              className={styles.textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enter Todo"
              rows={5}
              required
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Attachment (Optional)</span>
            <div className={styles.row2} style={{ alignItems: "stretch" }}>
              <label className={styles.input} style={{ cursor: "pointer", display: "grid", placeItems: "center", minHeight: 100, borderStyle: "dashed" }}>
                <input
                  type="file"
                  hidden
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <span style={{ textAlign: "center", fontSize: 13, color: "var(--muted, #64748b)" }}>
                  {file ? file.name : "Drop file here or click, max 5 MB"}
                </span>
              </label>
              <button
                type="button"
                className={styles.btnCancel}
                style={{ width: 52, minHeight: 100 }}
                onClick={startVoice}
                aria-label="Voice input"
                title="Voice to text"
              >
                <i className={`fas fa-microphone${listening ? " fa-beat" : ""}`} />
              </button>
            </div>
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
