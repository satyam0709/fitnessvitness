"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import CrmShellModal from "@/components/Dashboard/CrmShellModal";
import shell from "@/components/Dashboard/CrmShellModal.module.css";
import local from "./MeetingFormModal.module.css";

function toSqlDateTime(localVal) {
  if (!localVal) return null;
  const s = String(localVal).replace("T", " ");
  if (s.length === 16) return `${s}:00`;
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function userLabel(u) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return n || u.email || `User #${u.id}`;
}

const MEET_FREQ = [
  { key: "once", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half-Yearly" },
  { key: "yearly", label: "Yearly" },
];

const MEETING_TYPES = [
  { value: "virtual", label: "Virtual" },
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

const MEETING_STATUSES = [
  { value: "scheduled", label: "Pending" },
  { value: "postponed", label: "Postponed" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "Missing" },
  { value: "cancelled", label: "Cancelled" },
];

/** Recurrence is stored in DB column `recurrence`; description only holds template + toggles + message */
function buildDescription({ message, template, sendInstant, locationRequired, waAuto }) {
  const parts = [];
  if (template) parts.push(`[template:${template}]`);
  if (sendInstant) parts.push("[instant]");
  if (locationRequired) parts.push("[location_required]");
  if (waAuto) parts.push("[whatsapp:auto]");
  const head = parts.join("\n");
  const msg = (message || "").trim();
  if (head && msg) return `${head}\n${msg}`;
  if (head) return head;
  return msg || null;
}

function parseDescriptionMeta(raw) {
  const d = String(raw || "").trim();
  let freq = "once";
  let template = "";
  let sendInstant = false;
  let locationRequired = false;
  let waAuto = false;
  const lines = d.split("\n");
  const rest = [];
  const reFreq =
    /^\[(once|daily|weekly|monthly|quarterly|half_yearly|yearly)\]$/i;
  const reTpl = /^\[template:([^\]]+)\]$/i;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const fm = t.match(reFreq);
    if (fm) {
      freq = fm[1].toLowerCase();
      continue;
    }
    const tm = t.match(reTpl);
    if (tm) {
      template = tm[1];
      continue;
    }
    if (t === "[instant]") {
      sendInstant = true;
      continue;
    }
    if (t === "[location_required]") {
      locationRequired = true;
      continue;
    }
    if (t === "[whatsapp:auto]") {
      waAuto = true;
      continue;
    }
    rest.push(line);
  }
  return {
    message: rest.join("\n").trim(),
    freq,
    template,
    sendInstant,
    locationRequired,
    waAuto,
  };
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object | null} props.initialMeeting
 * @param {() => void} [props.onSaved]
 */
