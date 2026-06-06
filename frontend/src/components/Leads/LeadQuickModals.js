"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import ConvertLeadModal from "./ConvertLeadModal";
import { isLeadConverted } from "./leadConstants";
import styles from "./LeadQuickModals.module.css";

const LABEL_PRESETS = ["Hot", "Warm", "Cold", "VIP", "Enterprise", "Partner", "Inbound"];

const WHATSAPP_TEMPLATES = [
  { id: "greet", label: "Greeting", body: "Hello {{name}}, thank you for contacting us. How may we help you today?" },
  { id: "follow", label: "Follow up", body: "Hi {{name}}, this is a gentle follow-up on your enquiry. Please let us know a convenient time to connect." },
  { id: "quote", label: "Request details", body: "Hi {{name}}, we would like to share more details about your interest. Reply when you are available." },
  { id: "thanks", label: "Thank you", body: "Thank you {{name}}. We appreciate your time and will get back to you shortly." },
  { id: "company", label: "Company intro", body: "Hello {{name}}, regarding {{company}} — we would be happy to assist you further." },
];

const WA_MAX = 250;

function initPhoneFields(lead) {
  const dial = (lead.phone_dial && String(lead.phone_dial).trim()) || "+91";
  const dDigits = dial.replace(/\D/g, "");
  let digits = String(lead.phone || "").replace(/\D/g, "");
  if (digits.startsWith(dDigits)) {
    digits = digits.slice(dDigits.length);
  }
  digits = digits.replace(/^0+/, "");
  return { dial: dial.startsWith("+") ? dial : `+${dDigits}`, local: digits };
}

function buildWaMeDigits(dial, localDigits) {
  const cc = dial.replace(/\D/g, "");
  const num = String(localDigits || "").replace(/\D/g, "").replace(/^0+/, "");
  return `${cc}${num}`;
}

function applyWaTemplate(body, lead) {
  return String(body || "")
    .replace(/\{\{name\}\}/g, lead.name || "")
    .replace(/\{\{company\}\}/g, lead.company_name || "your company")
    .replace(/\{\{phone\}\}/g, lead.phone || "");
}

/** Single-line, max length; strips control chars (365-style constraints). */
function sanitizeWaText(s) {
  return String(s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WA_MAX);
}

/**
 * @param {{ type: string, lead: object } | null} modal
 * @param onClose
 * @param {Array} users — from GET /api/users
 * @param {Array} statuses — { key, label, color }
 * @param onDone — refresh list
 * @param onLeadPatch — (partial lead row) merge into UI
 */
export default function LeadQuickModals({
  modal,
  onClose,
  users = [],
  statuses = [],
  onDone,
  onLeadPatch,
  onConvertLead,
}) {
  if (!modal?.lead) return null;

  const { type, lead } = modal;

  return (
    <>
      {type === "label" && (
        <LabelModal lead={lead} onClose={onClose} onDone={onDone} onLeadPatch={onLeadPatch} />
      )}
      {type === "assign" && (
        <AssignModal lead={lead} users={users} onClose={onClose} onDone={onDone} onLeadPatch={onLeadPatch} />
      )}
      {type === "convert" && (
        <ConvertLeadModal lead={lead} onClose={onClose} onDone={onDone} />
      )}
      {type === "link-client" && (
        <LinkClientModal lead={lead} onClose={onClose} onDone={onDone} onLeadPatch={onLeadPatch} />
      )}
      {type === "duplicate" && (
        <DuplicateModal lead={lead} onClose={onClose} onDone={onDone} onLeadPatch={onLeadPatch} />
      )}
      {type === "status" && (
        <StatusModal
          lead={lead}
          statuses={statuses}
          onClose={onClose}
          onDone={onDone}
          onLeadPatch={onLeadPatch}
          onConvertLead={onConvertLead}
        />
      )}
      {type === "followup" && (
        <FollowupModal lead={lead} onClose={onClose} onDone={onDone} />
      )}
      {type === "whatsapp" && <SendWhatsappModal lead={lead} onClose={onClose} />}
    </>
  );
}

