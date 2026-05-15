"use client";

import { useState, useEffect, useRef } from "react";
import {
  getAllTransactions, createTransaction, deleteTransaction,
  getTransactionSummaryMonthly, searchClients, getRevenueSplit,
} from "@/lib/fitnessApi";
import { connectGlobalSocket } from "@/lib/api";
import styles from "./business.module.css";
import Link from "next/link";

const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const TX_TYPES = ["Membership", "Supplement", "Other"];

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtInr(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
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

  const [revenueWindow, setRevenueWindow] = useState("month");
  const [revenueDate, setRevenueDate] = useState(() => todayYmdLocal());
  const [revenueData, setRevenueData] = useState(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueErr, setRevenueErr] = useState(null);

  const revenueRef = useRef({ window: "month", date: todayYmdLocal() });
  revenueRef.current = { window: revenueWindow, date: revenueDate };

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

  async function loadRevenueSplit() {
    const { window: w, date: d } = revenueRef.current;
    setRevenueLoading(true);
    setRevenueErr(null);
    try {
      const data = await getRevenueSplit({ window: w, date: d });
      setRevenueData(data);
    } catch (e) {
      setRevenueErr(e?.message || "Could not load revenue split");
      setRevenueData(null);
    } finally {
      setRevenueLoading(false);
    }
  }

  useEffect(() => {
    void loadRevenueSplit();
  }, [revenueWindow, revenueDate]);

  useEffect(() => {
    const cleanups = [];
    let cancelled = false;
    (async () => {
      try {
        const s = await connectGlobalSocket(true);
        if (!s || cancelled) return;
        const onFitness = () => {
          if (cancelled) return;
          void loadRevenueSplit();
          void loadSummary();
          void loadTransactions();
        };
        s.on("fitness:changed", onFitness);
        cleanups.push(() => s.off("fitness:changed", onFitness));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
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
      loadSummary();
      loadRevenueSplit();
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
      loadRevenueSplit();
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
        <div className={styles.headerActions}>
          <Link href="/external-sales" className={styles.externalLink}>
            Walk-in / external sale
          </Link>
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            <i className="fa-solid fa-plus"></i> Add Transaction
          </button>
        </div>
      </div>

      <div className={styles.statsBar}>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.received || 0).toLocaleString()}</span><span className={styles.statLabel}>Received</span></div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.pending || 0).toLocaleString()}</span><span className={styles.statLabel}>Pending</span></div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.profit || 0).toLocaleString()}</span><span className={styles.statLabel}>Profit</span></div>
        <div className={styles.stat}><span className={styles.statValue}>{stats.transactions || 0}</span><span className={styles.statLabel}>Count</span></div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.membership || 0).toLocaleString()}</span><span className={styles.statLabel}>Membership</span></div>
        <div className={styles.stat}><span className={styles.statValue}>₹{Number(stats.supplement || 0).toLocaleString()}</span><span className={styles.statLabel}>Supplement</span></div>
      </div>

      <section className={styles.revenueSection}>
        <div className={styles.revenueHeader}>
          <h2><i className="fa-solid fa-chart-pie" /> Revenue by line of business</h2>
          <p className={styles.revenueSub}>Server-side totals from <code>fitness_transactions</code>. Use transaction <strong>Type</strong>: Membership / Other → plans &amp; diet programs; Supplement → supplement sales.</p>
        </div>
        <div className={styles.revenueControls}>
          <div className={styles.periodTabs} role="tablist" aria-label="Period">
            {["day", "month", "year"].map((w) => (
              <button
                key={w}
                type="button"
                className={revenueWindow === w ? styles.periodTabActive : styles.periodTab}
                onClick={() => setRevenueWindow(w)}
              >
                {w === "day" ? "Day" : w === "month" ? "Month" : "Year"}
              </button>
            ))}
          </div>
          <label className={styles.datePick}>
            <span>Reference date</span>
            <input type="date" value={revenueDate} onChange={(e) => setRevenueDate(e.target.value)} />
          </label>
        </div>
        {revenueErr ? (
          <div className={styles.errorBanner} role="alert">
            <i className="fa-solid fa-circle-exclamation" /> {revenueErr}
          </div>
        ) : null}
        {revenueLoading ? (
          <div className={styles.empty}>
            <i className="fa-solid fa-spinner fa-spin" /> Loading revenue…
          </div>
        ) : revenueData ? (
          <>
            <p className={styles.periodLabel}>
              <strong>{revenueData.periodLabel}</strong>
              <span className={styles.rangeSmall}>
                {" "}
                ({revenueData.range.from} → {revenueData.range.to})
              </span>
            </p>
            <div className={styles.revenueGrid}>
              <div className={`${styles.revenueCard} ${styles.revenueCardDiet}`}>
                <h3>{revenueData.diet_course.sectionTitle}</h3>
                <p className={styles.revenueHint}>{revenueData.classification.diet_course}</p>
                <div className={styles.revenueMetrics}>
                  <div><span>Received</span><strong>{fmtInr(revenueData.diet_course.received)}</strong></div>
                  <div><span>Pending</span><strong>{fmtInr(revenueData.diet_course.pending)}</strong></div>
                  <div><span>Cost</span><strong>{fmtInr(revenueData.diet_course.cost)}</strong></div>
                  <div><span>Profit</span><strong className={styles.profit}>{fmtInr(revenueData.diet_course.profit)}</strong></div>
                  <div><span>Transactions</span><strong>{revenueData.diet_course.transactions}</strong></div>
                </div>
              </div>
              <div className={`${styles.revenueCard} ${styles.revenueCardSupp}`}>
                <h3>{revenueData.supplements.sectionTitle}</h3>
                <p className={styles.revenueHint}>{revenueData.classification.supplements}</p>
                <div className={styles.revenueMetrics}>
                  <div><span>Received</span><strong>{fmtInr(revenueData.supplements.received)}</strong></div>
                  <div><span>Pending</span><strong>{fmtInr(revenueData.supplements.pending)}</strong></div>
                  <div><span>Cost</span><strong>{fmtInr(revenueData.supplements.cost)}</strong></div>
                  <div><span>Profit</span><strong className={styles.profit}>{fmtInr(revenueData.supplements.profit)}</strong></div>
                  <div><span>Transactions</span><strong>{revenueData.supplements.transactions}</strong></div>
                </div>
              </div>
            </div>
            <h3 className={styles.yearTableTitle}>
              Ten-year history ({revenueData.yearRange.from}–{revenueData.yearRange.to}) — received
            </h3>
            <div className={styles.yearTableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Plans &amp; diet programs</th>
                    <th>Supplements</th>
                    <th>Combined</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueData.years.map((row) => (
                    <tr key={row.year}>
                      <td><strong>{row.year}</strong></td>
                      <td>{fmtInr(row.diet_course.received)}</td>
                      <td>{fmtInr(row.supplements.received)}</td>
                      <td>{fmtInr(row.diet_course.received + row.supplements.received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <div className={styles.tableWrap}>
        {loading ? <div className={styles.empty}><i className="fa-solid fa-spinner fa-spin"></i> Loading financial data...</div> : (
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
            {transactions.length === 0 && <div className={styles.empty}>No transaction history found</div>}
          </>
        )}
      </div>

      {summary?.months && (
        <div className={styles.monthlySection}>
          <h2><i className="fa-solid fa-calendar-check"></i> Monthly Inflow Analysis</h2>
          <table className={styles.table}>
            <thead><tr><th>Month</th><th>Received</th><th>Pending</th><th>Cost</th><th>Profit</th><th>Membership</th><th>Supplement</th><th>Count</th></tr></thead>
            <tbody>
              {summary.months.map(m => (
                <tr key={m.month}><td><strong>{m.month}</strong></td><td>₹{Number(m.received||0).toLocaleString()}</td><td>₹{Number(m.pending||0).toLocaleString()}</td><td>₹{Number(m.cost||0).toLocaleString()}</td><td className={Number(m.profit||0)>0?styles.profit:""}>₹{Number(m.profit||0).toLocaleString()}</td><td>₹{Number(m.membership||0).toLocaleString()}</td><td>₹{Number(m.supplement||0).toLocaleString()}</td><td>{m.transactions}</td></tr>
              ))}
              <tr className={styles.totalsRow}><td><strong>Total Portfolio</strong></td><td><strong>₹{Number(summary.totals.received||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.pending||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.cost||0).toLocaleString()}</strong></td><td><strong className={styles.profit}>₹{Number(summary.totals.profit||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.membership||0).toLocaleString()}</strong></td><td><strong>₹{Number(summary.totals.supplement||0).toLocaleString()}</strong></td><td><strong>{summary.totals.transactions}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className={styles.modal} onClick={() => setShowAdd(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>New Transaction</h2>
            <form onSubmit={handleSubmit}>
              <div className={styles.field}>{formError.client_id && <span className={styles.fieldError}>{formError.client_id}</span>}
                <label>Client *</label>
                <input value={clientSearch} onChange={e => handleClientSearch(e.target.value)} placeholder="Search by name, ID, phone..." autoComplete="off" />
                {clientResults.length > 0 && <div className={styles.searchResults}>
                  {clientResults.map(c => <div key={c.client_id} className={styles.searchItem} onClick={() => selectClient(c)}><strong>{c.full_name}</strong> ({c.client_id}) <span style={{color:"#94a3b8",fontSize:"12px"}}>{c.status}</span></div>)}
                </div>}
              </div>
              <div className={styles.field}>{formError.transaction_date && <span className={styles.fieldError}>{formError.transaction_date}</span>}
                <label>Transaction Date *</label><input type="date" value={form.transaction_date} onChange={e => { setForm({...form, transaction_date: e.target.value}); setFormError(prev => ({...prev, transaction_date: null})); }} /></div>
              <div className={styles.field}>{formError.product_plan && <span className={styles.fieldError}>{formError.product_plan}</span>}
                <label>Product/Plan Protocol *</label><input value={form.product_plan} onChange={e => { setForm({...form, product_plan: e.target.value}); setFormError(prev => ({...prev, product_plan: null})); }} placeholder="e.g., 3 Month Elite Plan" /></div>
              <div className={styles.field}>{formError.type && <span className={styles.fieldError}>{formError.type}</span>}
                <label>Classification</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>{TX_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className={styles.row}>
                <div className={styles.field}><label>MRP (₹)</label><input type="number" value={form.mrp_inr} onChange={e => setForm({...form, mrp_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Final Rate (₹)</label><input type="number" value={form.rate_inr} onChange={e => setForm({...form, rate_inr: e.target.value})} /></div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}><label>Amount Received (₹)</label><input type="number" value={form.received_inr} onChange={e => setForm({...form, received_inr: e.target.value})} /></div>
                <div className={styles.field}><label>Direct Cost (₹)</label><input type="number" value={form.cost_inr} onChange={e => setForm({...form, cost_inr: e.target.value})} /></div>
              </div>
              <div className={styles.field}><label>Payment Mode</label><select value={form.pay_mode} onChange={e => setForm({...form, pay_mode: e.target.value})}>{PAY_MODES.map(p => <option key={p}>{p}</option>)}</select></div>
              <div className={styles.field}><label>Internal Notes</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="e.g., Early bird discount, installment paid..." /></div>
              <div className={styles.profitPreview}>
                <span>Projected Profit: <strong>₹{profitPreview}</strong></span>
                <span style={{marginLeft: 'auto'}}>Outstanding: <strong style={{color: parseFloat(pendingPreview) > 0 ? '#b45309' : '#166534'}}>₹{pendingPreview}</strong></span>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => { setShowAdd(false); setFormError({}); }}>Discard</button>
                <button type="submit" className={styles.submitBtn} disabled={formSaving}>{formSaving ? "Recording..." : "Record Transaction"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}