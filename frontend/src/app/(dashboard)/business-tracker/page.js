"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAllTransactions, createTransaction, deleteTransaction,
  getTransactionSummaryMonthly, searchClients
} from "@/lib/fitnessApi";
import styles from "./business.module.css";

const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const TX_TYPES = ["Membership", "Supplement", "Other"];

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BusinessTrackerPage() {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [formError, setFormError] = useState({});
  const [formSaving, setFormSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [form, setForm] = useState({
    client_id: "", transaction_date: "", product_plan: "", type: "Membership",
    mrp_inr: "", rate_inr: "", received_inr: "", cost_inr: "", pay_mode: "GPay", notes: ""
  });

  // Debounced search
  const searchTimeout = useRef(null);
  function handleClientSearch(value) {
    setClientSearch(value);
    setForm(prev => ({ ...prev, client_id: "" }));
    clearTimeout(searchTimeout.current);
    if (value.length < 2) { setClientResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchClients(value);
        setClientResults(results);
      } catch { setClientResults([]); }
    }, 300);
  }

  function selectClient(client) {
    setForm(prev => ({ ...prev, client_id: client.client_id }));
    setClientSearch(client.full_name);
    setClientResults([]);
  }

  useEffect(() => {
    loadTransactions();
    loadSummary();
  }, []);

  async function loadTransactions() {
    try { const data = await getAllTransactions(); setTransactions(data); }
    catch { } finally { setLoading(false); }
  }

  async function loadSummary() {
    try { const data = await getTransactionSummaryMonthly(); setSummary(data); }
    catch { }
  }

  function validateForm() {
    const errors = {};
    if (!form.client_id) errors.client_id = "Client required";
    if (!form.transaction_date) errors.transaction_date = "Date required";
    if (!form.product_plan?.trim()) errors.product_plan = "Product/Plan required";
    if (!form.type) errors.type = "Type required";
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length) { setFormError(errors); return; }

    // Auto-calculate pending = rate - received
    const rate = parseFloat(form.rate_inr) || 0;
    const received = parseFloat(form.received_inr) || 0;
    const pending = Math.max(0, rate - received);

    setFormSaving(true); setSubmitError(null);
    try {
      const newTx = await createTransaction({ ...form, pending_inr: pending });

      // Optimistic update
      setTransactions(prev => [newTx, ...prev]);
      setShowAdd(false);
      setForm({ client_id: "", transaction_date: "", product_plan: "", type: "Membership", mrp_inr: "", rate_inr: "", received_inr: "", cost_inr: "", pay_mode: "GPay", notes: "" });
      setFormError({});
      setClientSearch("");
      loadSummary(); // refresh totals
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this transaction?")) return;
    try {
      await deleteTransaction(id);
      setTransactions(prev => prev.filter(t => t.id !== id));
      loadSummary();
    } catch { loadTransactions(); }
  }

  const stats = summary?.totals || { received: 0, pending: 0, profit: 0, transactions: 0, membership: 0, supplement: 0 };
  const profitPreview = ((parseFloat(form.received_inr) || 0) - (parseFloat(form.cost_inr) || 0)).toFixed(2);
  const pendingPreview = Math.max(0, (parseFloat(form.rate_inr) || 0) - (parseFloat(form.received_inr) || 0)).toFixed(2);

  return (
    <div className={styles.container}>
      {submitError && <div className={styles.errorBanner} onClick={() => setSubmitError(null)}>
        <i className="fa-solid fa-circle-exclamation"></i> {submitError} <span>(click to dismiss)</span>
      </div>}

      <div className={styles.header}>
        <h1>Business Tracker</h1>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          <i className="fa-solid fa-plus"></i> Add Transaction
        </button>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.received || 0).toLocaleString()}</span>Total Received</div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.pending || 0).toLocaleString()}</span>Total Pending</div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.profit || 0).toLocaleString()}</span>Total Profit</div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.transactions || 0}</span>Transactions</div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.membership || 0).toLocaleString()}</span>Membership Rev</div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.supplement || 0).toLocaleString()}</span>Supplement Rev</div>
      </div>

      <div className={styles.tableWrap}>
        {loading ? <div className={styles.empty}><i className="fa-solid fa-spinner fa-spin"></i> Loading...</div> : (
          <>
            <table className={styles.table}>
              <thead>
                <tr><th>Date</th><th>Client</th><th>Product/Plan</th><th>Type</th><th>MRP</th><th>Rate</th><th>Received</th><th>Pending</th><th>Cost</th><th>Profit</th><th>Mode</th><th></th></tr>
              </thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id}>
                    <td>{formatDate(t.transaction_date)}</td>
                    <td><Link href={`/clients/${t.client_id}`} className={styles.clientLink}>{t.client_name || t.client_id}</Link></td>
                    <td>{t.product_plan}</td>
                    <td><span className={styles[`type_${t.type}`]}>{t.type}</span></td>
                    <td>₹{t.mrp_inr || "—"}</td>
                    <td>₹{t.rate_inr}</td>
                    <td>₹{t.received_inr}</td>
                    <td className={t.pending_inr > 0 ? styles.pending : ""}>₹{t.pending_inr}</td>
                    <td>₹{t.cost_inr}</td>
                    <td className={t.profit_inr > 0 ? styles.profit : t.profit_inr < 0 ? styles.loss : ""}>₹{t.profit_inr}</td>
                    <td>{t.pay_mode}</td>
                    <td><button className={styles.delBtn} onClick={() => handleDelete(t.id)}><i className="fa-solid fa-trash"></i></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && <div className={styles.empty}>No transactions yet</div>}
          </>
        )}
      </div>

      {summary?.months && (
        <div className={styles.monthlySection}>
          <h2>Monthly Summary ({new Date().getFullYear()})</h2>
          <table className={styles.table}>
            <thead><tr><th>Month</th><th>Received</th><th>Pending</th><th>Cost</th><th>Profit</th><th>Membership</th><th>Supplement</th><th>Count</th></tr></thead>
            <tbody>
              {summary.months.map(m => (
                <tr key={m.month}><td>{m.month}</td><td>₹{Number(m.received||0).toLocaleString()}</td><td>₹{Number(m.pending||0).toLocaleString()}</td><td>₹{Number(m.cost||0).toLocaleString()}</td><td className={Number(m.profit||0)>0?styles.profit:""}>₹{Number(m.profit||0).toLocaleString()}</td><td>₹{Number(m.membership||0).toLocaleString()}</td><td>₹{Number(m.supplement||0).toLocaleString()}</td><td>{m.transactions}</td></tr>
              ))}
              <tr className={styles.totalsRow}><td><strong>Total</strong></td><td><strong>₹{Number(summary.totals.received||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.pending||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.cost||0).toLocaleString()}</strong></td><td><strong className={styles.profit}>₹{Number(summary.totals.profit||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.membership||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.supplement||0).toLocaleString()}</strong></td><td><strong>{summary.totals.transactions}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className={styles.modal} onClick={() => setShowAdd(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>Add Transaction</h2>
            <form onSubmit={handleSubmit}>
              <div className={styles.field}>{formError.client_id && <span className={styles.fieldError}>{formError.client_id}</span>}
                <label>Client *</label>
                <input value={clientSearch} onChange={e => handleClientSearch(e.target.value)} placeholder="Search by name, ID, phone..." autoComplete="off" />
                {clientResults.length > 0 && <div className={styles.searchResults}>
                  {clientResults.map(c => <div key={c.client_id} onClick={() => selectClient(c)}>{c.full_name} ({c.client_id}) <span style={{color:"#6b7280",fontSize:"12px"}}>{c.status}</span></div>)}
                </div>}
              </div>
              <div className={styles.field}>{formError.transaction_date && <span className={styles.fieldError}>{formError.transaction_date}</span>}
                <label>Date *</label><input type="date" value={form.transaction_date} onChange={e => { setForm({...form, transaction_date: e.target.value}); setFormError(prev => ({...prev, transaction_date: null})); }} /></div>
              <div className={styles.field}>{formError.product_plan && <span className={styles.fieldError}>{formError.product_plan}</span>}
                <label>Product/Plan *</label><input value={form.product_plan} onChange={e => { setForm({...form, product_plan: e.target.value}); setFormError(prev => ({...prev, product_plan: null})); }} placeholder="e.g., 3 Month Plan, Protein Shake" /></div>
              <div className={styles.field}>{formError.type && <span className={styles.fieldError}>{formError.type}</span>}
                <label>Type</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>{TX_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className={styles.row}>
                <div className={styles.field}><label>MRP (₹)</label><input type="number" value={form.mrp_inr} onChange={e => setForm({...form, mrp_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Rate (₹)</label><input type="number" value={form.rate_inr} onChange={e => setForm({...form, rate_inr: e.target.value})} /></div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}><label>Received (₹)</label><input type="number" value={form.received_inr} onChange={e => setForm({...form, received_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Cost (₹)</label><input type="number" value={form.cost_inr} onChange={e => setForm({...form, cost_inr: e.target.value})} /></div>
              </div>
              <div className={styles.field}><label>Mode</label><select value={form.pay_mode} onChange={e => setForm({...form, pay_mode: e.target.value})}>{PAY_MODES.map(p => <option key={p}>{p}</option>)}</select></div>
              <div className={styles.field}><label>Notes</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
              <div className={styles.profitPreview}>
                <span>Profit: <strong>₹{profitPreview}</strong></span>
                <span>Pending: <strong>₹{pendingPreview}</strong></span>
              </div>
              <div className={styles.modalActions}>
                <button type="button" onClick={() => { setShowAdd(false); setFormError({}); }}>Cancel</button>
                <button type="submit" disabled={formSaving}>{formSaving ? "Adding..." : "Add Transaction"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";