export default function MeetingFormModal({ open, onClose, initialMeeting = null, onSaved }) {
  const id = useId();
  useAuth();
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meId, setMeId] = useState(null);

  const [freq, setFreq] = useState("once");
  const [startDt, setStartDt] = useState("");
  const [endDt, setEndDt] = useState("");
  const [attendees, setAttendees] = useState([]);
  const [template, setTemplate] = useState("");
  const [sendInstant, setSendInstant] = useState(false);
  const [locationRequired, setLocationRequired] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [waAuto, setWaAuto] = useState(false);

  const [meetingType, setMeetingType] = useState("virtual");
  const [status, setStatus] = useState("scheduled");
  const [assigneeId, setAssigneeId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [location, setLocation] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const isEdit = Boolean(initialMeeting?.id);

  const reset = useCallback(() => {
    setFreq("once");
    setStartDt("");
    setEndDt("");
    setAttendees([]);
    setTemplate("");
    setSendInstant(false);
    setLocationRequired(false);
    setTitle("");
    setMessage("");
    setWaAuto(false);
    setMeetingType("virtual");
    setStatus("scheduled");
    setAssigneeId("");
    setLeadId("");
    setLocation("");
    setMeetLink("");
    setMoreOpen(false);
    setErr("");
    setSaving(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [meRes, uRes, lRes] = await Promise.all([
          apiFetch("/users/me"),
          apiFetch("/users"),
          apiFetch("/leads?limit=300"),
        ]);
        if (meRes.ok) {
          const j = await meRes.json();
          setMeId(j.data?.id ?? null);
        }
        if (uRes.ok) {
          const j = await uRes.json();
          if (j.success && Array.isArray(j.data)) {
            setUsers(j.data.filter((u) => u.is_active !== 0));
          }
        }
        if (lRes.ok) {
          const j = await lRes.json();
          if (j.success && Array.isArray(j.data)) setLeads(j.data);
          else setLeads([]);
        }
      } catch {
        setUsers([]);
        setLeads([]);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialMeeting?.id) {
      const m = initialMeeting;
      const meta = parseDescriptionMeta(m.description || "");
      setTitle(m.title || "");
      setMessage(meta.message || (m.description || ""));
      setFreq(m.recurrence ? String(m.recurrence).toLowerCase() : meta.freq);
      setTemplate(meta.template);
      setSendInstant(meta.sendInstant);
      setLocationRequired(meta.locationRequired);
      setWaAuto(meta.waAuto);
      setStartDt(toLocalInput(m.start_time));
      setEndDt(toLocalInput(m.end_time));
      setLocation(m.location || "");
      setMeetLink(m.meet_link || "");
      setMeetingType(m.meeting_type || "virtual");
      setStatus(m.status || "scheduled");
      setAssigneeId(m.assigned_to_user_id != null ? String(m.assigned_to_user_id) : String(m.organizer_id || ""));
      setLeadId(m.lead_id != null ? String(m.lead_id) : "");
      const csv = m.attendee_ids_csv;
      if (csv) setAttendees(String(csv).split(",").filter(Boolean));
      else setAttendees([]);
      setMoreOpen(true);
      setErr("");
    } else {
      reset();
    }
  }, [open, initialMeeting, reset]);

  useEffect(() => {
    if (!open || isEdit || meId == null) return;
    setAttendees((prev) => (prev.length === 0 ? [String(meId)] : prev));
  }, [open, isEdit, meId]);

  function addAttendee(uid) {
    if (!uid) return;
    const s = String(uid);
    setAttendees((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }

  function removeAttendee(uid) {
    setAttendees((prev) => prev.filter((x) => x !== String(uid)));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (!message.trim()) {
      setErr("Message is required.");
      return;
    }
    if (!startDt) {
      setErr("Date is required.");
      return;
    }
    if (attendees.length === 0) {
      setErr("Select at least one user.");
      return;
    }
    if (locationRequired && !location.trim()) {
      setErr("Location is required when “Location required” is on.");
      return;
    }

    const description = buildDescription({
      message,
      template,
      sendInstant,
      locationRequired,
      waAuto,
    });

    const primaryAssignee =
      assigneeId && attendees.includes(String(assigneeId))
        ? Number(assigneeId)
        : attendees[0]
          ? Number(attendees[0])
          : meId;

    const body = {
      title: title.trim(),
      description,
      recurrence: freq,
      start_time: toSqlDateTime(startDt),
      end_time: toSqlDateTime(endDt || "") || null,
      location: location.trim() || null,
      meet_link: meetLink.trim() || null,
      meeting_type: meetingType,
      status,
      lead_id: leadId ? Number(leadId) : null,
      attendees: attendees.map(Number).filter((n) => n > 0),
    };
    if (primaryAssignee) body.assigned_to_user_id = primaryAssignee;

    setSaving(true);
    try {
      const url = isEdit ? `/meetings/${initialMeeting.id}` : "/meetings";
      const res = await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not save meeting");
        return;
      }
      onSaved?.();
      if (!isEdit) reset();
      onClose?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  const usersById = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(String(u.id), u);
    return m;
  }, [users]);

  const addableUsers = users.filter((u) => !attendees.includes(String(u.id)));

  return (
    <CrmShellModal open={open} title={isEdit ? "Edit Meeting" : "Add Meeting"} onClose={onClose} wide>
      <form className={shell.form} onSubmit={onSubmit}>
        <div className={shell.body}>
          {err ? <p className={shell.err}>{err}</p> : null}

          <div className={local.recurrenceBlock}>
            <span className={shell.label}>Meeting recurrence</span>
            <div className={local.radioRow} role="radiogroup" aria-label="Recurrence">
              {MEET_FREQ.map((f) => (
                <label key={f.key} className={local.radioLabel}>
                  <input
                    type="radio"
                    name={`${id}-mf`}
                    checked={freq === f.key}
                    onChange={() => setFreq(f.key)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <p className={local.hint}>
              Recurrence flags are stored in the meeting record until full scheduling automation is available.
            </p>
          </div>

          <div className={shell.field}>
            <label className={shell.label} htmlFor={`${id}-date`}>
              Date <span className={shell.req}>*</span>
            </label>
            <input
              id={`${id}-date`}
              type="datetime-local"
              className={shell.input}
              value={startDt}
              onChange={(e) => setStartDt(e.target.value)}
              placeholder="dd-mm-yyyy --:--"
              required
            />
            <p className={shell.hint}>Use your browser date picker (format follows your locale).</p>
          </div>

          <div className={shell.field}>
            <span className={shell.label}>
              User <span className={shell.req}>*</span>
            </span>
            <div className={local.chipsWrap} aria-label="Selected users">
              {attendees.length === 0 ? (
                <span className={shell.hint}>Add at least one participant.</span>
              ) : (
                attendees.map((uid) => {
                  const u = usersById.get(String(uid));
                  return (
                    <span key={uid} className={local.chip}>
                      {u ? userLabel(u) : `User ${uid}`}
                      <button
                        type="button"
                        className={local.chipRemove}
                        onClick={() => removeAttendee(uid)}
                        aria-label={`Remove ${u ? userLabel(u) : uid}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })
              )}
            </div>
            <div className={local.addUserRow}>
              <select
                id={`${id}-addu`}
                key={`add-user-${attendees.join(",")}`}
                className={`${shell.select} ${local.addUserSelect}`}
                defaultValue=""
                aria-label="Add user"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) addAttendee(v);
                }}
              >
                <option value="">Select — Add user…</option>
                {addableUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <p className={shell.hint}>First user is the primary assignee. Organizer is included if selected.</p>
          </div>

          <div className={shell.row2}>
            <div className={shell.field}>
              <label className={shell.label} htmlFor={`${id}-mtpl`}>
                Meeting template
              </label>
              <select
                id={`${id}-mtpl`}
                className={shell.select}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="">Select…</option>
                <option value="standup">Stand-up</option>
                <option value="sales">Sales call</option>
                <option value="support">Support</option>
              </select>
            </div>
            <div className={local.togglePair}>
              <div className={shell.toggleRow}>
                <span className={shell.label}>Send instant</span>
                <button
                  type="button"
                  className={`${shell.switch} ${sendInstant ? shell.switchOn : ""}`}
                  onClick={() => setSendInstant((v) => !v)}
                  aria-pressed={sendInstant}
                >
                  <span className={shell.switchKnob} />
                </button>
              </div>
              <div className={shell.toggleRow}>
                <span className={shell.label}>Location required</span>
                <button
                  type="button"
                  className={`${shell.switch} ${locationRequired ? shell.switchOn : ""}`}
                  onClick={() => setLocationRequired((v) => !v)}
                  aria-pressed={locationRequired}
                >
                  <span className={shell.switchKnob} />
                </button>
              </div>
            </div>
          </div>

          <div className={shell.field}>
            <label className={shell.label} htmlFor={`${id}-mt`}>
              Title <span className={shell.req}>*</span>
            </label>
            <input
              id={`${id}-mt`}
              className={shell.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter Title"
              required
            />
          </div>

          <div className={shell.field}>
            <label className={shell.label} htmlFor={`${id}-mm`}>
              Message <span className={shell.req}>*</span>
            </label>
            <textarea
              id={`${id}-mm`}
              className={shell.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter Message"
              required
              rows={5}
            />
          </div>

          <p className={shell.sectionTitle}>Automation</p>
          <div className={shell.toggleRow}>
            <span className={shell.label}>Whatsapp automation</span>
            <button
              type="button"
              className={`${shell.switch} ${waAuto ? shell.switchOn : ""}`}
              onClick={() => setWaAuto((v) => !v)}
              aria-pressed={waAuto}
            >
              <span className={shell.switchKnob} />
            </button>
          </div>

          <button type="button" className={local.detailsToggle} onClick={() => setMoreOpen((v) => !v)}>
            {moreOpen ? "▼ Hide scheduling details" : "▶ Scheduling details (type, status, lead, link…)"}
          </button>

          {moreOpen ? (
            <div className={local.detailsPanel}>
              <div className={shell.row2}>
                <div className={shell.field}>
                  <label className={shell.label} htmlFor={`${id}-mtype`}>Type</label>
                  <select
                    id={`${id}-mtype`}
                    className={shell.select}
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                  >
                    {MEETING_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={shell.field}>
                  <label className={shell.label} htmlFor={`${id}-mst`}>Status</label>
                  <select
                    id={`${id}-mst`}
                    className={shell.select}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {MEETING_STATUSES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-mas`}>Primary assignee (override)</label>
                <select
                  id={`${id}-mas`}
                  className={shell.select}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">Use first user in list</option>
                  {attendees.map((uid) => {
                    const u = usersById.get(String(uid));
                    return (
                      <option key={uid} value={String(uid)}>
                        {u ? userLabel(u) : uid}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className={shell.row2}>
                <div className={shell.field}>
                  <label className={shell.label} htmlFor={`${id}-me`}>End</label>
                  <input
                    id={`${id}-me`}
                    type="datetime-local"
                    className={shell.input}
                    value={endDt}
                    onChange={(e) => setEndDt(e.target.value)}
                  />
                </div>
                <div className={shell.field}>
                  <label className={shell.label} htmlFor={`${id}-mloc`}>Location</label>
                  <input
                    id={`${id}-mloc`}
                    className={shell.input}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Office, address…"
                  />
                </div>
              </div>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-mlink`}>Meet link</label>
                <input
                  id={`${id}-mlink`}
                  className={shell.input}
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className={shell.field}>
                <label className={shell.label} htmlFor={`${id}-mlead`}>Related lead</label>
                <select
                  id={`${id}-mlead`}
                  className={shell.select}
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                >
                  <option value="">None</option>
                  {leads.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {(l.name || "Lead") + (l.phone ? ` · ${l.phone}` : "")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>
        <div className={shell.footer}>
          <button type="button" className={shell.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={shell.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Submit"}
          </button>
        </div>
      </form>
    </CrmShellModal>
  );
}
