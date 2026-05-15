"use client";

import { useState, useEffect, useRef } from "react";
import {
  getAllMealPlans,
  createMealPlan,
  deleteMealPlan,
  searchClients
} from "@/lib/fitnessApi";
import styles from "./meal-plans.module.css";
import Link from "next/link";

export default function MealPlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [formError, setFormError] = useState({});
  const [formSaving, setFormSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [form, setForm] = useState({
    client_id: "",
    plan_name: "",
    start_date: new Date().toISOString().split('T')[0],
    end_date: "",
    calories: "",
    protein_g: "",
    carbs_g: "",
    fats_g: "",
    notes: ""
  });

  // Debounced search
  const searchTimeout = useRef(null);
  const selectedClientNameRef = useRef("");
  function handleClientSearch(value) {
    setClientSearch(value);
    setForm((prev) => ({ ...prev, client_id: "" }));
    selectedClientNameRef.current = "";
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
    setForm((prev) => ({ ...prev, client_id: client.client_id }));
    selectedClientNameRef.current = client.full_name || "";
    setClientSearch(`${client.full_name} (${client.client_id})`);
    setClientResults([]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getAllMealPlans();
        if (!cancelled) setPlans(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setSubmitError(err?.message || "Failed to load meal plans");
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
    if (!form.client_id) errors.client_id = "Client required";
    if (!form.plan_name) errors.plan_name = "Plan name required";
    if (!form.calories) errors.calories = "Calories required";
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
      const { client_id: cid, ...planBody } = form;
      const newPlan = await createMealPlan(cid, planBody);
      const display = {
        ...newPlan,
        full_name: selectedClientNameRef.current || newPlan.full_name || form.client_id,
      };
      setPlans((prev) => [display, ...prev]);
      setShowAdd(false);
      setForm({
        client_id: "", plan_name: "", start_date: new Date().toISOString().split('T')[0],
        end_date: "", calories: "", protein_g: "", carbs_g: "", fats_g: "", notes: ""
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
    if (!confirm("Delete this meal plan?")) return;
    try {
      await deleteMealPlan(id);
      setPlans(prev => prev.filter(p => p.id !== id));
    } catch {
      alert("Delete failed");
    }
  }

  // Stats
  const activePlans = plans.filter(p => p.is_active !== 0).length;
  const avgCals = plans.length > 0 
    ? Math.round(plans.reduce((acc, p) => acc + (parseInt(p.calories) || 0), 0) / plans.length)
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
          <h1>Meal Plans</h1>
          <p>Precision nutrition protocols and macro targets</p>
        </div>
        <button className={styles.createBtn} onClick={() => setShowAdd(true)}>
          <i className="fa-solid fa-plus"></i> Create Plan
        </button>
      </header>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Active Protocols</span>
          <span className={styles.statValue}>{activePlans}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Avg. Calorie Target</span>
          <span className={styles.statValue}>{avgCals} <span>kcal</span></span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Plans Issued</span>
          <span className={styles.statValue}>{plans.length}</span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>Loading nutrition database...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fa-solid fa-utensils"></i>
            <p>No meal plans found. Start by creating one!</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Protocol Name</th>
                <th>Client</th>
                <th>Macros (P/C/F)</th>
                <th>Calories</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td><span className={styles.planName}>{p.plan_name}</span></td>
                  <td>
                    <Link href={`/clients/${p.client_id}`} className={styles.clientLink}>
                      {p.full_name || p.client_id}
                    </Link>
                  </td>
                  <td>
                    <div className={styles.macroRow}>
                      <span className={styles.macroP}>{p.protein_g}g</span>
                      <span className={styles.macroC}>{p.carbs_g}g</span>
                      <span className={styles.macroF}>{p.fats_g}g</span>
                    </div>
                  </td>
                  <td><div className={styles.calories}>{p.calories} <span>kcal</span></div></td>
                  <td>
                    <span className={`${styles.statusPill} ${p.is_active !== 0 ? styles.statusActive : styles.statusArchived}`}>
                      {p.is_active !== 0 ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td>
                    <button className={styles.actionBtn}><i className="fa-solid fa-file-pdf"></i></button>
                    <button className={`${styles.actionBtn} ${styles.delBtn}`} onClick={() => handleDelete(p.id)}>
                      <i className="fa-solid fa-trash"></i>
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
              <h2>Create meal plan</h2>
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
                <div className={styles.sectionLabel}>Client</div>
                <div className={`${styles.field} ${styles.fieldSearchWrap}`}>
                  {formError.client_id ? (
                    <span className={styles.fieldError}>{formError.client_id}</span>
                  ) : null}
                  <label htmlFor="meal-client-search">Client *</label>
                  <input
                    id="meal-client-search"
                    value={clientSearch}
                    onChange={(e) => handleClientSearch(e.target.value)}
                    placeholder="Search by name or ID…"
                    autoComplete="off"
                  />
                  {clientResults.length > 0 && (
                    <div className={styles.searchResults}>
                      {clientResults.map((c) => (
                        <div
                          key={c.client_id}
                          className={styles.searchItem}
                          onClick={() => selectClient(c)}
                        >
                          <span>
                            <strong>{c.full_name}</strong> ({c.client_id})
                          </span>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>{c.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>Protocol</div>
                <div className={styles.field}>
                  {formError.plan_name ? (
                    <span className={styles.fieldError}>{formError.plan_name}</span>
                  ) : null}
                  <label htmlFor="meal-plan-name">Plan name *</label>
                  <input
                    id="meal-plan-name"
                    value={form.plan_name}
                    onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
                    placeholder="e.g. Fat loss phase 1"
                  />
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    {formError.calories ? (
                      <span className={styles.fieldError}>{formError.calories}</span>
                    ) : null}
                    <label htmlFor="meal-calories">Daily calories *</label>
                    <input
                      id="meal-calories"
                      type="number"
                      value={form.calories}
                      onChange={(e) => setForm({ ...form, calories: e.target.value })}
                      placeholder="2200"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="meal-start">Start date</label>
                    <input
                      id="meal-start"
                      type="date"
                      value={form.start_date}
                      onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="meal-end">End date</label>
                    <input
                      id="meal-end"
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.sectionLabel} style={{ marginTop: 8 }}>
                  Macros (g/day)
                </div>
                <div className={styles.macroStrip}>
                  <div className={`${styles.field} ${styles.macroField}`}>
                    <label htmlFor="meal-p">Protein</label>
                    <input
                      id="meal-p"
                      type="number"
                      value={form.protein_g}
                      onChange={(e) => setForm({ ...form, protein_g: e.target.value })}
                      placeholder="—"
                    />
                  </div>
                  <div className={`${styles.field} ${styles.macroField}`}>
                    <label htmlFor="meal-c">Carbs</label>
                    <input
                      id="meal-c"
                      type="number"
                      value={form.carbs_g}
                      onChange={(e) => setForm({ ...form, carbs_g: e.target.value })}
                      placeholder="—"
                    />
                  </div>
                  <div className={`${styles.field} ${styles.macroField}`}>
                    <label htmlFor="meal-f">Fats</label>
                    <input
                      id="meal-f"
                      type="number"
                      value={form.fats_g}
                      onChange={(e) => setForm({ ...form, fats_g: e.target.value })}
                      placeholder="—"
                    />
                  </div>
                </div>
              </div>

              <div className={styles.formSection}>
                <div className={styles.sectionLabel}>Notes</div>
                <div className={styles.field}>
                  <label htmlFor="meal-notes">Dietitian notes</label>
                  <textarea
                    id="meal-notes"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Hydration, timing, restrictions…"
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
                  {formSaving ? "Creating…" : "Create plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
