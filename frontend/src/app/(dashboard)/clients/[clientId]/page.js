"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { connectGlobalSocket } from "@/lib/api";
import {
  getClient, updateClient, deleteClient,
  createConsultation, deleteConsultation,
  createClientTask, updateClientTask, patchClientTaskStatus, deleteClientTask,
  createSupplement, updateSupplement, deleteSupplement,
  createTransaction, updateTransaction,
  createReferral, deleteReferral,
  searchClients
} from "@/lib/fitnessApi";
import styles from "./client.module.css";

const STATUS_OPTIONS = ["Active", "Hold", "Inactive"];
const PROGRESS_OPTIONS = ["Very Good", "Good", "Neutral", "Poor", "Very Poor"];
const SOURCE_OPTIONS = ["BNI", "Instagram", "Facebook", "Referral - Existing Client", "Friend / Family", "Walk-in", "Online / Website", "Corporate / Company"];
const PLAN_TYPES = ["1 Month Plan", "3 Month Plan", "6 Month Plan", "1 Year Plan"];
const CONSULT_TYPES = ["Onboarding", "Diet Review", "Check-in", "Follow-up", "Other"];
const TASK_PRIORITIES = ["High", "Medium", "Low"];
const TASK_STATUSES = ["Open", "In Progress", "Done", "Carried Forward", "Overdue"];
const TASK_PERIODS = ["This Week", "Next Week", "This Month", "Before Expiry", "Week 1"];
const TRANSACTION_TYPES = ["Membership", "Supplement", "Other"];
const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const DATE_FIELDS = new Set([
  "last_consultation_date",
  "plan_start_date",
  "plan_expiry_date",
  "next_due_date",
]);
const SECTION_FIELDS = {
  key: ["last_consultation_date", "progress", "status", "plan_type", "follow_up_freq_days", "tier", "source"],
  personal: ["full_name", "age", "phone", "city", "email", "address", "occupation", "referred_by_name", "emergency_contact"],
  plan: ["health_goal", "plan_type", "plan_start_date", "plan_expiry_date", "next_due_date", "medical_conditions", "allergies", "activity_level", "current_medications"],
  body: ["height_cm", "current_weight_kg", "start_weight_kg", "target_weight_kg"],
  notes: ["coach_notes"],
};

function formatDate(d) { 
  if (!d) return "—"; 
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }); 
}

function formatDateForInput(dateStr) {
  if (!dateStr) return "";
  return dateStr.split("T")[0];
}

function isDateOverdue(isoOrDate) {
  if (!isoOrDate) return false;
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return false;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d < t;
}

function tierStars(tier) {
  const n = Math.min(5, Math.max(0, Number(tier) || 0));
  return "⭐".repeat(n);
}