function SendWhatsappModal({ lead, onClose }) {
  const init = initPhoneFields(lead);
  const [phoneDial, setPhoneDial] = useState(init.dial);
  const [phoneLocal, setPhoneLocal] = useState(init.local);
  const [templateId, setTemplateId] = useState("");
  const [err, setErr] = useState("");

  const selected = WHATSAPP_TEMPLATES.find((t) => t.id === templateId);
  const rawMessage = selected ? applyWaTemplate(selected.body, lead) : "";
  const message = sanitizeWaText(rawMessage);

  function send() {
    setErr("");
    if (!templateId) {
      setErr("Please select a WhatsApp template.");
      return;
    }
    const waDigits = buildWaMeDigits(phoneDial, phoneLocal);
    if (waDigits.replace(/\D/g, "").length < 10) {
      setErr("Enter a valid mobile number.");
      return;
    }
    const text = message;
    if (!text.length) {
      setErr("Message is empty after applying the template.");
      return;
    }
    const url = `https://wa.me/${waDigits.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="wa-modal-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="wa-modal-title" className={styles.title}>
            Send Whatsapp
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}

          <label className={styles.label}>
            Mobile No.: <span className={styles.req}>*</span>
          </label>
          <div className={styles.phoneRow}>
            <select
              className={styles.dial}
              value={phoneDial}
              onChange={(e) => setPhoneDial(e.target.value)}
              aria-label="Country code"
            >
              <option value="+91">🇮🇳 +91</option>
              <option value="+1">🇺🇸 +1</option>
              <option value="+44">🇬🇧 +44</option>
              <option value="+971">🇦🇪 +971</option>
            </select>
            <input
              className={styles.input}
              type="tel"
              inputMode="numeric"
              placeholder="Phone number"
              value={phoneLocal}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/[^\d\s]/g, ""))}
              autoComplete="tel"
            />
          </div>

          <label className={styles.label} style={{ marginTop: 14 }}>
            Whatsapp Template <span className={styles.req}>*</span>
          </label>
          <select
            className={styles.select}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Select...</option>
            {WHATSAPP_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {templateId ? (
            <>
              <p className={styles.label} style={{ marginTop: 14 }}>
                Message preview
              </p>
              <div className={styles.waPreview}>{message || "—"}</div>
              <p className={styles.waChar}>
                {message.length} / {WA_MAX} characters
              </p>
            </>
          ) : null}

          <div className={styles.waNotes}>
            <strong>Notes:</strong>
            <br />
            Message character limit is {WA_MAX}, and special characters and media are not permitted in this flow.
            Line breaks are converted to spaces for compatibility with WhatsApp Web links.
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function LabelModal({ lead, onClose, onDone, onLeadPatch }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(lead.label || "");
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = LABEL_PRESETS.filter((l) => l.toLowerCase().includes(q.toLowerCase()));

  async function save() {
    const label = (custom.trim() || sel || "").trim() || null;
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch(`/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      onLeadPatch?.(json.data);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Lead Label Assign</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <input
            className={`${styles.input} ${styles.searchInput}`}
            placeholder="Search..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className={styles.labelList}>
            {filtered.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No Lead Label</p>
            ) : (
              filtered.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`${styles.labelOption} ${sel === l ? styles.labelOptionSel : ""}`}
                  onClick={() => {
                    setSel(l);
                    setCustom("");
                  }}
                >
                  {l}
                </button>
              ))
            )}
          </div>
          <label className={styles.label} style={{ marginTop: 12 }}>
            Or type a custom label
          </label>
          <input
            className={styles.input}
            placeholder="Custom label"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setSel("");
            }}
            maxLength={50}
          />
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ lead, users, onClose, onDone, onLeadPatch }) {
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to != null ? String(lead.assigned_to) : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch(`/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: assignedTo || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      onLeadPatch?.(json.data);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Change Lead Assign To</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <label className={styles.label}>
            User: <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <select className={styles.select} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Unassigned</option>
            {users
              .filter((u) => u.is_active !== 0)
              .map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                </option>
              ))}
          </select>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkClientModal({ lead, onClose, onDone, onLeadPatch }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function confirm() {
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch(`/leads/${lead.id}/link-client`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      onLeadPatch?.({ id: lead.id });
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal} style={{ maxWidth: 420 }}>
        <div className={styles.body} style={{ textAlign: "center", paddingTop: 28 }}>
          <div style={{ fontSize: 40, color: "#3b82f6", marginBottom: 12 }}>
            <i className="fas fa-link" />
          </div>
          {err ? <p className={styles.err}>{err}</p> : null}
          <p className={styles.confirmText}>
            Link this lead to a fitness/customer record? This does not create an opportunity.
          </p>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={confirm} disabled={saving}>
            {saving ? "…" : "Link Client"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateModal({ lead, onClose, onDone, onLeadPatch }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function confirm() {
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch(`/leads/${lead.id}/duplicate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      onLeadPatch?.(json.data);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal} style={{ maxWidth: 420 }}>
        <div className={styles.body} style={{ textAlign: "center", paddingTop: 28 }}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <p className={styles.confirmText}>Duplicate lead &quot;{lead.name}&quot; as a new lead?</p>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={confirm} disabled={saving}>
            {saving ? "…" : "Duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusModal({ lead, statuses, onClose, onDone, onLeadPatch, onConvertLead }) {
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const alreadyConverted = isLeadConverted(lead);

  async function pick(st) {
    if (st === lead.status) {
      onClose();
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch(`/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: st }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      onLeadPatch?.({ id: lead.id, status: st });
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Change Lead Status</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.body}>
          {err ? <p className={styles.err}>{err}</p> : null}
          <div className={styles.statusGrid}>
            {statuses.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`${styles.statusBtn} ${lead.status === s.key ? styles.statusBtnActive : ""}`}
                style={{ background: s.color }}
                onClick={() => pick(s.key)}
                disabled={saving}
              >
                {s.label}
                {lead.status === s.key ? <i className="fas fa-check" /> : <span />}
              </button>
            ))}
          </div>
          {!alreadyConverted && (
            <button
              type="button"
              className={styles.convertStatusBtn}
              onClick={() => onConvertLead?.(lead)}
              disabled={saving}
            >
              <i className="fas fa-briefcase" />
              Convert to Opportunity
            </button>
          )}
          {alreadyConverted && lead.converted_opportunity_id && (
            <p className={styles.convertHint}>
              Already converted — opportunity #{lead.converted_opportunity_id}
            </p>
          )}
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FollowupModal({ lead, onClose, onDone }) {
  const [nextAt, setNextAt] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [sendEmail, setSendEmail] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!note.trim()) {
      setErr("Comment is required");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("note", note.trim());
      fd.append("next_follow_up_at", nextAt);
      fd.append("send_email", String(sendEmail));
      files.forEach((f) => fd.append("attachments", f));

      const res = await apiFetch(`/leads/${lead.id}/followup`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Failed");
        return;
      }
      if (sendEmail && json?.mail && !json.mail.ok) {
        const reason = json.mail.detail || json.mail.reason || "unknown";
        setErr(`Follow-up saved, but email not sent: ${reason}`);
        onDone?.();
        return;
      }
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Add Lead Followup</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.body}>
            {err ? <p className={styles.err}>{err}</p> : null}
            <label className={styles.label}>
              Next Followup Date <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              className={styles.input}
              type="datetime-local"
              value={nextAt}
              onChange={(e) => setNextAt(e.target.value)}
              required
            />
            <label className={styles.label} style={{ marginTop: 12 }}>
              Comment / message <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <textarea
              className={styles.textarea}
              placeholder="Enter Message"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
            />
            <label className={styles.label}>Attachment (Optional)</label>
            <div className={styles.attachRow}>
              <div
                className={styles.dropzone}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={(e) => setFiles([...Array.from(e.target.files || [])].slice(0, 5))}
                />
                Drop files here or click — max 5 MB each
                {files.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    {files.map((f, i) => (
                      <div key={i}>{f.name}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <label className={styles.label} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              Send follow-up email to lead {lead.email ? `(${lead.email})` : "(no lead email found)"}
            </label>
            {!lead.email && sendEmail ? (
              <p className={styles.err} style={{ marginTop: 8 }}>
                Lead has no email address. Email cannot be sent for this follow-up.
              </p>
            ) : null}
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
