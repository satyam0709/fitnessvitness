"use client";

import { useState, useEffect, useRef } from "react";
import {
  getAllConsultations,
  createConsultation,
  deleteConsultation,
  searchClients
} from "@/lib/fitnessApi";
import styles from "./consultations.module.css";
import Link from "next/link";

const CONSULT_TYPES = ["Onboarding", "Diet Review", "Check-in", "Follow-up", "Other"];

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [formError, setFormError] = useState({});
  const [formSaving, setFormSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [form, setForm] = useState({
    client_id: "",
    consult_date: new Date().toISOString().split('T')[0],
    consult_type: "Follow-up",
    weight_kg: "",
    key_observations: "",
    diet_changes: "",
    next_steps: "",
    next_appointment: ""
  });

  // Debounced client search
  const searchTimeout = useRef(null);
  function handleClientSearch(value) {
    setClientSearch(value);
    setForm(prev => ({ ...prev, client_id: "" }));
    clearTimeout(searchTimeout.current);
    if (value.length < 2) {
      setClientResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchClients(value);
        setClientResults(results);
      } catch {
        setClientResults([]);
      }
    }, 300);
  }

  function selectClient(client) {
    setForm(prev => ({ ...prev, client_id: client.client_id }));
    setClientSearch(`${client.full_name} (${client.client_id})`);
    setClientResults([]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getAllConsultations();
        if (!cancelled) setConsultations(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSubmitError("Failed to load consultations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function validateForm() {
    const errors = {};
    if (!form.client_id) errors.client_id = "Client selection required";
    if (!form.consult_date) errors.consult_date = "Date required";
    if (!form.consult_type) errors.consult_type = "Type required";
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length) {
      setFormError(errors);
      return;
    }

    setFormSaving(true);
    setSubmitError(null);
    try {
      const newConsult = await createConsultation(form.client_id, form);
      
      // Optimistic update
      setConsultations(prev => [newConsult, ...prev]);
      setShowAdd(false);
      
      // Reset form
      setForm({
        client_id: "",
        consult_date: new Date().toISOString().split('T')[0],
        consult_type: "Follow-up",
        weight_kg: "",
        key_observations: "",
        diet_changes: "",
        next_steps: "",
        next_appointment: ""
      });
      setClientSearch("");
      setFormError({});
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Are you sure you want to delete this consultation record?")) return;
    try {
      await deleteConsultation(id);
      setConsultations(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert("Failed to delete record");
    }
  }

  // Calculate stats
  const totalConsultations = consultations.length;
  const thisMonth = consultations.filter(c => {
    const d = new Date(c.consult_date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const avgWeight = consultations.length > 0
    ? (consultations.reduce((acc, c) => acc + (parseFloat(c.weight_kg) || 0), 0) / consultations.filter(c => c.weight_kg).length || 0).toFixed(1)
    : 0;

  return (
    <div className={styles.container}>
      {submitError && (
        <div className={styles.errorBanner} onClick={() => setSubmitError(null)}>
          <i className="fa-solid fa-circle-exclamation"></i>
          {submitError}
          <span style={{marginLeft: 'auto', fontSize: '11px', opacity: 0.7}}>(Click to dismiss)</span>
        </div>
      )}

      <header className={styles.header}>
        <div>
          <h1>Consultations</h1>
          <p>Clinical tracking and dietetic progress reviews</p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          <i className="fa-solid fa-plus"></i> New Consultation
        </button>
      </header>

      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Reviews</span>
          <span className={styles.statValue}>{totalConsultations}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>This Month</span>
          <span className={styles.statValue}>{thisMonth}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Avg. Weight Tracked</span>
          <span className={styles.statValue}>{avgWeight} kg</span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}></div>
            <p>Fetching clinical records...</p>
          </div>
        ) : consultations.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fa-solid fa-notes-medical"></i>
            <p>No consultations recorded yet</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Type</th>
                <th>Weight</th>
                <th>Observations</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {consultations.map(c => (
                <tr key={c.id}>
                  <td><strong>{formatDate(c.consult_date)}</strong></td>
                  <td>
                    <Link href={`/clients/${c.client_id}`} className={styles.clientLink}>
                      {c.full_name || c.client_id}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`${styles.typeBadge} ${
                        styles[
                          `type_${String(c.consult_type || "Other").replace(/[^a-zA-Z0-9]+/g, "_")}`
                        ] || styles.type_Other
                      }`}
                    >
                      {c.consult_type}
                    </span>
                  </td>
                  <td><span className={styles.weightText}>{c.weight_kg ? `${c.weight_kg} kg` : "—"}</span></td>
                  <td className={styles.notesCell} title={c.key_observations}>
                    {c.key_observations || "No notes"}
                  </td>
                  <td className={styles.actionsCell}>
                    <button className={styles.actionBtn} title="View Details">
                      <i className="fa-solid fa-eye"></i>
                    </button>
                    <button 
                      className={`${styles.actionBtn} ${styles.delBtn}`} 
                      onClick={() => handleDelete(c.id)}
                      title="Delete"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className={styles.modal} onClick={() => setShowAdd(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>New consultation</h2>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => {
                  setShowAdd(false);
                  setFormError({});
                }}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>Client &amp; visit</div>
                <div className={`${styles.field} ${styles.fieldSearchWrap}`}>
                  {formError.client_id ? (
                    <span className={styles.fieldError}>{formError.client_id}</span>
                  ) : null}
                  <label htmlFor="consult-client-search">Client *</label>
                  <input
                    id="consult-client-search"
                    value={clientSearch}
                    onChange={(e) => handleClientSearch(e.target.value)}
                    placeholder="Search by name, ID or phone…"
                    autoComplete="off"
                  />
                  {clientResults.length > 0 && (
                    <div className={styles.searchResults}>
                      {clientResults.map((client) => (
                        <div
                          key={client.client_id}
                          className={styles.searchItem}
                          onClick={() => selectClient(client)}
                        >
                          <strong>{client.full_name}</strong> ({client.client_id})
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {client.phone} · {client.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    {formError.consult_date ? (
                      <span className={styles.fieldError}>{formError.consult_date}</span>
                    ) : null}
                    <label htmlFor="consult-date">Date *</label>
                    <input
                      id="consult-date"
                      type="date"
                      value={form.consult_date}
                      onChange={(e) => setForm({ ...form, consult_date: e.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    {formError.consult_type ? (
                      <span className={styles.fieldError}>{formError.consult_type}</span>
                    ) : null}
                    <label htmlFor="consult-type">Type *</label>
                    <select
                      id="consult-type"
                      value={form.consult_type}
                      onChange={(e) => setForm({ ...form, consult_type: e.target.value })}
                    >
                      {CONSULT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="consult-weight">Weight (kg)</label>
                    <input
                      id="consult-weight"
                      type="number"
                      step="0.1"
                      value={form.weight_kg}
                      onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="consult-next-appt">Next appointment</label>
                    <input
                      id="consult-next-appt"
                      type="text"
                      value={form.next_appointment}
                      onChange={(e) => setForm({ ...form, next_appointment: e.target.value })}
                      placeholder="e.g. Mon 10am"
                    />
                  </div>
                </div>
              </div>

              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>Clinical notes</div>
                <div className={styles.field}>
                  <label htmlFor="consult-obs">Key observations</label>
                  <textarea
                    id="consult-obs"
                    rows={3}
                    value={form.key_observations}
                    onChange={(e) => setForm({ ...form, key_observations: e.target.value })}
                    placeholder="Mood, energy, adherence…"
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="consult-diet">Diet changes &amp; next steps</label>
                  <textarea
                    id="consult-diet"
                    rows={3}
                    value={form.diet_changes}
                    onChange={(e) => setForm({ ...form, diet_changes: e.target.value })}
                    placeholder="Plan adjustments, homework for client…"
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setShowAdd(false);
                    setFormError({});
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn} disabled={formSaving}>
                  {formSaving ? "Saving…" : "Save record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