/** Portaled modal — avoids broken `position:fixed` inside animated dashboard layout. */
function ClientPageModal({ open, onClose, title, children, titleId, disableClose = false }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !disableClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, disableClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="presentation"
      onClick={() => !disableClose && onClose()}
    >
      <div
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            disabled={disableClose}
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params?.clientId;
  const { isSignedIn, isLoaded } = useAuth();

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingSections, setEditingSections] = useState({});
  const [sectionDrafts, setSectionDrafts] = useState({});
  const [sectionSaving, setSectionSaving] = useState({});
  const [error, setError] = useState(null);

  // Modal states
  const [showAddConsult, setShowAddConsult] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddSupplement, setShowAddSupplement] = useState(false);
  const [showEditSupplement, setShowEditSupplement] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showEditTransaction, setShowEditTransaction] = useState(false);
  const [showEditConsult, setShowEditConsult] = useState(false);
  const [showEditTask, setShowEditTask] = useState(false);
  const [showAddReferral, setShowAddReferral] = useState(false);
  
  // Search state for referrals
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deletePanelRef = useRef(null);

  // Form states
  const [consultForm, setConsultForm] = useState({
    consult_date: new Date().toISOString().split("T")[0],
    consult_type: "Check-in",
    weight_kg: "",
    key_observations: "",
    diet_changes: "",
    next_steps: "",
    next_appointment: "",
  });
  const [taskForm, setTaskForm] = useState({
    task_description: "",
    due_date: "",
    priority: "Medium",
    status: "Open",
    period: "",
    notes: "",
  });
  const [suppForm, setSuppForm] = useState({ product_name: "", prescribed_date: new Date().toISOString().split('T')[0], quantity: "", mrp_inr: "", rate_inr: "", notes: "" });
  const [transForm, setTransForm] = useState({
    transaction_date: new Date().toISOString().split("T")[0],
    product_plan: "",
    type: "Membership",
    mrp_inr: "",
    rate_inr: "",
    received_inr: "",
    pending_inr: "",
    cost_inr: "",
    pay_mode: "GPay",
    notes: "",
  });
  const [editTransForm, setEditTransForm] = useState({ id: null });
  const [editConsultForm, setEditConsultForm] = useState({ id: null });
  const [editTaskForm, setEditTaskForm] = useState({ id: null });
  const [editSuppForm, setEditSuppForm] = useState({ id: null });
  const [referralForm, setReferralForm] = useState({ referred_client_id: "" });

  const loadClient = useCallback(async (opts = {}) => {
    const quiet = opts.quiet === true;
    if (!clientId) return;
    try {
      if (!quiet) setLoading(true);
      setError(null);
      const data = await getClient(clientId);
      setClient(data);
    } catch (err) {
      if (!quiet) setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    loadClient();
  }, [loadClient]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clientId) return undefined;
    let cancelled = false;
    let cleanupFn;

    async function initSocket() {
      const s = await connectGlobalSocket(true);
      if (cancelled || !s) return undefined;
      const onFitness = () => {
        if (!cancelled) loadClient({ quiet: true });
      };
      s.on("fitness:changed", onFitness);
      return () => {
        s.off("fitness:changed", onFitness);
      };
    }

    initSocket().then((fn) => {
      cleanupFn = fn;
    });

    return () => {
      cancelled = true;
      if (typeof cleanupFn === "function") cleanupFn();
    };
  }, [isLoaded, isSignedIn, clientId, loadClient]);

  const draftValueForField = (field) => {
    const value = client?.[field];
    if (DATE_FIELDS.has(field)) return formatDateForInput(value);
    return value ?? "";
  };

  const startSectionEdit = (sectionKey, fields) => {
    const draft = {};
    fields.forEach((field) => {
      draft[field] = draftValueForField(field);
    });
    setSectionDrafts((prev) => ({ ...prev, [sectionKey]: draft }));
    setEditingSections((prev) => ({ ...prev, [sectionKey]: true }));
  };

  const cancelSectionEdit = (sectionKey) => {
    setEditingSections((prev) => ({ ...prev, [sectionKey]: false }));
    setSectionDrafts((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
  };

  const updateSectionDraft = (sectionKey, field, value) => {
    setSectionDrafts((prev) => ({
      ...prev,
      [sectionKey]: {
        ...(prev[sectionKey] || {}),
        [field]: value,
      },
    }));
  };

  const saveSectionEdit = async (sectionKey) => {
    const draft = sectionDrafts[sectionKey] || {};
    setSectionSaving((prev) => ({ ...prev, [sectionKey]: true }));
    try {
      await updateClient(clientId, draft);
      setEditingSections((prev) => ({ ...prev, [sectionKey]: false }));
      await loadClient({ quiet: true });
    } catch (err) {
      alert(err.message || "Could not save changes");
    } finally {
      setSectionSaving((prev) => ({ ...prev, [sectionKey]: false }));
    }
  };

  const SectionActions = ({ sectionKey, fields }) => {
    const editing = !!editingSections[sectionKey];
    const busy = !!sectionSaving[sectionKey];
    return (
      <div className={styles.sectionActions}>
        {editing ? (
          <>
            <button type="button" className={styles.sectionCancelBtn} disabled={busy} onClick={() => cancelSectionEdit(sectionKey)}>
              Cancel
            </button>
            <button type="button" className={styles.sectionSaveBtn} disabled={busy} onClick={() => saveSectionEdit(sectionKey)}>
              {busy ? "Saving..." : "Save"}
            </button>
          </>
        ) : (
          <button type="button" className={styles.sectionEditBtn} onClick={() => startSectionEdit(sectionKey, fields)}>
            <i className="fa-solid fa-pen"></i> Edit
          </button>
        )}
      </div>
    );
  };

  const EditableCell = ({ sectionKey, field, value, type = "text", options = null, readOnly = false }) => {
    const isEditing = !!editingSections[sectionKey] && !readOnly;
    const currentValue = sectionDrafts[sectionKey]?.[field] ?? "";

    if (isEditing && options) {
      return (
        <td className={styles.editable}>
          <select
            className={styles.editInput}
            value={currentValue}
            onChange={(e) => updateSectionDraft(sectionKey, field, e.target.value)}
          >
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </td>
      );
    }

    if (isEditing) {
      return (
        <td className={styles.editable}>
          <input
            type={type}
            className={styles.editInput}
            value={currentValue}
            onChange={(e) => updateSectionDraft(sectionKey, field, e.target.value)}
          />
        </td>
      );
    }

    return <td>{type === "date" ? formatDate(value) : value || "—"}</td>;
  };

  const DetailField = ({ sectionKey, label, field, value, type = "text", options = null, readOnly = false }) => {
    const isEditing = !!editingSections[sectionKey] && !readOnly;
    const currentValue = sectionDrafts[sectionKey]?.[field] ?? "";

    return (
      <div className={styles.detailItem}>
        <div className={styles.detailLabel}>{label}</div>
        <div className={styles.detailValue}>
          {isEditing && options ? (
            <select
              className={styles.editInput}
              style={{ textAlign: 'left' }}
              value={currentValue}
              onChange={(e) => updateSectionDraft(sectionKey, field, e.target.value)}
            >
              {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : isEditing ? (
            <input
              type={type}
              className={styles.editInput}
              style={{ textAlign: 'left' }}
              value={currentValue}
              onChange={(e) => updateSectionDraft(sectionKey, field, e.target.value)}
            />
          ) : (
            <div style={{ width: '100%', minHeight: '20px' }}>
              {type === "date" ? formatDate(value) : value || "—"}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Sub-record handlers
  const handleAddConsultation = async (e) => {
    e.preventDefault();
    try {
      await createConsultation(clientId, consultForm);
      setShowAddConsult(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    try {
      await createClientTask(clientId, taskForm);
      setShowAddTask(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const handleAddSupplement = async (e) => {
    e.preventDefault();
    try {
      await createSupplement(clientId, suppForm);
      setShowAddSupplement(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    try {
      await createTransaction({
        client_id: clientId,
        transaction_date: transForm.transaction_date,
        product_plan: transForm.product_plan,
        type: transForm.type,
        mrp_inr: transForm.mrp_inr === "" ? undefined : Number(transForm.mrp_inr),
        rate_inr: transForm.rate_inr === "" ? undefined : Number(transForm.rate_inr),
        received_inr: transForm.received_inr === "" ? 0 : Number(transForm.received_inr),
        pending_inr: transForm.pending_inr === "" ? 0 : Number(transForm.pending_inr),
        cost_inr: transForm.cost_inr === "" ? 0 : Number(transForm.cost_inr),
        pay_mode: transForm.pay_mode,
        notes: transForm.notes || undefined,
      });
      setShowAddTransaction(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const openEditTransaction = (tx) => {
    setEditTransForm({
      id: tx.id,
      transaction_date: formatDateForInput(tx.transaction_date),
      product_plan: tx.product_plan || "",
      type: tx.type || "Membership",
      mrp_inr: tx.mrp_inr ?? "",
      rate_inr: tx.rate_inr ?? "",
      received_inr: tx.received_inr ?? "",
      pending_inr: tx.pending_inr ?? "",
      cost_inr: tx.cost_inr ?? "",
      pay_mode: tx.pay_mode || "GPay",
      notes: tx.notes || "",
    });
    setShowEditTransaction(true);
  };

  const handleEditTransaction = async (e) => {
    e.preventDefault();
    if (!editTransForm.id) return;
    try {
      await updateTransaction(editTransForm.id, {
        transaction_date: editTransForm.transaction_date,
        product_plan: editTransForm.product_plan,
        type: editTransForm.type,
        mrp_inr: editTransForm.mrp_inr === "" ? null : Number(editTransForm.mrp_inr),
        rate_inr: editTransForm.rate_inr === "" ? null : Number(editTransForm.rate_inr),
        received_inr: editTransForm.received_inr === "" ? 0 : Number(editTransForm.received_inr),
        pending_inr: editTransForm.pending_inr === "" ? 0 : Number(editTransForm.pending_inr),
        cost_inr: editTransForm.cost_inr === "" ? 0 : Number(editTransForm.cost_inr),
        pay_mode: editTransForm.pay_mode,
        notes: editTransForm.notes || null,
      });
      setShowEditTransaction(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const openEditConsultation = (consult) => {
    setEditConsultForm({
      id: consult.id,
      consult_date: formatDateForInput(consult.consult_date),
      consult_type: consult.consult_type || "Check-in",
      weight_kg: consult.weight_kg ?? "",
      key_observations: consult.key_observations || "",
      diet_changes: consult.diet_changes || "",
      next_steps: consult.next_steps || "",
      next_appointment: consult.next_appointment || "",
    });
    setShowEditConsult(true);
  };

  const handleEditConsultation = async (e) => {
    e.preventDefault();
    if (!editConsultForm.id) return;
    try {
      await updateConsultation(editConsultForm.id, {
        consult_date: editConsultForm.consult_date,
        consult_type: editConsultForm.consult_type,
        weight_kg: editConsultForm.weight_kg === "" ? null : Number(editConsultForm.weight_kg),
        key_observations: editConsultForm.key_observations || null,
        diet_changes: editConsultForm.diet_changes || null,
        next_steps: editConsultForm.next_steps || null,
        next_appointment: editConsultForm.next_appointment || null,
      });
      setShowEditConsult(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const openEditTask = (task) => {
    setEditTaskForm({
      id: task.id,
      task_description: task.task_description || "",
      due_date: formatDateForInput(task.due_date),
      priority: task.priority || "Medium",
      status: task.status || "Open",
      period: task.period || "",
      completed_on: formatDateForInput(task.completed_on),
      notes: task.notes || "",
    });
    setShowEditTask(true);
  };

  const handleEditTask = async (e) => {
    e.preventDefault();
    if (!editTaskForm.id) return;
    try {
      await updateClientTask(editTaskForm.id, {
        task_description: editTaskForm.task_description,
        due_date: editTaskForm.due_date || null,
        priority: editTaskForm.priority,
        status: editTaskForm.status,
        period: editTaskForm.period || null,
        completed_on: editTaskForm.completed_on || null,
        notes: editTaskForm.notes || null,
      });
      setShowEditTask(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const openEditSupplement = (supp) => {
    setEditSuppForm({
      id: supp.id,
      product_name: supp.product_name || "",
      prescribed_date: formatDateForInput(supp.prescribed_date),
      quantity: supp.quantity ?? "",
      mrp_inr: supp.mrp_inr ?? "",
      rate_inr: supp.rate_inr ?? "",
      notes: supp.notes || "",
    });
    setShowEditSupplement(true);
  };

  const handleEditSupplement = async (e) => {
    e.preventDefault();
    if (!editSuppForm.id) return;
    try {
      await updateSupplement(editSuppForm.id, {
        product_name: editSuppForm.product_name,
        prescribed_date: editSuppForm.prescribed_date || null,
        quantity: editSuppForm.quantity === "" ? null : Number(editSuppForm.quantity),
        mrp_inr: editSuppForm.mrp_inr === "" ? null : Number(editSuppForm.mrp_inr),
        rate_inr: editSuppForm.rate_inr === "" ? null : Number(editSuppForm.rate_inr),
        notes: editSuppForm.notes || null,
      });
      setShowEditSupplement(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const handleSearchClients = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) return setSearchResults([]);
    try {
      const res = await searchClients(query);
      setSearchResults(res);
    } catch (err) { console.error(err); }
  };

  const handleAddReferral = async (referredId) => {
    try {
      await createReferral({
        referrer_client_id: clientId,
        referred_client_id: referredId,
      });
      setShowAddReferral(false);
      loadClient({ quiet: true });
    } catch (err) { alert(err.message); }
  };

  const supplementTotals = useMemo(() => {
    const rows = client?.supplements || [];
    let mrp = 0;
    let rate = 0;
    for (const r of rows) {
      mrp += Number(r.mrp_inr) || 0;
      rate += Number(r.rate_inr) || 0;
    }
    return { mrp, rate };
  }, [client?.supplements]);

  const handleTaskStatusToggle = async (task) => {
    const next = task.status === "Done" ? "Open" : "Done";
    const completed_on = next === "Done" ? new Date().toISOString().slice(0, 10) : null;
    try {
      await patchClientTaskStatus(task.id, { status: next, completed_on });
      loadClient({ quiet: true });
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePermanentDelete = async () => {
    if (!client?.client_id) return;
    if (deleteConfirm.trim() !== client.client_id) {
      alert(`Type the exact client ID (${client.client_id}) to confirm permanent removal.`);
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteClient(client.client_id);
      setShowDeleteConfirm(false);
      router.push("/clients");
    } catch (err) {
      alert(err.message || "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  useEffect(() => {
    if (!showDeleteConfirm || !deletePanelRef.current) return;
    deletePanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [showDeleteConfirm]);

  if (loading) return <div className={styles.loading}><div className={styles.spinner}></div>Synchronizing profile...</div>;
  if (!client) return <div className={styles.loading}>Client not found or error occurred.</div>;

  return (
    <div className={styles.container}>
      {/* 1. BRAND HEADER */}
      <div className={styles.header}>
        <div className={styles.brand}>
          <i className="fa-solid fa-fire-pulse"></i>
          FITNESS VITNESS
        </div>
        <div className={styles.clientTitle}>
          {client.full_name} <span>|</span> {client.client_id}
        </div>
        <Link href="/clients" className={styles.backLink}>
          <i className="fa-solid fa-arrow-left"></i> Back to Master
        </Link>
      </div>

      <div className={styles.profileGrid}>
        
        {/* 2. KEY FIELDS */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-key"></i>
            Key Fields — These automatically update the Master Sheet
            <SectionActions sectionKey="key" fields={SECTION_FIELDS.key} />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.infoTable}>
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Last Consultation</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Plan Type</th>
                  <th>Plan Expiry</th>
                  <th>Follow-up Freq (days)</th>
                  <th>Client Tier</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{client.client_id}</td>
                  <EditableCell sectionKey="key" field="last_consultation_date" value={formatDateForInput(client.last_consultation_date)} type="date" />
                  <EditableCell sectionKey="key" field="progress" value={client.progress} options={PROGRESS_OPTIONS} />
                  <EditableCell sectionKey="key" field="status" value={client.status} options={STATUS_OPTIONS} />
                  <EditableCell sectionKey="key" field="plan_type" value={client.plan_type} options={PLAN_TYPES} />
                  <td>{formatDate(client.plan_expiry_date)}</td>
                  <EditableCell sectionKey="key" field="follow_up_freq_days" value={client.follow_up_freq_days} type="number" />
                  <EditableCell sectionKey="key" field="tier" value={client.tier} type="number" />
                  <EditableCell sectionKey="key" field="source" value={client.source} options={SOURCE_OPTIONS} />
                </tr>
              </tbody>
            </table>
            <p className={styles.tierHint}>
              Tier display: {tierStars(client.tier)} <span className={styles.tierMuted}>({Number(client.tier) || 0}/5)</span>
            </p>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* 3. PERSONAL DETAILS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-user"></i>
              Personal Details
              <SectionActions sectionKey="personal" fields={SECTION_FIELDS.personal} />
            </div>
            <div className={styles.detailGrid}>
              <DetailField sectionKey="personal" label="Full Name" field="full_name" value={client.full_name} />
              <DetailField sectionKey="personal" label="Age" field="age" value={client.age} type="number" />
              <DetailField sectionKey="personal" label="Client ID" field="client_id" value={client.client_id} readOnly />
              <DetailField sectionKey="personal" label="Phone" field="phone" value={client.phone} />
              <DetailField sectionKey="personal" label="City" field="city" value={client.city} />
              <DetailField sectionKey="personal" label="Email" field="email" value={client.email} />
              <DetailField sectionKey="personal" label="Address" field="address" value={client.address} />
              <DetailField sectionKey="personal" label="Occupation" field="occupation" value={client.occupation} />
              <DetailField sectionKey="personal" label="Referred By" field="referred_by_name" value={client.referred_by_name} />
              <DetailField sectionKey="personal" label="Emergency Contact" field="emergency_contact" value={client.emergency_contact} />
            </div>
          </section>

          {/* 4. PLAN & GOALS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-bullseye"></i>
              Plan & Goals
              <SectionActions sectionKey="plan" fields={SECTION_FIELDS.plan} />
            </div>
            <div className={styles.detailGrid}>
              <DetailField sectionKey="plan" label="Health Goal" field="health_goal" value={client.health_goal} />
              <DetailField sectionKey="plan" label="Plan Type" field="plan_type" value={client.plan_type} options={PLAN_TYPES} />
              <DetailField sectionKey="plan" label="Plan Start Date" field="plan_start_date" value={formatDateForInput(client.plan_start_date)} type="date" />
              <DetailField sectionKey="plan" label="Plan Duration" field="plan_duration" value={client.plan_type ? `${client.plan_type} (Auto)` : "—"} readOnly />
              <DetailField sectionKey="plan" label="Plan Expiry" field="plan_expiry_date" value={formatDateForInput(client.plan_expiry_date)} type="date" />
              <DetailField sectionKey="plan" label="Next Due" field="next_due_date" value={formatDateForInput(client.next_due_date)} type="date" />
              <DetailField sectionKey="plan" label="Days Remaining" field="days_remaining" value={client.days_remaining !== null ? `${client.days_remaining} days` : "—"} readOnly />
              <DetailField sectionKey="plan" label="Medical Conditions" field="medical_conditions" value={client.medical_conditions} />
              <DetailField sectionKey="plan" label="Allergies / Avoid" field="allergies" value={client.allergies} />
              <DetailField sectionKey="plan" label="Activity Level" field="activity_level" value={client.activity_level} />
              <DetailField sectionKey="plan" label="Current Medications" field="current_medications" value={client.current_medications} />
            </div>
          </section>
        </div>

        {/* 5. BODY STATS & BMI */}
        <section className={`${styles.section} ${styles.statSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-chart-line"></i>
            Body Stats & BMI
            <SectionActions sectionKey="body" fields={SECTION_FIELDS.body} />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.infoTable}>
              <thead>
                <tr>
                  <th>Height (cm)</th>
                  <th>Current Weight (kg)</th>
                  <th>BMI</th>
                  <th>Weight Change</th>
                  <th>Start Weight (kg)</th>
                  <th>Target Weight (kg)</th>
                  <th>BMI Category</th>
                  <th>% to Goal</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <EditableCell sectionKey="body" field="height_cm" value={client.height_cm} type="number" />
                  <EditableCell sectionKey="body" field="current_weight_kg" value={client.current_weight_kg} type="number" />
                  <td style={{ fontWeight: 700 }}>{client.bmi || "—"}</td>
                  <td style={{ color: client.weight_change < 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    {client.weight_change !== null ? `${client.weight_change > 0 ? '+' : ''}${client.weight_change} kg` : "—"}
                  </td>
                  <EditableCell sectionKey="body" field="start_weight_kg" value={client.start_weight_kg} type="number" />
                  <EditableCell sectionKey="body" field="target_weight_kg" value={client.target_weight_kg} type="number" />
                  <td className={client.bmi_category?.status === 'good' ? styles.bmiGood : client.bmi_category?.status === 'warning' ? styles.bmiWarning : styles.bmiDanger}>
                    {client.bmi_category?.label || "—"}
                  </td>
                  <td style={{ fontWeight: 700, color: '#10b981' }}>{client.goal_progress || 0}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. REFERRAL DETAILS */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-users"></i>
            Referral Details
            <button className={styles.addBtn} onClick={() => setShowAddReferral(true)}>Add Referral</button>
          </div>
          <div className={styles.referralSummary}>
            <span><strong>{client.referrals_given?.length ?? 0}</strong> referrals given</span>
            <span>Tier {tierStars(client.tier)} <span className={styles.tierMuted}>({Number(client.tier) || 0}/5)</span></span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client Name Referred</th>
                  <th>Client ID</th>
                  <th>Date Referred</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {client.referrals_given?.map((ref, idx) => (
                  <tr key={ref.id}>
                    <td>{idx + 1}</td>
                    <td style={{ fontWeight: 700, color: '#10b981' }}>
                      <Link href={`/clients/${ref.referred_client_id}`} className={styles.profileLink}>
                        {ref.referred_name}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/clients/${ref.referred_client_id}`} className={styles.profileLink}>
                        {ref.referred_client_id}
                      </Link>
                    </td>
                    <td>{formatDate(ref.referral_date)}</td>
                    <td>{ref.notes}</td>
                    <td>
                      <button onClick={async () => { if(confirm("Delete?")) { await deleteReferral(ref.id); loadClient({ quiet: true }); }}} className={styles.deleteBtn}>
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
                {(!client.referrals_given || client.referrals_given.length === 0) && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No referrals recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 7. TASK ENGINE */}
        <section className={`${styles.section} ${styles.taskSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-list-check"></i>
            Task Engine — Create, track & carry forward tasks
            <button className={styles.addBtn} onClick={() => setShowAddTask(true)}>Create Task</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Task Description</th>
                  <th>Due Date</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Period</th>
                  <th>Completed On</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {client.tasks?.map((task) => (
                  <tr key={task.id}>
                    <td>{task.task_description}</td>
                    <td style={isDateOverdue(task.due_date) ? { color: "#ef4444", fontWeight: 600 } : undefined}>
                      {formatDate(task.due_date)}
                    </td>
                    <td className={task.priority === 'High' ? styles.taskHigh : ""}>{task.priority}</td>
                    <td>
                      <button 
                        className={`${styles.statusBadge} ${task.status === 'Done' ? styles.taskDone : styles.taskOpen}`}
                        onClick={() => handleTaskStatusToggle(task)}
                      >
                        {task.status} {task.status === 'Done' ? '✓' : ''}
                      </button>
                    </td>
                    <td>{task.period || "—"}</td>
                    <td>{formatDate(task.completed_on)}</td>
                    <td>{task.notes}</td>
                    <td>
                      <button type="button" className={styles.actionBtn} onClick={() => openEditTask(task)}>
                        <i className="fa-solid fa-pen"></i> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {(!client.tasks || client.tasks.length === 0) && (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No active tasks</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 8. CONSULTATION LOG */}
        <section className={`${styles.section} ${styles.consultSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-clipboard-list"></i>
            Consultation Log — Most recent first
            <button className={styles.addBtn} onClick={() => setShowAddConsult(true)}>Log Session</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Weight (kg)</th>
                  <th>Key Observations</th>
                  <th>Diet Changes Made</th>
                  <th>Next Steps</th>
                  <th>Next Appt</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {client.consultations?.map((consult) => (
                  <tr key={consult.id}>
                    <td>{formatDate(consult.consult_date)}</td>
                    <td>{consult.consult_type}</td>
                    <td>{consult.weight_kg ? `${consult.weight_kg} kg` : "—"}</td>
                    <td>{consult.key_observations}</td>
                    <td>{consult.diet_changes}</td>
                    <td>{consult.next_steps}</td>
                    <td>{consult.next_appointment}</td>
                    <td>
                      <button type="button" className={styles.actionBtn} onClick={() => openEditConsultation(consult)}>
                        <i className="fa-solid fa-pen"></i> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {(!client.consultations || client.consultations.length === 0) && (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No consultation history</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 9. PAYMENT HISTORY */}
        <section className={`${styles.section} ${styles.paymentSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-receipt"></i>
            Payment History — Auto-pulled from Business Tracker
            <button className={styles.addBtn} onClick={() => setShowAddTransaction(true)}>Add Transaction</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product / Plan</th>
                  <th>Type</th>
                  <th>MRP (₹)</th>
                  <th>Rate (₹)</th>
                  <th>Received (₹)</th>
                  <th>Pending (₹)</th>
                  <th>Profit (₹)</th>
                  <th>Mode</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {client.transactions?.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.transaction_date)}</td>
                    <td style={{ fontWeight: 600 }}>{tx.product_plan}</td>
                    <td>{tx.type}</td>
                    <td>₹{tx.mrp_inr != null ? tx.mrp_inr : "—"}</td>
                    <td>₹{tx.rate_inr}</td>
                    <td style={{ color: '#10b981', fontWeight: 600 }}>₹{tx.received_inr}</td>
                    <td style={{ color: tx.pending_inr > 0 ? '#ef4444' : '#64748b' }}>₹{tx.pending_inr}</td>
                    <td>₹{tx.profit_inr}</td>
                    <td>{tx.pay_mode}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => openEditTransaction(tx)}
                        aria-label={`Edit payment ${tx.id}`}
                      >
                        <i className="fa-solid fa-pen"></i> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {(!client.transactions || client.transactions.length === 0) && (
                  <tr><td colSpan="10" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No financial records</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 10. SUPPLEMENTS PRESCRIBED */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-capsules"></i>
            Supplements Prescribed
            <button className={styles.addBtn} onClick={() => setShowAddSupplement(true)}>Prescribe</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Date</th>
                  <th>Qty</th>
                  <th>MRP (₹)</th>
                  <th>Rate (₹)</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {client.supplements?.map((supp) => (
                  <tr key={supp.id}>
                    <td style={{ fontWeight: 600 }}>{supp.product_name}</td>
                    <td>{formatDate(supp.prescribed_date)}</td>
                    <td>{supp.quantity}</td>
                    <td>₹{supp.mrp_inr}</td>
                    <td>₹{supp.rate_inr}</td>
                    <td>{supp.notes}</td>
                    <td>
                      <button type="button" className={styles.actionBtn} onClick={() => openEditSupplement(supp)}>
                        <i className="fa-solid fa-pen"></i> Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {(!client.supplements || client.supplements.length === 0) && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No supplements prescribed</td></tr>
                )}
              </tbody>
              {(client.supplements?.length > 0) && (
                <tfoot>
                  <tr className={styles.supplementTotalsRow}>
                    <td colSpan={3} style={{ fontWeight: 800 }}>Totals</td>
                    <td style={{ fontWeight: 800 }}>₹{Number(supplementTotals.mrp).toLocaleString("en-IN")}</td>
                    <td style={{ fontWeight: 800 }}>₹{Number(supplementTotals.rate).toLocaleString("en-IN")}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* 11. COACH'S PRIVATE NOTES */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-comment-medical"></i>
            Coach's Private Notes
            <SectionActions sectionKey="notes" fields={SECTION_FIELDS.notes} />
          </div>
          <div className={styles.sectionBody}>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
              Write private observations — mindset, lifestyle, family situation, motivation triggers, challenges...
            </p>
            <textarea 
              className={styles.notesArea}
              placeholder="Start typing private notes here..."
              disabled={!editingSections.notes}
              value={editingSections.notes ? (sectionDrafts.notes?.coach_notes ?? "") : (client.coach_notes || "")}
              onChange={(e) => updateSectionDraft("notes", "coach_notes", e.target.value)}
            />
          </div>
        </section>

        <section className={`${styles.section} ${styles.dangerSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-triangle-exclamation"></i>
            Danger zone
          </div>
          <div className={styles.dangerBody}>
            <p>
              Permanently removes this client and all related rows: consultations, transactions, supplements, body stats,
              tasks, meal plans, and referral links. To keep the record but hide it from active work, set Status to
              Inactive instead.
            </p>
            <button
              type="button"
              className={styles.dangerBtn}
              aria-expanded={showDeleteConfirm}
              onClick={() => {
                if (showDeleteConfirm) {
                  setShowDeleteConfirm(false);
                  setDeleteConfirm("");
                } else {
                  setDeleteConfirm("");
                  setShowDeleteConfirm(true);
                }
              }}
            >
              {showDeleteConfirm ? "Cancel delete" : "Delete client from database..."}
            </button>
            {showDeleteConfirm ? (
              <div
                ref={deletePanelRef}
                className={styles.dangerConfirmPanel}
                role="dialog"
                aria-labelledby="delete-client-title"
              >
                <h3 id="delete-client-title" className={styles.dangerConfirmTitle}>
                  Delete client permanently
                </h3>
                <p className={styles.dangerModalText}>
                  This cannot be undone. Type <strong>{client.client_id}</strong> below, then confirm.
                </p>
                <div className={styles.formField}>
                  <label htmlFor="delete-confirm-input">Client ID</label>
                  <input
                    id="delete-confirm-input"
                    type="text"
                    autoComplete="off"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={client.client_id}
                  />
                </div>
                <div className={styles.dangerConfirmActions}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    disabled={deleteBusy}
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirm("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.dangerConfirmBtn}
                    disabled={deleteBusy || deleteConfirm.trim() !== client.client_id}
                    onClick={handlePermanentDelete}
                  >
                    {deleteBusy ? "Removing..." : "Delete permanently"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

      </div>

      {/* CONSULTATION MODAL */}
      <ClientPageModal
        open={showAddConsult}
        onClose={() => setShowAddConsult(false)}
        title="Log Consultation"
        titleId="consult-modal-title"
      >
            <form onSubmit={handleAddConsultation} className={styles.formGrid}>
              <div className={styles.formField}>
                <label>Date</label>
                <input type="date" required value={consultForm.consult_date} onChange={e => setConsultForm({...consultForm, consult_date: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Type</label>
                <select value={consultForm.consult_type} onChange={e => setConsultForm({...consultForm, consult_type: e.target.value})}>
                  {CONSULT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className={styles.formField}>
                <label>Weight (kg)</label>
                <input type="number" step="0.1" value={consultForm.weight_kg} onChange={e => setConsultForm({...consultForm, weight_kg: e.target.value})} />
              </div>
              <div className={styles.formField.full}>
                <label>Key Observations</label>
                <textarea value={consultForm.key_observations} onChange={e => setConsultForm({...consultForm, key_observations: e.target.value})} />
              </div>
              <div className={styles.formField.full}>
                <label>Diet Changes Made</label>
                <textarea value={consultForm.diet_changes} onChange={e => setConsultForm({...consultForm, diet_changes: e.target.value})} />
              </div>
              <div className={styles.formField.full}>
                <label>Next Steps</label>
                <textarea value={consultForm.next_steps} onChange={e => setConsultForm({...consultForm, next_steps: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Next Appt</label>
                <input type="text" value={consultForm.next_appointment} onChange={e => setConsultForm({...consultForm, next_appointment: e.target.value})} placeholder="e.g. 2 weeks" />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddConsult(false)}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Save Consultation</button>
              </div>
            </form>
      </ClientPageModal>

      {/* TASK MODAL */}
      <ClientPageModal
        open={showAddTask}
        onClose={() => setShowAddTask(false)}
        title="Create New Task"
        titleId="task-modal-title"
      >
            <form onSubmit={handleAddTask} className={styles.formGrid}>
              <div className={styles.formField.full}>
                <label>Task Description</label>
                <input type="text" required value={taskForm.task_description} onChange={e => setTaskForm({...taskForm, task_description: e.target.value})} placeholder="e.g. Diet Review Call" />
              </div>
              <div className={styles.formField}>
                <label>Due Date</label>
                <input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Priority</label>
                <select value={taskForm.priority} onChange={e => setTaskForm({...taskForm, priority: e.target.value})}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>Status</label>
                <select value={taskForm.status} onChange={e => setTaskForm({...taskForm, status: e.target.value})}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>Period</label>
                <select value={taskForm.period} onChange={e => setTaskForm({...taskForm, period: e.target.value})}>
                  <option value="">—</option>
                  {TASK_PERIODS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField.full}>
                <label>Notes</label>
                <textarea value={taskForm.notes} onChange={e => setTaskForm({...taskForm, notes: e.target.value})} rows={3} />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddTask(false)}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Create Task</button>
              </div>
            </form>
      </ClientPageModal>

      {/* TRANSACTION MODAL */}
      <ClientPageModal
        open={showAddTransaction}
        onClose={() => setShowAddTransaction(false)}
        title="Add Transaction"
        titleId="transaction-modal-title"
      >
            <form onSubmit={handleAddTransaction} className={styles.formGrid}>
              <div className={styles.formField}>
                <label>Date</label>
                <input type="date" required value={transForm.transaction_date} onChange={e => setTransForm({...transForm, transaction_date: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Product / Plan</label>
                <input type="text" required value={transForm.product_plan} onChange={e => setTransForm({...transForm, product_plan: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Type</label>
                <select value={transForm.type} onChange={e => setTransForm({...transForm, type: e.target.value})}>
                  {TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>MRP (₹)</label>
                <input type="number" min="0" step="0.01" value={transForm.mrp_inr} onChange={e => setTransForm({...transForm, mrp_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Rate (₹)</label>
                <input type="number" required value={transForm.rate_inr} onChange={e => setTransForm({...transForm, rate_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Received (₹)</label>
                <input type="number" value={transForm.received_inr} onChange={e => setTransForm({...transForm, received_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Pending (₹)</label>
                <input type="number" min="0" step="0.01" value={transForm.pending_inr} onChange={e => setTransForm({...transForm, pending_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Cost (₹)</label>
                <input type="number" value={transForm.cost_inr} onChange={e => setTransForm({...transForm, cost_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Payment Mode</label>
                <select value={transForm.pay_mode} onChange={e => setTransForm({...transForm, pay_mode: e.target.value})}>
                  {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className={styles.formField.full}>
                <label>Notes</label>
                <textarea value={transForm.notes} onChange={e => setTransForm({...transForm, notes: e.target.value})} rows={2} />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddTransaction(false)}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Add Record</button>
              </div>
            </form>
      </ClientPageModal>

      {/* EDIT CONSULTATION MODAL */}
      <ClientPageModal
        open={showEditConsult}
        onClose={() => setShowEditConsult(false)}
        title="Edit Consultation"
        titleId="edit-consult-modal-title"
      >
        <form onSubmit={handleEditConsultation} className={styles.formGrid}>
          <div className={styles.formField}>
            <label>Date</label>
            <input type="date" required value={editConsultForm.consult_date || ""} onChange={e => setEditConsultForm({...editConsultForm, consult_date: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Type</label>
            <select value={editConsultForm.consult_type || "Check-in"} onChange={e => setEditConsultForm({...editConsultForm, consult_type: e.target.value})}>
              {CONSULT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label>Weight (kg)</label>
            <input type="number" step="0.1" value={editConsultForm.weight_kg ?? ""} onChange={e => setEditConsultForm({...editConsultForm, weight_kg: e.target.value})} />
          </div>
          <div className={styles.formField.full}>
            <label>Key Observations</label>
            <textarea value={editConsultForm.key_observations || ""} onChange={e => setEditConsultForm({...editConsultForm, key_observations: e.target.value})} />
          </div>
          <div className={styles.formField.full}>
            <label>Diet Changes Made</label>
            <textarea value={editConsultForm.diet_changes || ""} onChange={e => setEditConsultForm({...editConsultForm, diet_changes: e.target.value})} />
          </div>
          <div className={styles.formField.full}>
            <label>Next Steps</label>
            <textarea value={editConsultForm.next_steps || ""} onChange={e => setEditConsultForm({...editConsultForm, next_steps: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Next Appt</label>
            <input type="text" value={editConsultForm.next_appointment || ""} onChange={e => setEditConsultForm({...editConsultForm, next_appointment: e.target.value})} />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowEditConsult(false)}>Cancel</button>
            <button type="submit" className={styles.saveBtn}>Save Changes</button>
          </div>
        </form>
      </ClientPageModal>

      {/* EDIT TASK MODAL */}
      <ClientPageModal
        open={showEditTask}
        onClose={() => setShowEditTask(false)}
        title="Edit Task"
        titleId="edit-task-modal-title"
      >
        <form onSubmit={handleEditTask} className={styles.formGrid}>
          <div className={styles.formField.full}>
            <label>Task Description</label>
            <input type="text" required value={editTaskForm.task_description || ""} onChange={e => setEditTaskForm({...editTaskForm, task_description: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Due Date</label>
            <input type="date" value={editTaskForm.due_date || ""} onChange={e => setEditTaskForm({...editTaskForm, due_date: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Priority</label>
            <select value={editTaskForm.priority || "Medium"} onChange={e => setEditTaskForm({...editTaskForm, priority: e.target.value})}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label>Status</label>
            <select value={editTaskForm.status || "Open"} onChange={e => setEditTaskForm({...editTaskForm, status: e.target.value})}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label>Period</label>
            <select value={editTaskForm.period || ""} onChange={e => setEditTaskForm({...editTaskForm, period: e.target.value})}>
              <option value="">—</option>
              {TASK_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.formField}>
            <label>Completed On</label>
            <input type="date" value={editTaskForm.completed_on || ""} onChange={e => setEditTaskForm({...editTaskForm, completed_on: e.target.value})} />
          </div>
          <div className={styles.formField.full}>
            <label>Notes</label>
            <textarea value={editTaskForm.notes || ""} onChange={e => setEditTaskForm({...editTaskForm, notes: e.target.value})} rows={3} />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowEditTask(false)}>Cancel</button>
            <button type="submit" className={styles.saveBtn}>Save Changes</button>
          </div>
        </form>
      </ClientPageModal>

      {/* EDIT SUPPLEMENT MODAL */}
      <ClientPageModal
        open={showEditSupplement}
        onClose={() => setShowEditSupplement(false)}
        title="Edit Supplement"
        titleId="edit-supplement-modal-title"
      >
        <form onSubmit={handleEditSupplement} className={styles.formGrid}>
          <div className={styles.formField.full}>
            <label>Product Name</label>
            <input type="text" required value={editSuppForm.product_name || ""} onChange={e => setEditSuppForm({...editSuppForm, product_name: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Date</label>
            <input type="date" value={editSuppForm.prescribed_date || ""} onChange={e => setEditSuppForm({...editSuppForm, prescribed_date: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Quantity</label>
            <input type="number" value={editSuppForm.quantity ?? ""} onChange={e => setEditSuppForm({...editSuppForm, quantity: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>MRP (₹)</label>
            <input type="number" min="0" step="0.01" value={editSuppForm.mrp_inr ?? ""} onChange={e => setEditSuppForm({...editSuppForm, mrp_inr: e.target.value})} />
          </div>
          <div className={styles.formField}>
            <label>Rate (₹)</label>
            <input type="number" min="0" step="0.01" value={editSuppForm.rate_inr ?? ""} onChange={e => setEditSuppForm({...editSuppForm, rate_inr: e.target.value})} />
          </div>
          <div className={styles.formField.full}>
            <label>Notes</label>
            <textarea value={editSuppForm.notes || ""} onChange={e => setEditSuppForm({...editSuppForm, notes: e.target.value})} />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowEditSupplement(false)}>Cancel</button>
            <button type="submit" className={styles.saveBtn}>Save Changes</button>
          </div>
        </form>
      </ClientPageModal>

      {/* EDIT TRANSACTION MODAL */}
      <ClientPageModal
        open={showEditTransaction}
        onClose={() => setShowEditTransaction(false)}
        title="Edit Payment Record"
        titleId="edit-transaction-modal-title"
      >
            <form onSubmit={handleEditTransaction} className={styles.formGrid}>
              <div className={styles.formField}>
                <label>Date</label>
                <input type="date" required value={editTransForm.transaction_date || ""} onChange={e => setEditTransForm({...editTransForm, transaction_date: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Product / Plan</label>
                <input type="text" required value={editTransForm.product_plan || ""} onChange={e => setEditTransForm({...editTransForm, product_plan: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Type</label>
                <select value={editTransForm.type || "Membership"} onChange={e => setEditTransForm({...editTransForm, type: e.target.value})}>
                  {TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>MRP (₹)</label>
                <input type="number" min="0" step="0.01" value={editTransForm.mrp_inr ?? ""} onChange={e => setEditTransForm({...editTransForm, mrp_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Rate (₹)</label>
                <input type="number" min="0" step="0.01" required value={editTransForm.rate_inr ?? ""} onChange={e => setEditTransForm({...editTransForm, rate_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Received (₹)</label>
                <input type="number" min="0" step="0.01" value={editTransForm.received_inr ?? ""} onChange={e => setEditTransForm({...editTransForm, received_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Pending (₹)</label>
                <input type="number" min="0" step="0.01" value={editTransForm.pending_inr ?? ""} onChange={e => setEditTransForm({...editTransForm, pending_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Cost (₹)</label>
                <input type="number" min="0" step="0.01" value={editTransForm.cost_inr ?? ""} onChange={e => setEditTransForm({...editTransForm, cost_inr: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Payment Mode</label>
                <select value={editTransForm.pay_mode || "GPay"} onChange={e => setEditTransForm({...editTransForm, pay_mode: e.target.value})}>
                  {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className={styles.formField.full}>
                <label>Notes</label>
                <textarea value={editTransForm.notes || ""} onChange={e => setEditTransForm({...editTransForm, notes: e.target.value})} rows={2} />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowEditTransaction(false)}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Save Changes</button>
              </div>
            </form>
      </ClientPageModal>

      {/* SUPPLEMENT MODAL */}
      <ClientPageModal
        open={showAddSupplement}
        onClose={() => setShowAddSupplement(false)}
        title="Prescribe Supplement"
        titleId="supplement-modal-title"
      >
            <form onSubmit={handleAddSupplement} className={styles.formGrid}>
              <div className={styles.formField.full}>
                <label>Product Name</label>
                <input type="text" required value={suppForm.product_name} onChange={e => setSuppForm({...suppForm, product_name: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Quantity</label>
                <input type="number" value={suppForm.quantity} onChange={e => setSuppForm({...suppForm, quantity: e.target.value})} />
              </div>
              <div className={styles.formField}>
                <label>Rate (₹)</label>
                <input type="number" value={suppForm.rate_inr} onChange={e => setSuppForm({...suppForm, rate_inr: e.target.value})} />
              </div>
              <div className={styles.formField.full}>
                <label>Notes</label>
                <textarea value={suppForm.notes} onChange={e => setSuppForm({...suppForm, notes: e.target.value})} />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddSupplement(false)}>Cancel</button>
                <button type="submit" className={styles.saveBtn}>Save Prescription</button>
              </div>
            </form>
      </ClientPageModal>

      {/* REFERRAL MODAL */}
      <ClientPageModal
        open={showAddReferral}
        onClose={() => setShowAddReferral(false)}
        title="Record Referral"
        titleId="referral-modal-title"
      >
            <div className={styles.formField.full}>
              <label>Search Client</label>
              <input 
                type="text" 
                placeholder="Search by name or ID..." 
                value={searchQuery}
                onChange={(e) => handleSearchClients(e.target.value)}
              />
              <div style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                {searchResults.map(res => (
                  <div 
                    key={res.client_id} 
                    style={{ padding: '0.75rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                    onClick={() => handleAddReferral(res.client_id)}
                  >
                    <span><strong>{res.full_name}</strong> ({res.client_id})</span>
                    <i className="fa-solid fa-plus" style={{ color: '#3a86ff' }}></i>
                  </div>
                ))}
                {searchResults.length === 0 && searchQuery.length > 1 && (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>No results found</div>
                )}
              </div>
            </div>
      </ClientPageModal>

    </div>
  );
}