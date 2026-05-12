"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  getClient, updateClient,
  createConsultation, deleteConsultation,
  createClientTask, updateClientTask, patchClientTaskStatus, deleteClientTask,
  createSupplement, updateSupplement, deleteSupplement,
  createTransaction,
  createReferral, deleteReferral
} from "@/lib/fitnessApi";
import { FitnessApiError } from "@/lib/fitnessApi";
import styles from "./client.module.css";

const STATUS_OPTIONS = ["Active", "Hold", "Inactive"];
const PROGRESS_OPTIONS = ["Very Good", "Good", "Neutral", "Poor", "Very Poor"];
const SOURCE_OPTIONS = ["BNI", "Instagram", "Facebook", "Referral - Existing Client", "Friend / Family", "Walk-in", "Online / Website", "Corporate / Company"];
const PLAN_TYPES = ["", "1 Month Plan", "3 Month Plan", "6 Month Plan", "1 Year Plan"];
const CONSULT_TYPES = ["Onboarding", "Diet Review", "Check-in", "Follow-up", "Other"];
const TASK_PRIORITIES = ["High", "Medium", "Low"];
const TASK_STATUSES = ["Open", "In Progress", "Done", "Carried Forward", "Overdue"];
const TX_TYPES = ["Membership", "Supplement", "Other"];
const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const SUPP_TYPES = ["Membership", "Supplement", "Other"];

