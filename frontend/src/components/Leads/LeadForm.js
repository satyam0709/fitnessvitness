"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import {
  FORM_STATUSES,
  SOURCES,
  LABEL_OPTIONS,
  PRODUCT_CATEGORIES,
  FOLLOWUP_TYPES,
  ACCOUNT_RELATIONSHIPS,
  OTHER_VALUE,
  buildFieldOptions,
  getLeadStatusSelectValue,
  statusChangeApiBody,
} from "./leadConstants";
import styles from "./AddLeadModal.module.css";

function initSelectWithOther(staticList, customList, currentValue) {
  const options = buildFieldOptions(staticList, customList, { includeOther: true });
  const known = new Set(options.map((o) => o.value));
  if (!currentValue) return { select: "", other: "" };
  if (known.has(currentValue) && currentValue !== OTHER_VALUE) {
    return { select: currentValue, other: "" };
  }
  return { select: OTHER_VALUE, other: currentValue };
}

function resolveSelectWithOther(select, other) {
  if (select === OTHER_VALUE) return other.trim();
  return select;
}

function DropdownWithOther({
  label,
  staticList,
  customList,
  selectValue,
  otherValue,
  onSelectChange,
  onOtherChange,
  includeEmpty,
  emptyLabel,
  required,
}) {
  const options = useMemo(
    () =>
      buildFieldOptions(staticList, customList, {
        includeEmpty,
        includeOther: true,
        emptyLabel,
      }),
    [staticList, customList, includeEmpty, emptyLabel]
  );

  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {required ? <span className={styles.req}> *</span> : null}
      </label>
      <select
        className={styles.select}
        value={selectValue}
        onChange={(e) => onSelectChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={`${o.value}-${o.label}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {selectValue === OTHER_VALUE && (
        <input
          className={styles.input}
          style={{ marginTop: 8 }}
          placeholder="Enter custom value"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
        />
      )}
    </div>
  );
}

/**
 * Shared create/edit lead form.
 * @param {{ mode?: 'create'|'edit', lead?: object, customOptions?: object, onSuccess?: (data) => void, onCancel?: () => void, submitLabel?: string }} props
 */
export default function LeadForm({
  mode = "create",
  lead = null,
  customOptions: customOptionsProp = null,
  existingLeads = [],
  onSuccess,
  onCancel,
  submitLabel,
}) {
  useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dupAck, setDupAck] = useState(false);
  const [teamUsers, setTeamUsers] = useState([]);
  const [customOptions, setCustomOptions] = useState(customOptionsProp || {});
  const fileInputRef = useRef(null);

  const statusInit = initSelectWithOther(
    FORM_STATUSES,
    customOptions.status || [],
    mode === "edit" && lead
      ? getLeadStatusSelectValue(lead)
      : "new"
  );
  const sourceInit = initSelectWithOther(SOURCES, customOptions.source || [], lead?.source || "online");
  const labelInit = initSelectWithOther(LABEL_OPTIONS, customOptions.label || [], lead?.label || "");
  const productInit = initSelectWithOther(
    PRODUCT_CATEGORIES,
    customOptions.product_category || [],
    lead?.product_category || ""
  );
  const followupInit = initSelectWithOther(
    FOLLOWUP_TYPES,
    customOptions.followup_type || [],
    lead?.followup_type || ""
  );
  const relationshipInit = initSelectWithOther(
    ACCOUNT_RELATIONSHIPS,
    customOptions.account_relationship || [],
    lead?.account_relationship || ""
  );

  const [status, setStatus] = useState(statusInit.select);
  const [statusOther, setStatusOther] = useState(statusInit.other);
  const [source, setSource] = useState(sourceInit.select);
  const [sourceOther, setSourceOther] = useState(sourceInit.other);
  const [assignedTo, setAssignedTo] = useState(
    lead?.assigned_to != null ? String(lead.assigned_to) : ""
  );
  const [phoneDial, setPhoneDial] = useState(lead?.phone_dial || "+91");
  const [phone, setPhone] = useState(lead?.phone || "");
  useEffect(() => {
    setDupAck(false);
  }, [phone]);
  const [companyName, setCompanyName] = useState(lead?.company_name || "");
  const [leadDate, setLeadDate] = useState(
    lead?.follow_up_date || new Date().toISOString().slice(0, 10)
  );
  const [customerName, setCustomerName] = useState(lead?.name || "");
  const [email, setEmail] = useState(lead?.email || "");
  const [label, setLabel] = useState(labelInit.select);
  const [labelOther, setLabelOther] = useState(labelInit.other);
  const [reference, setReference] = useState(lead?.reference || "");
  const [address, setAddress] = useState(lead?.address || "");
  const [comment, setComment] = useState(lead?.notes || "");
  const [amount, setAmount] = useState(lead?.amount ? String(lead.amount) : "");
  const [productCategory, setProductCategory] = useState(productInit.select);
  const [productCategoryOther, setProductCategoryOther] = useState(productInit.other);
  const [followupType, setFollowupType] = useState(followupInit.select);
  const [followupTypeOther, setFollowupTypeOther] = useState(followupInit.other);
  const [accountRelationship, setAccountRelationship] = useState(relationshipInit.select);
  const [accountRelationshipOther, setAccountRelationshipOther] = useState(relationshipInit.other);
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (customOptionsProp) setCustomOptions(customOptionsProp);
  }, [customOptionsProp]);

  useEffect(() => {
    // Always refresh once so live picks up registry/discovered customs even if parent passed a stale empty object.
    async function loadOptions() {
      try {
        const res = await apiFetch("/leads/custom-options");
        const json = await res.json();
        if (json.success && json.data) {
          setCustomOptions((prev) => {
            const incoming = json.data || {};
            const prevStatus = prev.status || [];
            const nextStatus = incoming.status || [];
            const byKey = new Map();
            for (const o of [...prevStatus, ...nextStatus]) {
              if (!o?.value) continue;
              byKey.set(String(o.value).toLowerCase(), o);
            }
            return {
              ...prev,
              ...incoming,
              status: [...byKey.values()],
            };
          });
        }
      } catch {
        /* non-fatal */
      }
    }
    loadOptions();
  }, []);

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

    const digits = String(phone).replace(/\D/g, "");
    if (mode === "create" && digits && !dupAck) {
      const matches = (existingLeads || []).filter((l) => {
        const other = String(l.phone || "").replace(/\D/g, "");
        return other && other === digits;
      });
      if (matches.length > 0) {
        setDupAck(true);
        setError(
          `${matches.length} lead(s) already use this number (same person can have multiple leads with different status). Click Submit again to create another.`
        );
        return;
      }
    }

    const resolvedStatus = resolveSelectWithOther(status, statusOther);
    const resolvedSource = resolveSelectWithOther(source, sourceOther);
    const resolvedLabel = resolveSelectWithOther(label, labelOther);
    const resolvedProduct = resolveSelectWithOther(productCategory, productCategoryOther);
    const resolvedFollowup = resolveSelectWithOther(followupType, followupTypeOther);
    const resolvedRelationship = resolveSelectWithOther(accountRelationship, accountRelationshipOther);

    if (status === OTHER_VALUE && !statusOther.trim()) {
      setError("Enter a custom status or pick a built-in status.");
      return;
    }
    if (source === OTHER_VALUE && !sourceOther.trim()) {
      setError("Enter a custom source or pick from the list.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", customerName.trim());
      fd.append("phone", phone.trim());
      fd.append("phone_dial", phoneDial.trim());
      // Always set status + status_v2 together (enum-safe + clears stale custom v2).
      const statusBody = statusChangeApiBody(resolvedStatus);
      fd.append("status", statusBody.status);
      fd.append("status_v2", statusBody.status_v2);
      fd.append("source", resolvedSource || "other");
      if (leadDate) fd.append("follow_up_date", leadDate);
      if (companyName.trim()) fd.append("company_name", companyName.trim());
      if (email.trim()) fd.append("email", email.trim());
      if (resolvedLabel) fd.append("label", resolvedLabel);
      if (reference.trim()) fd.append("reference", reference.trim());
      if (address.trim()) fd.append("address", address.trim());
      if (comment.trim()) fd.append("comment", comment.trim());
      if (assignedTo) fd.append("assigned_to", assignedTo);
      if (amount) fd.append("amount", amount);
      if (resolvedProduct) fd.append("product_category", resolvedProduct);
      if (resolvedFollowup) fd.append("followup_type", resolvedFollowup);
      if (resolvedRelationship) fd.append("account_relationship", resolvedRelationship);
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
          <DropdownWithOther
            label="Status"
            staticList={FORM_STATUSES}
            customList={customOptions.status || []}
            selectValue={status}
            otherValue={statusOther}
            onSelectChange={setStatus}
            onOtherChange={setStatusOther}
          />
          <DropdownWithOther
            label="Source"
            staticList={SOURCES}
            customList={customOptions.source || []}
            selectValue={source}
            otherValue={sourceOther}
            onSelectChange={setSource}
            onOtherChange={setSourceOther}
          />
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
          <DropdownWithOther
            label="Label (Optional)"
            staticList={LABEL_OPTIONS}
            customList={customOptions.label || []}
            selectValue={label}
            otherValue={labelOther}
            onSelectChange={setLabel}
            onOtherChange={setLabelOther}
            includeEmpty
            emptyLabel="Select Label"
          />
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
          <DropdownWithOther
            label="Product Category"
            staticList={PRODUCT_CATEGORIES}
            customList={customOptions.product_category || []}
            selectValue={productCategory}
            otherValue={productCategoryOther}
            onSelectChange={setProductCategory}
            onOtherChange={setProductCategoryOther}
            includeEmpty
            emptyLabel="Select category"
          />
        </div>

        <div className={styles.row2}>
          <DropdownWithOther
            label="Follow-up Type (Optional)"
            staticList={FOLLOWUP_TYPES}
            customList={customOptions.followup_type || []}
            selectValue={followupType}
            otherValue={followupTypeOther}
            onSelectChange={setFollowupType}
            onOtherChange={setFollowupTypeOther}
            includeEmpty
            emptyLabel="Select type"
          />
          <DropdownWithOther
            label="Account Relationship (Optional)"
            staticList={ACCOUNT_RELATIONSHIPS}
            customList={customOptions.account_relationship || []}
            selectValue={accountRelationship}
            otherValue={accountRelationshipOther}
            onSelectChange={setAccountRelationship}
            onOtherChange={setAccountRelationshipOther}
            includeEmpty
            emptyLabel="Select relationship"
          />
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
          {submitting
            ? "Saving…"
            : submitLabel ||
              (mode === "edit"
                ? "Save Changes"
                : dupAck
                  ? "Create anyway"
                  : "Submit")}
        </button>
      </div>
    </form>
  );
}
