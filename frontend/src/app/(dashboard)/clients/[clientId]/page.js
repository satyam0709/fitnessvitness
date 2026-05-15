"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { connectGlobalSocket } from "@/lib/api";
import {
  getClient, updateClient, deleteClient,
  createConsultation, deleteConsultation,
  createClientTask, updateClientTask, patchClientTaskStatus, deleteClientTask,
  createSupplement, updateSupplement, deleteSupplement,
  createTransaction,
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

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params?.clientId;
  const { isSignedIn, isLoaded } = useAuth();

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState(null);

  // Modal states
  const [showAddConsult, setShowAddConsult] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddSupplement, setShowAddSupplement] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showAddReferral, setShowAddReferral] = useState(false);
  
  // Search state for referrals
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  const handleFieldUpdate = async (field, value) => {
    setSaving(prev => ({ ...prev, [field]: true }));
    try {
      await updateClient(clientId, { [field]: value });
      await loadClient({ quiet: true });
    } catch (err) {
      console.error(`Failed to update ${field}:`, err);
    } finally {
      setSaving(prev => ({ ...prev, [field]: false }));
    }
  };

  const EditableCell = ({ field, value, type = "text", options = null }) => {
    const [localValue, setLocalValue] = useState(value || "");
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
      setLocalValue(value || "");
    }, [value]);

    const handleBlur = () => {
      setIsEditing(false);
      if (localValue !== value) {
        handleFieldUpdate(field, localValue);
      }
    };

    if (!isEditing && options) {
      return (
        <td className={styles.editable} onClick={() => setIsEditing(true)}>
          {value || "—"}
        </td>
      );
    }

    if (isEditing && options) {
      return (
        <td className={styles.editable}>
          <select 
            autoFocus 
            className={styles.editInput}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
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
            autoFocus
            type={type}
            className={styles.editInput}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
          />
        </td>
      );
    }

    return (
      <td className={styles.editable} onClick={() => setIsEditing(true)}>
        {type === "date" ? formatDate(value) : value || "—"}
      </td>
    );
  };

  const DetailField = ({ label, field, value, type = "text" }) => {
    const [localValue, setLocalValue] = useState(value || "");
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
      setLocalValue(value || "");
    }, [value]);

    const handleBlur = () => {
      setIsEditing(false);
      if (localValue !== value) {
        handleFieldUpdate(field, localValue);
      }
    };

    return (
      <div className={styles.detailItem}>
        <div className={styles.detailLabel}>{label}</div>
        <div className={styles.detailValue}>
          {isEditing ? (
            <input
              autoFocus
              type={type}
              className={styles.editInput}
              style={{ textAlign: 'left' }}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
            />
          ) : (
            <div style={{ width: '100%', minHeight: '20px' }} onClick={() => setIsEditing(true)}>
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
      setShowDeleteModal(false);
      router.push("/clients");
    } catch (err) {
      alert(err.message || "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

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
                  <EditableCell field="last_consultation_date" value={formatDateForInput(client.last_consultation_date)} type="date" />
                  <EditableCell field="progress" value={client.progress} options={PROGRESS_OPTIONS} />
                  <EditableCell field="status" value={client.status} options={STATUS_OPTIONS} />
                  <EditableCell field="plan_type" value={client.plan_type} options={PLAN_TYPES} />
                  <td>{formatDate(client.plan_expiry_date)}</td>
                  <EditableCell field="follow_up_freq_days" value={client.follow_up_freq_days} type="number" />
                  <EditableCell field="tier" value={client.tier} type="number" />
                  <EditableCell field="source" value={client.source} options={SOURCE_OPTIONS} />
                </tr>
              </tbody>
            </table>
            <p className={styles.tierHint}>
              Tier display: {tierStars(client.tier)} <span className={styles.tierMuted}>({Number(client.tier) || 0}/5)</span>
            </p>
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
              onClick={() => {
                setDeleteConfirm("");
                setShowDeleteModal(true);
              }}
            >
              Delete client from database…
            </button>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* 3. PERSONAL DETAILS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-user"></i>
              Personal Details
            </div>
            <div className={styles.detailGrid}>
              <DetailField label="Full Name" field="full_name" value={client.full_name} />
              <DetailField label="Age" field="age" value={client.age} type="number" />
              <DetailField label="Client ID" field="client_id" value={client.client_id} />
              <DetailField label="Phone" field="phone" value={client.phone} />
              <DetailField label="City" field="city" value={client.city} />
              <DetailField label="Email" field="email" value={client.email} />
              <DetailField label="Address" field="address" value={client.address} />
              <DetailField label="Occupation" field="occupation" value={client.occupation} />
              <DetailField label="Referred By" field="referred_by_name" value={client.referred_by_name} />
              <DetailField label="Emergency Contact" field="emergency_contact" value={client.emergency_contact} />
            </div>
          </section>

          {/* 4. PLAN & GOALS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-bullseye"></i>
              Plan & Goals
            </div>
            <div className={styles.detailGrid}>
              <DetailField label="Health Goal" field="health_goal" value={client.health_goal} />
              <DetailField label="Plan Type" field="plan_type" value={client.plan_type} />
              <DetailField label="Plan Start Date" field="plan_start_date" value={formatDateForInput(client.plan_start_date)} type="date" />
              <DetailField label="Plan Duration" field="plan_duration" value={client.plan_type ? `${client.plan_type} (Auto)` : "—"} />
              <DetailField label="Plan Expiry" field="plan_expiry_date" value={formatDateForInput(client.plan_expiry_date)} type="date" />
              <DetailField label="Days Remaining" field="days_remaining" value={client.days_remaining !== null ? `${client.days_remaining} days` : "—"} />
              <DetailField label="Medical Conditions" field="medical_conditions" value={client.medical_conditions} />
              <DetailField label="Allergies / Avoid" field="allergies" value={client.allergies} />
              <DetailField label="Activity Level" field="activity_level" value={client.activity_level} />
              <DetailField label="Current Medications" field="current_medications" value={client.current_medications} />
            </div>
          </section>
        </div>

        {/* 5. BODY STATS & BMI */}
        <section className={`${styles.section} ${styles.statSection}`}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-chart-line"></i>
            Body Stats & BMI
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
                  <EditableCell field="height_cm" value={client.height_cm} type="number" />
                  <EditableCell field="current_weight_kg" value={client.current_weight_kg} type="number" />
                  <td style={{ fontWeight: 700 }}>{client.bmi || "—"}</td>
                  <td style={{ color: client.weight_change < 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    {client.weight_change !== null ? `${client.weight_change > 0 ? '+' : ''}${client.weight_change} kg` : "—"}
                  </td>
                  <EditableCell field="start_weight_kg" value={client.start_weight_kg} type="number" />
                  <EditableCell field="target_weight_kg" value={client.target_weight_kg} type="number" />
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
                    <td style={{ fontWeight: 700, color: '#10b981' }}>{ref.referred_name}</td>
                    <td>{ref.referred_client_id}</td>
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
                  </tr>
                ))}
                {(!client.tasks || client.tasks.length === 0) && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No active tasks</td></tr>
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
                  </tr>
                ))}
                {(!client.consultations || client.consultations.length === 0) && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No consultation history</td></tr>
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
                  </tr>
                ))}
                {(!client.transactions || client.transactions.length === 0) && (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No financial records</td></tr>
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
                  </tr>
                ))}
                {(!client.supplements || client.supplements.length === 0) && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No supplements prescribed</td></tr>
                )}
              </tbody>
              {(client.supplements?.length > 0) && (
                <tfoot>
                  <tr className={styles.supplementTotalsRow}>
                    <td colSpan={3} style={{ fontWeight: 800 }}>Totals</td>
                    <td style={{ fontWeight: 800 }}>₹{Number(supplementTotals.mrp).toLocaleString("en-IN")}</td>
                    <td style={{ fontWeight: 800 }}>₹{Number(supplementTotals.rate).toLocaleString("en-IN")}</td>
                    <td />
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
          </div>
          <div className={styles.sectionBody}>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
              Write private observations — mindset, lifestyle, family situation, motivation triggers, challenges...
            </p>
            <textarea 
              className={styles.notesArea}
              placeholder="Start typing private notes here..."
              defaultValue={client.coach_notes}
              onBlur={(e) => handleFieldUpdate('coach_notes', e.target.value)}
            />
          </div>
        </section>

      </div>

      {showDeleteModal && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => !deleteBusy && setShowDeleteModal(false)}
        >
          <div className={styles.modalContent} role="dialog" aria-labelledby="delete-client-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="delete-client-title">Delete client permanently</h2>
              <button type="button" className={styles.closeBtn} disabled={deleteBusy} onClick={() => setShowDeleteModal(false)}>
                &times;
              </button>
            </div>
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
            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} disabled={deleteBusy} onClick={() => setShowDeleteModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerConfirmBtn}
                disabled={deleteBusy || deleteConfirm.trim() !== client.client_id}
                onClick={handlePermanentDelete}
              >
                {deleteBusy ? "Removing…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONSULTATION MODAL */}
      {showAddConsult && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Log Consultation</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddConsult(false)}>&times;</button>
            </div>
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
          </div>
        </div>
      )}

      {/* TASK MODAL */}
      {showAddTask && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Create New Task</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddTask(false)}>&times;</button>
            </div>
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
          </div>
        </div>
      )}

      {/* TRANSACTION MODAL */}
      {showAddTransaction && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Add Transaction</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddTransaction(false)}>&times;</button>
            </div>
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
          </div>
        </div>
      )}

      {/* SUPPLEMENT MODAL */}
      {showAddSupplement && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Prescribe Supplement</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddSupplement(false)}>&times;</button>
            </div>
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
          </div>
        </div>
      )}

      {/* REFERRAL MODAL */}
      {showAddReferral && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Record Referral</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddReferral(false)}>&times;</button>
            </div>
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
          </div>
        </div>
      )}

    </div>
  );
}