function formatDate(d) { if (!d) return "—"; return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

function getBMICategory(bmi) {
  if (bmi === null) return { label: "N/A", className: "" };
  if (bmi < 18.5) return { label: "Underweight", className: styles.warning };
  if (bmi < 25) return { label: "Normal", className: styles.good };
  if (bmi < 30) return { label: "Overweight", className: styles.warning };
  return { label: "Obese", className: styles.danger };
}

function getDaysRemaining(planExpiryDate) {
  if (!planExpiryDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(planExpiryDate); expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function getPlanDuration(planType) {
  const map = { "1 Month Plan": 30, "3 Month Plan": 90, "6 Month Plan": 180, "1 Year Plan": 365 };
  return map[planType] || null;
}

function formatDateForInput(dateStr) {
  if (!dateStr) return "";
  return dateStr.split("T")[0];
}

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params?.clientId;

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState(null);

  // Tab state - added referrals tab for 10 sections
  const [activeTab, setActiveTab] = useState("overview");

  // Modal states
  const [showAddConsult, setShowAddConsult] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddSupplement, setShowAddSupplement] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showAddReferral, setShowAddReferral] = useState(false);
  const [editingSupplement, setEditingSupplement] = useState(null);
  const [searchClient, setSearchClient] = useState("");
  const [clientResults, setClientResults] = useState([]);

  // Form states with validation
  const [consultForm, setConsultForm] = useState({ consult_date: "", consult_type: "Check-in", weight_kg: "", key_observations: "", diet_changes: "", next_steps: "" });
  const [consultError, setConsultError] = useState({});
  const [taskForm, setTaskForm] = useState({ task_description: "", due_date: "", priority: "Medium", status: "Open" });
  const [taskError, setTaskError] = useState({});
  const [suppForm, setSuppForm] = useState({ product_name: "", prescribed_date: "", quantity: "", mrp_inr: "", rate_inr: "", notes: "" });
  const [suppError, setSuppError] = useState({});
  const [transForm, setTransForm] = useState({ transaction_date: "", product_plan: "", type: "Membership", mrp_inr: "", rate_inr: "", received_inr: "", cost_inr: "", pay_mode: "GPay", notes: "" });
  const [transError, setTransError] = useState({});
  const [referralForm, setReferralForm] = useState({ referred_client_id: "" });
  const [referralError, setReferralError] = useState({});

  // Section loading states
  const [sectionLoading, setSectionLoading] = useState({});

  useEffect(() => { if (clientId) loadClient(); }, [clientId]);

  async function loadClient() {
    setLoading(true); setError(null);
    try { const data = await getClient(clientId); setClient(data); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function saveField(field, value) {
    setSaving(prev => ({ ...prev, [field]: true }));
    try { await updateClient(clientId, { [field]: value }); await loadClient(); }
    catch (err) { setError(err.message); setTimeout(() => setError(null), 3000); }
    finally { setSaving(prev => ({ ...prev, [field]: false })); }
  }

  // ===== CONSULTATIONS =====
  async function handleAddConsult(e) {
    e.preventDefault();
    const errors = {};
    if (!consultForm.consult_date) errors.consult_date = "Date required";
    if (!consultForm.consult_type) errors.consult_type = "Type required";
    if (Object.keys(errors).length) { setConsultError(errors); return; }

    setSectionLoading(prev => ({ ...prev, consult: true }));
    try {
      await createConsultation(clientId, consultForm);
      setShowAddConsult(false);
      setConsultForm({ consult_date: "", consult_type: "Check-in", weight_kg: "", key_observations: "", diet_changes: "", next_steps: "" });
      setConsultError({});
      await loadClient();
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(prev => ({ ...prev, consult: false })); }
  }

  async function handleDeleteConsult(id) {
    if (!confirm("Delete this consultation?")) return;
    try { await deleteConsultation(id); await loadClient(); } catch (err) { setError(err.message); }
  }

  // ===== TASKS =====
  async function handleAddTask(e) {
    e.preventDefault();
    const errors = {};
    if (!taskForm.task_description?.trim()) errors.task_description = "Description required";
    if (Object.keys(errors).length) { setTaskError(errors); return; }

    setSectionLoading(prev => ({ ...prev, tasks: true }));
    try {
      await createClientTask(clientId, taskForm);
      setShowAddTask(false);
      setTaskForm({ task_description: "", due_date: "", priority: "Medium", status: "Open" });
      setTaskError({});
      await loadClient();
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(prev => ({ ...prev, tasks: false })); }
  }

  async function handleTaskStatusToggle(task) {
    const nextStatus = task.status === "Open" ? "In Progress" : task.status === "In Progress" ? "Done" : "Open";
    const completedOn = nextStatus === "Done" ? new Date().toISOString().split("T")[0] : null;
    try { await patchClientTaskStatus(task.id, { status: nextStatus, completed_on: completedOn }); await loadClient(); }
    catch (err) { setError(err.message); }
  }

  // ===== SUPPLEMENTS =====
  async function handleAddSupplement(e) {
    e.preventDefault();
    const errors = {};
    if (!suppForm.product_name?.trim()) errors.product_name = "Product name required";
    if (Object.keys(errors).length) { setSuppError(errors); return; }

    setSectionLoading(prev => ({ ...prev, supplements: true }));
    try {
      await createSupplement(clientId, suppForm);
      setShowAddSupplement(false);
      setSuppForm({ product_name: "", prescribed_date: "", quantity: "", mrp_inr: "", rate_inr: "", notes: "" });
      setSuppError({});
      await loadClient();
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(prev => ({ ...prev, supplements: false })); }
  }

  async function handleUpdateSupplement(e) {
    e.preventDefault();
    if (!editingSupplement) return;
    try {
      await updateSupplement(editingSupplement.id, suppForm);
      setEditingSupplement(null);
      setSuppForm({ product_name: "", prescribed_date: "", quantity: "", mrp_inr: "", rate_inr: "", notes: "" });
      await loadClient();
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteSupplement(id) {
    if (!confirm("Delete this supplement?")) return;
    try { await deleteSupplement(id); await loadClient(); } catch (err) { setError(err.message); }
  }

  // ===== TRANSACTIONS (Payment History - read only, add via modal) =====
  async function handleAddTransaction(e) {
    e.preventDefault();
    const errors = {};
    if (!transForm.transaction_date) errors.transaction_date = "Date required";
    if (!transForm.product_plan?.trim()) errors.product_plan = "Product required";
    if (!transForm.type) errors.type = "Type required";
    if (Object.keys(errors).length) { setTransError(errors); return; }

    // Auto-calculate pending = rate - received
    const rate = parseFloat(transForm.rate_inr) || 0;
    const received = parseFloat(transForm.received_inr) || 0;
    const pending = Math.max(0, rate - received);

    setSectionLoading(prev => ({ ...prev, payments: true }));
    try {
      await createTransaction({ ...transForm, client_id: clientId, pending_inr: pending });
      setShowAddTransaction(false);
      setTransForm({ transaction_date: "", product_plan: "", type: "Membership", mrp_inr: "", rate_inr: "", received_inr: "", cost_inr: "", pay_mode: "GPay", notes: "" });
      setTransError({});
      await loadClient();
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(prev => ({ ...prev, payments: false })); }
  }

  // ===== REFERRALS =====
  async function searchReferralClients(q) {
    setSearchClient(q);
    if (q.length < 2) { setClientResults([]); return; }
    try {
      const { searchClients } = await import("@/lib/fitnessApi");
      const results = await searchClients(q);
      setClientResults(results.filter(c => c.client_id !== clientId));
    } catch (err) { console.error("Search failed:", err); }
  }

  async function handleAddReferral(e) {
    e.preventDefault();
    const errors = {};
    if (!referralForm.referred_client_id) errors.referred_client_id = "Select a client";
    if (Object.keys(errors).length) { setReferralError(errors); return; }

    setSectionLoading(prev => ({ ...prev, referrals: true }));
    try {
      await createReferral({ referrer_client_id: clientId, referred_client_id: referralForm.referred_client_id });
      setShowAddReferral(false);
      setReferralForm({ referred_client_id: "" });
      setReferralError({});
      setSearchClient(""); setClientResults([]);
      await loadClient();
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(prev => ({ ...prev, referrals: false })); }
  }

  async function handleDeleteReferral(id) {
    if (!confirm("Remove this referral?")) return;
    try { await deleteReferral(id); await loadClient(); } catch (err) { setError(err.message); }
  }

  // ===== COACH NOTES (autosave on blur) =====
  const [notesSaving, setNotesSaving] = useState(false);
  async function handleNotesBlur(e) {
    const value = e.target.value;
    if (value === client.coach_notes) return;
    setNotesSaving(true);
    try { await updateClient(clientId, { coach_notes: value }); }
    catch (err) { setError(err.message); }
    finally { setNotesSaving(false); }
  }

  // ===== WEIGHT HISTORY CHART DATA =====
  const weightHistory = client?.body_stats?.map(b => ({
    date: formatDate(b.recorded_date),
    weight: b.weight_kg
  })).reverse() || [];

  // ===== COMPUTED VALUES =====
  if (loading) return <div className={styles.loading}><i className="fa-solid fa-spinner fa-spin"></i> Loading client...</div>;
  if (error && !client) return <div className={styles.error}><i className="fa-solid fa-triangle-exclamation"></i> {error}</div>;
  if (!client) return <div className={styles.error}>Client not found</div>;

  const daysLeft = getDaysRemaining(client.plan_expiry_date);
  const planDuration = getPlanDuration(client.plan_type);
  const bmiCat = getBMICategory(client.bmi);
  const weightChange = client.current_weight_kg && client.start_weight_kg
    ? Math.round((client.current_weight_kg - client.start_weight_kg) * 100) / 100 : null;
  const goalProgress = client.start_weight_kg && client.target_weight_kg
    ? Math.round(((client.start_weight_kg - client.current_weight_kg) / (client.start_weight_kg - client.target_weight_kg)) * 100) : null;

  // Totals for payments
  const paymentTotals = client.transactions?.reduce((acc, t) => ({
    received: acc.received + (parseFloat(t.received_inr) || 0),
    pending: acc.pending + (parseFloat(t.pending_inr) || 0),
    profit: acc.profit + (parseFloat(t.profit_inr) || 0)
  }), { received: 0, pending: 0, profit: 0 }) || { received: 0, pending: 0, profit: 0 };

  // Calculate expiry date from start + duration (auto-calculated display)
  let calculatedExpiry = null;
  if (client.plan_start_date && planDuration) {
    const start = new Date(client.plan_start_date);
    start.setDate(start.getDate() + planDuration);
    calculatedExpiry = start.toISOString().split("T")[0];
  }

  // Error banner
  const renderError = () => error && (
    <div className={styles.errorBanner} onClick={() => setError(null)}>
      <i className="fa-solid fa-circle-exclamation"></i> {error} <span>(click to dismiss)</span>
    </div>
  );

  return (
    <div className={styles.container}>
      {renderError()}
      <div className={styles.header}>
        <Link href="/clients" className={styles.backBtn}><i className="fa-solid fa-arrow-left"></i> Back</Link>
        <h1>{client.full_name} <span className={styles.clientId}>({client.client_id})</span></h1>
      </div>

      {/* Key Fields Bar - Section 1 */}
      <div className={styles.keyBar}>
        <div className={styles.keyField}><label>Status</label>
          <select value={client.status} onChange={e => saveField("status", e.target.value)} disabled={saving.status}>
            {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className={styles.keyField}><label>Progress</label>
          <select value={client.progress} onChange={e => saveField("progress", e.target.value)} disabled={saving.progress}>
            {PROGRESS_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className={styles.keyField}><label>Last Consult</label><span>{formatDate(client.last_consultation_date)}</span></div>
        <div className={styles.keyField}><label>Next Due</label><span>{formatDate(client.next_due_date)}</span></div>
        <div className={styles.keyField}><label>Plan Type</label>
          <select value={client.plan_type || ""} onChange={e => saveField("plan_type", e.target.value)} disabled={saving.plan_type}>
            {PLAN_TYPES.map(p => <option key={p} value={p}>{p || "—"}</option>)}
          </select>
        </div>
        <div className={styles.keyField}><label>Plan Expiry</label>
          <span className={daysLeft !== null && daysLeft < 0 ? styles.expired : daysLeft !== null && daysLeft <= 7 ? styles.urgent : ""}>
            {calculatedExpiry ? formatDate(calculatedExpiry) : formatDate(client.plan_expiry_date)}
            {planDuration && <small> ({planDuration} days)</small>}
            {daysLeft !== null && <span> ({daysLeft < 0 ? "Expired" : `${daysLeft}d`})</span>}
          </span>
        </div>
        <div className={styles.keyField}><label>Follow-up Freq</label>
          <input type="number" value={client.follow_up_freq_days || 14} onChange={e => saveField("follow_up_freq_days", parseInt(e.target.value))} disabled={saving.follow_up_freq_days} />
        </div>
        <div className={styles.keyField}><label>Tier</label>
          <div className={styles.tierSelect}>
            {[1,2,3,4,5].map(t => (
              <span key={t} onClick={() => saveField("tier", t)} style={{ color: t <= client.tier ? "#fbbf24" : "#d1d5db", cursor: "pointer", fontSize: "20px" }}>★</span>
            ))}
          </div>
        </div>
        <div className={styles.keyField}><label>Source</label><span>{client.source || "—"}</span></div>
      </div>

      {/* Tabs - 10 sections */}
      <div className={styles.tabs}>
        {["overview", "body", "referrals", "tasks", "consultations", "payments", "supplements", "notes"].map(tab => (
          <button key={tab} className={activeTab === tab ? styles.activeTab : ""} onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className={styles.tabContent}>

        {/* SECTION 1: Personal Details */}
        {activeTab === "overview" && (
          <div className={styles.grid}>
            <div className={styles.card}>
              <h3>Personal Details</h3>
              <div className={styles.field}><label>Full Name</label>
                <input value={client.full_name} onChange={e => setClient({...client, full_name: e.target.value})} onBlur={e => saveField("full_name", e.target.value)} disabled={saving.full_name} />
              </div>
              <div className={styles.field}><label>Phone</label>
                <input value={client.phone || ""} onChange={e => setClient({...client, phone: e.target.value})} onBlur={e => saveField("phone", e.target.value)} disabled={saving.phone} />
              </div>
              <div className={styles.field}><label>Email</label>
                <input value={client.email || ""} onChange={e => setClient({...client, email: e.target.value})} onBlur={e => saveField("email", e.target.value)} disabled={saving.email} />
              </div>
              <div className={styles.field}><label>Age</label>
                <input type="number" value={client.age || ""} onChange={e => setClient({...client, age: parseInt(e.target.value)})} onBlur={e => saveField("age", e.target.value ? parseInt(e.target.value) : null)} disabled={saving.age} />
              </div>
              <div className={styles.field}><label>City</label>
                <input value={client.city || ""} onChange={e => setClient({...client, city: e.target.value})} onBlur={e => saveField("city", e.target.value)} disabled={saving.city} />
              </div>
              <div className={styles.field}><label>Address</label>
                <textarea value={client.address || ""} onChange={e => setClient({...client, address: e.target.value})} onBlur={e => saveField("address", e.target.value)} disabled={saving.address} />
              </div>
              <div className={styles.field}><label>Occupation</label>
                <input value={client.occupation || ""} onChange={e => setClient({...client, occupation: e.target.value})} onBlur={e => saveField("occupation", e.target.value)} disabled={saving.occupation} />
              </div>
              <div className={styles.field}><label>Emergency Contact</label>
                <input value={client.emergency_contact || ""} onChange={e => setClient({...client, emergency_contact: e.target.value})} onBlur={e => saveField("emergency_contact", e.target.value)} disabled={saving.emergency_contact} />
              </div>
            </div>
            <div className={styles.card}>
              <h3>Plan & Goals</h3>
              <div className={styles.field}><label>Health Goal</label>
                <textarea value={client.health_goal || ""} onChange={e => setClient({...client, health_goal: e.target.value})} onBlur={e => saveField("health_goal", e.target.value)} disabled={saving.health_goal} />
              </div>
              <div className={styles.field}><label>Plan Start Date</label>
                <input type="date" value={formatDateForInput(client.plan_start_date)} onChange={e => setClient({...client, plan_start_date: e.target.value})} onBlur={e => saveField("plan_start_date", e.target.value)} disabled={saving.plan_start_date} />
              </div>
              {planDuration && <div className={styles.field}><label>Plan Duration</label><span>{planDuration} days</span></div>}
              <div className={styles.field}><label>Medical Conditions</label>
                <textarea value={client.medical_conditions || ""} onChange={e => setClient({...client, medical_conditions: e.target.value})} onBlur={e => saveField("medical_conditions", e.target.value)} disabled={saving.medical_conditions} />
              </div>
              <div className={styles.field}><label>Allergies</label>
                <textarea value={client.allergies || ""} onChange={e => setClient({...client, allergies: e.target.value})} onBlur={e => saveField("allergies", e.target.value)} disabled={saving.allergies} />
              </div>
              <div className={styles.field}><label>Activity Level</label>
                <input value={client.activity_level || ""} onChange={e => setClient({...client, activity_level: e.target.value})} onBlur={e => saveField("activity_level", e.target.value)} disabled={saving.activity_level} />
              </div>
              <div className={styles.field}><label>Current Medications</label>
                <textarea value={client.current_medications || ""} onChange={e => setClient({...client, current_medications: e.target.value})} onBlur={e => saveField("current_medications", e.target.value)} disabled={saving.current_medications} />
              </div>
              <div className={styles.field}><label>Referred By</label>
                <input value={client.referred_by_client_id || ""} onChange={e => setClient({...client, referred_by_client_id: e.target.value})} onBlur={e => saveField("referred_by_client_id", e.target.value)} disabled={saving.referred_by_client_id} placeholder="FV-XXX" />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: Body Stats with Chart */}
        {activeTab === "body" && (
          <div className={styles.card}>
            <h3>Body Stats & BMI</h3>
            <div className={styles.bodyGrid}>
              <div className={styles.field}><label>Height (cm)</label>
                <input type="number" value={client.height_cm || ""} onChange={e => setClient({...client, height_cm: parseFloat(e.target.value)})} onBlur={e => saveField("height_cm", e.target.value ? parseFloat(e.target.value) : null)} disabled={saving.height_cm} />
              </div>
              <div className={styles.field}><label>Start Weight (kg)</label>
                <input type="number" value={client.start_weight_kg || ""} onChange={e => setClient({...client, start_weight_kg: parseFloat(e.target.value)})} onBlur={e => saveField("start_weight_kg", e.target.value ? parseFloat(e.target.value) : null)} disabled={saving.start_weight_kg} />
              </div>
              <div className={styles.field}><label>Current Weight (kg)</label>
                <input type="number" value={client.current_weight_kg || ""} onChange={e => setClient({...client, current_weight_kg: parseFloat(e.target.value)})} onBlur={e => saveField("current_weight_kg", e.target.value ? parseFloat(e.target.value) : null)} disabled={saving.current_weight_kg} />
              </div>
              <div className={styles.field}><label>Target Weight (kg)</label>
                <input type="number" value={client.target_weight_kg || ""} onChange={e => setClient({...client, target_weight_kg: parseFloat(e.target.value)})} onBlur={e => saveField("target_weight_kg", e.target.value ? parseFloat(e.target.value) : null)} disabled={saving.target_weight_kg} />
              </div>
            </div>
            <div className={styles.bmiBox}>
              <div className={styles.bmiValue}>BMI: {client.bmi || "—"}</div>
              <div className={`${styles.bmiCategory} ${bmiCat.className}`}>{bmiCat.label}</div>
              {weightChange !== null && <div className={styles.weightChange}>Weight Change: {weightChange > 0 ? "+" : ""}{weightChange} kg</div>}
              {goalProgress !== null && <div className={styles.goalProgress}>Progress to Goal: {goalProgress}%</div>}
            </div>
            {weightHistory.length > 0 && (
              <div className={styles.chartContainer}>
                <h4>Weight History</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={weightHistory}>
                    <XAxis dataKey="date" tick={{fontSize: 12}} />
                    <YAxis domain={['auto', 'auto']} tick={{fontSize: 12}} />
                    <Tooltip />
                    <Line type="monotone" dataKey="weight" stroke="#10b981" strokeWidth={2} dot={{fill: "#10b981"}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {weightHistory.length === 0 && <div className={styles.emptyState}>No weight history yet. Add body stats from the client list or API.</div>}
          </div>
        )}

        {/* SECTION 3: Referral Details */}
        {activeTab === "referrals" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3>Referral Details</h3>
              <button className={styles.addBtn} onClick={() => setShowAddReferral(true)}>+ Add Referral</button>
            </div>
            {sectionLoading.referrals && <div className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</div>}
            <div className={styles.referralSection}>
              <h4>Referred By (Clients who referred this client)</h4>
              {client.referrals_received?.length > 0 ? (
                <table className={styles.table}><thead><tr><th>Client</th><th>Date</th><th>Notes</th><th></th></tr></thead>
                  <tbody>{client.referrals_received.map(r => (
                    <tr key={r.id}><td>{r.referrer_name} ({r.referrer_client_id})</td><td>{formatDate(r.referral_date)}</td><td>{r.notes || "—"}</td><td><button className={styles.delBtn} onClick={() => handleDeleteReferral(r.id)}><i className="fa-solid fa-trash"></i></button></td></tr>
                  ))}</tbody>
                </table>
              ) : <div className={styles.emptyState}>No referrals received</div>}
            </div>
            <div className={styles.referralSection}>
              <h4>Referrals Given (Clients this client referred)</h4>
              {client.referrals_given?.length > 0 ? (
                <table className={styles.table}><thead><tr><th>Client</th><th>Date</th><th>Notes</th><th></th></tr></thead>
                  <tbody>{client.referrals_given.map(r => (
                    <tr key={r.id}><td>{r.referred_name} ({r.referred_client_id})</td><td>{formatDate(r.referral_date)}</td><td>{r.notes || "—"}</td><td><button className={styles.delBtn} onClick={() => handleDeleteReferral(r.id)}><i className="fa-solid fa-trash"></i></button></td></tr>
                  ))}</tbody>
                </table>
              ) : <div className={styles.emptyState}>No referrals given</div>}
            </div>
            <div className={styles.statBox}>
              <span>Total Referrals: {client.referrals_given?.length || 0}</span>
            </div>
          </div>
        )}

        {/* SECTION 4: Task Engine with Status Toggle */}
        {activeTab === "tasks" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}><h3>Client Tasks</h3><button className={styles.addBtn} onClick={() => setShowAddTask(true)}>+ Add Task</button></div>
            {sectionLoading.tasks && <div className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</div>}
            {taskError.task_description && <div className={styles.inlineError}>{taskError.task_description}</div>}
            {client.tasks?.length > 0 ? (
              <table className={styles.table}><thead><tr><th>Description</th><th>Due Date</th><th>Priority</th><th>Status</th><th>Period</th><th></th></tr></thead>
                <tbody>{client.tasks.map(t => (
                  <tr key={t.id} className={t.status === "Overdue" ? styles.overdueRow : ""}>
                    <td>{t.task_description}</td>
                    <td>{formatDate(t.due_date)}</td>
                    <td><span className={styles[`prio_${t.priority}`]}>{t.priority}</span></td>
                    <td><button className={styles.statusBtn} onClick={() => handleTaskStatusToggle(t)}>{t.status}</button></td>
                    <td>{t.period || "—"}</td>
                    <td><button className={styles.delBtn} onClick={() => handleDeleteClientTask(t.id)}><i className="fa-solid fa-trash"></i></button></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className={styles.emptyState}>No tasks</div>}
          </div>
        )}

        {/* SECTION 5: Consultation Log */}
        {activeTab === "consultations" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}><h3>Consultation Log</h3><button className={styles.addBtn} onClick={() => setShowAddConsult(true)}>+ Add Consultation</button></div>
            {sectionLoading.consult && <div className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</div>}
            {client.consultations?.length > 0 ? (
              <table className={styles.table}><thead><tr><th>Date</th><th>Type</th><th>Weight</th><th>Key Observations</th><th>Diet Changes</th><th>Next Steps</th><th></th></tr></thead>
                <tbody>{client.consultations.map(c => (
                  <tr key={c.id}>
                    <td>{formatDate(c.consult_date)}</td><td>{c.consult_type}</td><td>{c.weight_kg || "—"}</td><td>{c.key_observations || "—"}</td><td>{c.diet_changes || "—"}</td><td>{c.next_steps || "—"}</td>
                    <td><button className={styles.delBtn} onClick={() => handleDeleteConsult(c.id)}><i className="fa-solid fa-trash"></i></button></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className={styles.emptyState}>No consultations</div>}
            <div className={styles.infoBox}><i className="fa-solid fa-circle-info"></i> Adding a consultation automatically updates Last Consult date and recalculates Next Due date.</div>
          </div>
        )}

        {/* SECTION 6: Payment History (Read-only) */}
        {activeTab === "payments" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}><h3>Payment History</h3><button className={styles.addBtn} onClick={() => setShowAddTransaction(true)}>+ Add Transaction</button></div>
            {sectionLoading.payments && <div className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</div>}
            {client.transactions?.length > 0 ? (
              <>
                <table className={styles.table}><thead><tr><th>Date</th><th>Product/Plan</th><th>Type</th><th>Rate</th><th>Received</th><th>Pending</th><th>Profit</th><th>Mode</th></tr></thead>
                  <tbody>{client.transactions.map(t => (
                    <tr key={t.id}><td>{formatDate(t.transaction_date)}</td><td>{t.product_plan}</td><td>{t.type}</td><td>₹{t.rate_inr}</td><td>₹{t.received_inr}</td><td className={t.pending_inr > 0 ? styles.pending : ""}>₹{t.pending_inr}</td><td className={t.profit_inr > 0 ? styles.profit : ""}>₹{t.profit_inr}</td><td>{t.pay_mode}</td></tr>
                  ))}</tbody>
                </table>
                <div className={styles.totalsRow}>
                  <span>Total Received: <strong>₹{paymentTotals.received}</strong></span>
                  <span>Total Pending: <strong>₹{paymentTotals.pending}</strong></span>
                  <span>Total Profit: <strong className={styles.profit}>₹{paymentTotals.profit}</strong></span>
                </div>
              </>
            ) : <div className={styles.emptyState}>No transactions</div>}
          </div>
        )}

        {/* SECTION 7: Supplements with Inline Add/Edit */}
        {activeTab === "supplements" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}><h3>Supplements Prescribed</h3><button className={styles.addBtn} onClick={() => setShowAddSupplement(true)}>+ Add Supplement</button></div>
            {sectionLoading.supplements && <div className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</div>}
            {suppError.product_name && <div className={styles.inlineError}>{suppError.product_name}</div>}
            {client.supplements?.length > 0 ? (
              <table className={styles.table}><thead><tr><th>Product</th><th>Date</th><th>Qty</th><th>MRP</th><th>Rate</th><th>Notes</th><th></th></tr></thead>
                <tbody>{client.supplements.map(s => (
                  <tr key={s.id}>
                    <td>{s.product_name}</td><td>{formatDate(s.prescribed_date)}</td><td>{s.quantity || "—"}</td><td>₹{s.mrp_inr || "—"}</td><td>₹{s.rate_inr || "—"}</td><td>{s.notes || "—"}</td>
                    <td><button className={styles.editBtn} onClick={() => { setEditingSupplement(s); setSuppForm({ product_name: s.product_name, prescribed_date: formatDateForInput(s.prescribed_date), quantity: s.quantity || "", mrp_inr: s.mrp_inr || "", rate_inr: s.rate_inr || "", notes: s.notes || "" }); }}><i className="fa-solid fa-pen"></i></button><button className={styles.delBtn} onClick={() => handleDeleteSupplement(s.id)}><i className="fa-solid fa-trash"></i></button></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className={styles.emptyState}>No supplements</div>}
          </div>
        )}

        {/* SECTION 8: Coach's Private Notes (Autosave) */}
        {activeTab === "notes" && (
          <div className={styles.card}>
            <div className={styles.cardHeader}><h3>Coach's Private Notes</h3>{notesSaving && <span className={styles.saving}><i className="fa-solid fa-spinner fa-spin"></i> Saving...</span>}</div>
            <textarea className={styles.notesArea} defaultValue={client.coach_notes || ""} onBlur={handleNotesBlur} placeholder="Private notes about this client..." />
            <div className={styles.infoBox}><i className="fa-solid fa-circle-info"></i> Notes auto-save when you click out of the field.</div>
          </div>
        )}
      </div>

      {/* ===== MODALS ===== */}

      {/* Add Consultation Modal */}
      {showAddConsult && (
        <div className={styles.modal} onClick={() => setShowAddConsult(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Add Consultation</h2>
            <form onSubmit={handleAddConsult}>
              <div className={styles.field}>{consultError.consult_date && <span className={styles.fieldError}>{consultError.consult_date}</span>}
                <label>Date *</label><input type="date" required value={consultForm.consult_date} onChange={e => setConsultForm({...consultForm, consult_date: e.target.value})} /></div>
              <div className={styles.field}>{consultError.consult_type && <span className={styles.fieldError}>{consultError.consult_type}</span>}
                <label>Type</label><select value={consultForm.consult_type} onChange={e => setConsultForm({...consultForm, consult_type: e.target.value})}>{CONSULT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className={styles.field}><label>Weight (kg)</label><input type="number" step="0.1" value={consultForm.weight_kg} onChange={e => setConsultForm({...consultForm, weight_kg: e.target.value})} /></div>
              <div className={styles.field}><label>Key Observations</label><textarea value={consultForm.key_observations} onChange={e => setConsultForm({...consultForm, key_observations: e.target.value})} /></div>
              <div className={styles.field}><label>Diet Changes</label><textarea value={consultForm.diet_changes} onChange={e => setConsultForm({...consultForm, diet_changes: e.target.value})} /></div>
              <div className={styles.field}><label>Next Steps</label><textarea value={consultForm.next_steps} onChange={e => setConsultForm({...consultForm, next_steps: e.target.value})} /></div>
              <div className={styles.modalActions}><button type="button" onClick={() => setShowAddConsult(false)}>Cancel</button><button type="submit">Add</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {showAddTask && (
        <div className={styles.modal} onClick={() => setShowAddTask(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Add Task</h2>
            <form onSubmit={handleAddTask}>
              <div className={styles.field}>{taskError.task_description && <span className={styles.fieldError}>{taskError.task_description}</span>}
                <label>Description *</label><textarea required value={taskForm.task_description} onChange={e => setTaskForm({...taskForm, task_description: e.target.value})} /></div>
              <div className={styles.field}><label>Due Date</label><input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} /></div>
              <div className={styles.field}><label>Priority</label><select value={taskForm.priority} onChange={e => setTaskForm({...taskForm, priority: e.target.value})}>{TASK_PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
              <div className={styles.field}><label>Status</label><select value={taskForm.status} onChange={e => setTaskForm({...taskForm, status: e.target.value})}>{TASK_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
              <div className={styles.field}><label>Period</label><input value={taskForm.period} onChange={e => setTaskForm({...taskForm, period: e.target.value})} placeholder="e.g., Week 1, Month 1" /></div>
              <div className={styles.modalActions}><button type="button" onClick={() => setShowAddTask(false)}>Cancel</button><button type="submit">Add</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Supplement Modal */}
      {(showAddSupplement || editingSupplement) && (
        <div className={styles.modal} onClick={() => { setShowAddSupplement(false); setEditingSupplement(null); }}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>{editingSupplement ? "Edit Supplement" : "Add Supplement"}</h2>
            <form onSubmit={editingSupplement ? handleUpdateSupplement : handleAddSupplement}>
              <div className={styles.field}>{suppError.product_name && <span className={styles.fieldError}>{suppError.product_name}</span>}
                <label>Product Name *</label><input required value={suppForm.product_name} onChange={e => setSuppForm({...suppForm, product_name: e.target.value})} /></div>
              <div className={styles.field}><label>Date</label><input type="date" value={suppForm.prescribed_date} onChange={e => setSuppForm({...suppForm, prescribed_date: e.target.value})} /></div>
              <div className={styles.field}><label>Quantity</label><input type="number" value={suppForm.quantity} onChange={e => setSuppForm({...suppForm, quantity: e.target.value})} /></div>
              <div className={styles.row}><div className={styles.field}><label>MRP (₹)</label><input type="number" value={suppForm.mrp_inr} onChange={e => setSuppForm({...suppForm, mrp_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Rate (₹)</label><input type="number" value={suppForm.rate_inr} onChange={e => setSuppForm({...suppForm, rate_inr: e.target.value})} /></div></div>
              <div className={styles.field}><label>Notes</label><textarea value={suppForm.notes} onChange={e => setSuppForm({...suppForm, notes: e.target.value})} /></div>
              <div className={styles.modalActions}><button type="button" onClick={() => { setShowAddSupplement(false); setEditingSupplement(null); }}>Cancel</button><button type="submit">{editingSupplement ? "Update" : "Add"}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && (
        <div className={styles.modal} onClick={() => setShowAddTransaction(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Add Transaction</h2>
            <form onSubmit={handleAddTransaction}>
              <div className={styles.field}>{transError.transaction_date && <span className={styles.fieldError}>{transError.transaction_date}</span>}
                <label>Date *</label><input type="date" required value={transForm.transaction_date} onChange={e => setTransForm({...transForm, transaction_date: e.target.value})} /></div>
              <div className={styles.field}>{transError.product_plan && <span className={styles.fieldError}>{transError.product_plan}</span>}
                <label>Product/Plan *</label><input required value={transForm.product_plan} onChange={e => setTransForm({...transForm, product_plan: e.target.value})} /></div>
              <div className={styles.field}>{transError.type && <span className={styles.fieldError}>{transError.type}</span>}
                <label>Type</label><select value={transForm.type} onChange={e => setTransForm({...transForm, type: e.target.value})}>{TX_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className={styles.row}><div className={styles.field}><label>MRP (₹)</label><input type="number" value={transForm.mrp_inr} onChange={e => setTransForm({...transForm, mrp_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Rate (₹)</label><input type="number" value={transForm.rate_inr} onChange={e => setTransForm({...transForm, rate_inr: e.target.value})} /></div></div>
              <div className={styles.row}><div className={styles.field}><label>Received (₹)</label><input type="number" value={transForm.received_inr} onChange={e => setTransForm({...transForm, received_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Cost (₹)</label><input type="number" value={transForm.cost_inr} onChange={e => setTransForm({...transForm, cost_inr: e.target.value})} /></div></div>
              <div className={styles.field}><label>Mode</label><select value={transForm.pay_mode} onChange={e => setTransForm({...transForm, pay_mode: e.target.value})}>{PAY_MODES.map(p => <option key={p}>{p}</option>)}</select></div>
              <div className={styles.field}><label>Notes</label><textarea value={transForm.notes} onChange={e => setTransForm({...transForm, notes: e.target.value})} /></div>
              <div className={styles.profitPreview}>
                Profit Preview: ₹{((parseFloat(transForm.received_inr) || 0) - (parseFloat(transForm.cost_inr) || 0)).toFixed(2)} | Pending: ₹{Math.max(0, (parseFloat(transForm.rate_inr) || 0) - (parseFloat(transForm.received_inr) || 0)).toFixed(2)}
              </div>
              <div className={styles.modalActions}><button type="button" onClick={() => setShowAddTransaction(false)}>Cancel</button><button type="submit">Add</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Add Referral Modal */}
      {showAddReferral && (
        <div className={styles.modal} onClick={() => setShowAddReferral(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Add Referral</h2>
            <form onSubmit={handleAddReferral}>
              <div className={styles.field}>{referralError.referred_client_id && <span className={styles.fieldError}>{referralError.referred_client_id}</span>}
                <label>Refer Client *</label>
                <input value={searchClient} onChange={e => searchReferralClients(e.target.value)} placeholder="Search by name, ID, phone..." />
                {clientResults.length > 0 && <div className={styles.searchResults}>{clientResults.map(c => (
                  <div key={c.client_id} onClick={() => { setReferralForm({ referred_client_id: c.client_id }); setSearchClient(`${c.full_name} (${c.client_id})`); setClientResults([]); }}>{c.full_name} ({c.client_id})</div>
                ))}</div>}
              </div>
              <div className={styles.modalActions}><button type="button" onClick={() => { setShowAddReferral(false); setSearchClient(""); setClientResults([]); }}>Cancel</button><button type="submit">Add</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper for delete
async function handleDeleteClientTask(id) {
  if (!confirm("Delete this task?")) return;
  const { deleteClientTask } = await import("@/lib/fitnessApi");
  await deleteClientTask(id);
}