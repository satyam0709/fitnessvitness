"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { FORM_STATUSES, SOURCES, LABEL_PRESETS } from "./leadConstants";
import styles from "./AddLeadModal.module.css";

/**
 * Shared create/edit lead form.
 * @param {{ mode?: 'create'|'edit', lead?: object, onSuccess?: (data) => void, onCancel?: () => void, submitLabel?: string }} props
 */
export default function LeadForm({
  mode = "create",
  lead = null,
  onSuccess,
  onCancel,
  submitLabel,
}) {
  useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [teamUsers, setTeamUsers] = useState([]);
  const [meId, setMeId] = useState(null);
  const fileInputRef = useRef(null);

  const [status, setStatus] = useState(lead?.status || "new");
  const [source, setSource] = useState(lead?.source || "online");
  const [assignedTo, setAssignedTo] = useState(
    lead?.assigned_to != null ? String(lead.assigned_to) : ""
  );
  const [phoneDial, setPhoneDial] = useState(lead?.phone_dial || "+91");
  const [phone, setPhone] = useState(lead?.phone || "");
  const [companyName, setCompanyName] = useState(lead?.company_name || "");
  const [leadDate, setLeadDate] = useState(
    lead?.follow_up_date || new Date().toISOString().slice(0, 10)
  );
  const [customerName, setCustomerName] = useState(lead?.name || "");
  const [email, setEmail] = useState(lead?.email || "");
  const [label, setLabel] = useState(lead?.label || "");
  const [reference, setReference] = useState(lead?.reference || "");
  const [address, setAddress] = useState(lead?.address || "");
  const [comment, setComment] = useState(lead?.notes || "");
  const [amount, setAmount] = useState(lead?.amount ? String(lead.amount) : "");
  const [productCategory, setProductCategory] = useState(lead?.product_category || "");
  const [files, setFiles] = useState([]);

  useEffect(() => {
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
          if (mode === "create" && !assignedTo) {
            setAssignedTo(String(meJson.data.id));
          }
        }
        if (usersJson.success && Array.isArray(usersJson.data)) {
          setTeamUsers(usersJson.data.filter((u) => u.is_active !== 0));
        }
      } catch {
        setTeamUsers([]);
      }
    }
    load();
  }, [mode, assignedTo]);

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
      if (amount) fd.append("amount", amount);
      if (productCategory) fd.append("product_category", productCategory);
      files.forEach((f) => fd.append("attachments", f));

      const url = mode === "edit" && lead?.id ? `/leads/${lead.id}` : "/leads";
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await apiFetch(url, { method, body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Could not save lead.");
        return;
      }
      onSuccess?.(json.data);
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

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.body}>
        {error ? <p className={styles.err}>{error}</p> : null}

        <div className={styles.row3}>
          <div className={styles.field}>
            <label className={styles.label}>Status</label>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              {FORM_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Source</label>
            <select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>User</label>
            <select className={styles.select} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
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
              <select className={styles.dial} value={phoneDial} onChange={(e) => setPhoneDial(e.target.value)}>
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
            <label className={styles.label}>Follow-up Date</label>
            <input className={styles.input} type="date" value={leadDate} onChange={(e) => setLeadDate(e.target.value)} />
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
            <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Label (Optional)</label>
            <select className={styles.select} value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">Select Label</option>
              {LABEL_PRESETS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Reference (Optional)</label>
            <input className={styles.input} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Amount (Optional)</label>
            <input className={styles.input} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Product Category</label>
            <input className={styles.input} value={productCategory} onChange={(e) => setProductCategory(e.target.value)} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Address (Optional)</label>
          <textarea className={styles.textarea} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Comment (Optional)</label>
          <textarea className={styles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} />
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
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) =>
                    setFiles((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, 5))
                  }
                />
                <p className={styles.dropHint}>Drop files here or click to upload</p>
                {files.length > 0 && (
                  <div className={styles.fileRow}>
                    {files.map((f, i) => (
                      <span key={`${f.name}-${i}`} className={styles.fileChip}>{f.name}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {onCancel && (
          <button type="button" className={styles.btnCancel} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={styles.btnSubmit} disabled={submitting}>
          {submitting ? "Saving…" : submitLabel || (mode === "edit" ? "Save Changes" : "Submit")}
        </button>
      </div>
    </form>
  );
}
