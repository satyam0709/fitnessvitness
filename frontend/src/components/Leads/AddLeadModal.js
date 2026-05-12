"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import styles from "./AddLeadModal.module.css";

const STATUSES = [
  { value: "new", label: "New" },
  { value: "processing", label: "Processing" },
  { value: "close_by", label: "Close-by" },
  { value: "confirm", label: "Confirm" },
  { value: "cancel", label: "Cancel" },
];

const SOURCES = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "Whatsapp" },
  { value: "google_form", label: "Google Form" },
  { value: "google_ads", label: "Google Ads" },
  { value: "indiamart", label: "IndiaMart" },
  { value: "website_lead", label: "Website" },
  { value: "customer_reminder", label: "Customer Reminder" },
  { value: "referral", label: "Referral" },
  { value: "99acres", label: "99Acres" },
  { value: "housing", label: "Housing.com" },
  { value: "magicbricks", label: "MagicBricks" },
  { value: "just_dial", label: "Just Dial" },
  { value: "tradeindia", label: "TradeIndia" },
  { value: "other", label: "Other" },
];

const LABELS = ["Hot", "Warm", "Cold", "VIP", "Enterprise"];

export default function AddLeadModal({ open, onClose, onCreated }) {
  useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [teamUsers, setTeamUsers] = useState([]);
  const [meId, setMeId] = useState(null);
  const fileInputRef = useRef(null);

  const [status, setStatus] = useState("new");
  const [source, setSource] = useState("online");
  const [assignedTo, setAssignedTo] = useState("");
  const [phoneDial, setPhoneDial] = useState("+91");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [leadDate, setLeadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!open) return;
    async function load() {
      try {
        const [meRes, usersRes] = await Promise.all([
          apiFetch("/users/me"),
          apiFetch("/users"),
        ]);
        const meJson = await meRes.json();
        const usersJson = await usersRes.json();
        if (meJson.success && meJson.data?.id) {
          setMeId(meJson.data.id);
          setAssignedTo(String(meJson.data.id));
        }
        if (usersJson.success && Array.isArray(usersJson.data)) {
          const active = usersJson.data.filter((u) => u.is_active !== 0);
          setTeamUsers(active);
        }
      } catch {
        setTeamUsers([]);
      }
    }
    load();
  }, [open]);

  function resetForm() {
    setStatus("new");
    setSource("online");
    setPhoneDial("+91");
    setPhone("");
    setCompanyName("");
    setLeadDate(new Date().toISOString().slice(0, 10));
    setCustomerName("");
    setEmail("");
    setLabel("");
    setReference("");
    setAddress("");
    setComment("");
    setFiles([]);
    setError("");
    if (meId) setAssignedTo(String(meId));
  }

  function handleClose() {
    resetForm();
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!phone.trim()) {
      setError("Customer mobile number is required.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", customerName.trim());
      fd.append("phone", phone.trim());
      fd.append("phone_dial", phoneDial.trim());
      fd.append("status", status);
      fd.append("source", source);
      if (leadDate) fd.append("follow_up_date", leadDate);
      if (companyName.trim()) fd.append("company_name", companyName.trim());
      if (email.trim()) fd.append("email", email.trim());
      if (label) fd.append("label", label);
      if (reference.trim()) fd.append("reference", reference.trim());
      if (address.trim()) fd.append("address", address.trim());
      if (comment.trim()) fd.append("comment", comment.trim());
      if (assignedTo) fd.append("assigned_to", assignedTo);

      files.forEach((f) => fd.append("attachments", f));

      const res = await apiFetch("/leads", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Could not create lead.");
        return;
      }
      onCreated?.(json.data);
      resetForm();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files || [])].slice(0, 5));
  }

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="add-lead-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="add-lead-title" className={styles.title}>
            Add Lead
          </h2>
          <button type="button" className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.body}>
            {error ? <p className={styles.err}>{error}</p> : null}

            <div className={styles.row3}>
              <div className={styles.field}>
                <label className={styles.label}>Status</label>
                <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Source</label>
                <select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>User</label>
                <select
                  className={styles.select}
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {teamUsers.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.row3}>
              <div className={styles.field}>
                <label className={styles.label}>
                  Customer Mobile Number <span className={styles.req}>*</span>
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
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Company Name (Optional)</label>
                <input
                  className={styles.input}
                  placeholder="Enter Company Name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Date</label>
                <input
                  className={styles.input}
                  type="date"
                  value={leadDate}
                  onChange={(e) => setLeadDate(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label}>
                  Customer Name <span className={styles.req}>*</span>
                </label>
                <input
                  className={styles.input}
                  placeholder="Enter Customer Name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email (Optional)</label>
                <input
                  className={styles.input}
                  type="email"
                  placeholder="Enter Customer Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label}>Label (Optional)</label>
                <select className={styles.select} value={label} onChange={(e) => setLabel(e.target.value)}>
                  <option value="">Select Label</option>
                  {LABELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Reference (Optional)</label>
                <input
                  className={styles.input}
                  placeholder="Enter Reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Address (Optional)</label>
              <textarea
                className={styles.textarea}
                placeholder="Enter Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Comment (Optional)</label>
              <textarea
                className={styles.textarea}
                placeholder="Enter Comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Attachment (Optional)</label>
              <div className={styles.attachRow}>
                <div className={styles.dropzoneWrap}>
                  <div
                    className={styles.dropzone}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                      hidden
                      onChange={(e) =>
                        setFiles((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, 5))
                      }
                    />
                    <p className={styles.dropHint}>Drop files here or click to upload</p>
                    <p className={styles.dropFormats}>
                      IMAGES, VIDEOS, PDF, DOC, EXCEL, PPT, TEXT — max 5 MB each
                    </p>
                    {files.length > 0 && (
                      <div className={styles.fileRow}>
                        {files.map((f, i) => (
                          <span key={`${f.name}-${i}`} className={styles.fileChip}>
                            {f.name}
                            <button
                              type="button"
                              aria-label="Remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFiles((prev) => prev.filter((_, j) => j !== i));
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.micBtn}
                  title="Voice input (coming soon)"
                  tabIndex={-1}
                  disabled
                >
                  <i className="fas fa-microphone" />
                </button>
              </div>
            </div>
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.btnCancel} onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
