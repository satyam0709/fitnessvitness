"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import styles from "./new-client.module.css";

const SOURCE_OPTIONS = [
  "BNI", "Instagram", "Facebook", "Referral - Existing Client", "Friend / Family", "Walk-in", "Online / Website", "Corporate / Company"
];
const PLAN_TYPES = ["1 Month Plan", "3 Month Plan", "6 Month Plan", "1 Year Plan"];

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", age: "", city: "", address: "", occupation: "",
    emergency_contact: "", referred_by_client_id: "", referred_by_name: "", source: "Walk-in", tier: 3,
    health_goal: "", plan_type: "", plan_start_date: new Date().toISOString().split('T')[0], follow_up_freq_days: 14,
    medical_conditions: "", allergies: "", activity_level: "", current_medications: "",
    height_cm: "", start_weight_kg: "", current_weight_kg: "", target_weight_kg: ""
  });

  async function handleSearchReferrer(query) {
    if (query.length < 2) return setSearchResults([]);
    try {
      const res = await apiFetch(`/fitness/clients/search?q=${query}`);
      const json = await res.json();
      if (json.success) setSearchResults(json.data);
    } catch (err) { console.error(err); }
  }

  function buildPayload() {
    const str = (v) => {
      const s = String(v ?? "").trim();
      return s === "" ? null : s;
    };
    const num = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      full_name: form.full_name.trim(),
      phone: str(form.phone),
      email: str(form.email),
      age: num(form.age),
      city: str(form.city),
      address: str(form.address),
      occupation: str(form.occupation),
      emergency_contact: str(form.emergency_contact),
      referred_by_client_id: str(form.referred_by_client_id),
      referred_by_name: str(form.referred_by_name),
      source: form.source || "Walk-in",
      tier: num(form.tier) ?? 3,
      health_goal: str(form.health_goal),
      plan_type: str(form.plan_type),
      plan_start_date: str(form.plan_start_date),
      follow_up_freq_days: num(form.follow_up_freq_days) ?? 14,
      medical_conditions: str(form.medical_conditions),
      allergies: str(form.allergies),
      activity_level: str(form.activity_level),
      current_medications: str(form.current_medications),
      height_cm: num(form.height_cm),
      start_weight_kg: num(form.start_weight_kg),
      current_weight_kg: num(form.start_weight_kg),
      target_weight_kg: num(form.target_weight_kg),
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      alert("Full name is required.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/fitness/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json();
      if (json.success) {
        router.push(`/clients/${json.data.client_id}`);
      } else if (json.errors && typeof json.errors === "object") {
        alert(Object.entries(json.errors).map(([k, v]) => `${k}: ${v}`).join("\n"));
      } else {
        alert(json.message || "Failed to create client");
      }
    } catch (err) {
      console.error("Failed:", err);
      alert("Error creating client");
    } finally {
      setLoading(false);
    }
  }

  const updateField = (field, value) => setForm({ ...form, [field]: value });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.brand}>
          <i className="fa-solid fa-user-plus"></i>
          ONBOARDING NEW CLIENT
        </div>
        <Link href="/clients" className={styles.backLink}>
          <i className="fa-solid fa-arrow-left"></i> Back to Portfolio
        </Link>
      </div>

      <form onSubmit={handleSubmit} className={styles.profileGrid}>
        {/* PERSONAL DETAILS */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-user"></i>
            Personal Details
          </div>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <div className={styles.field}><label>Full Name *</label><input required value={form.full_name} onChange={e => updateField("full_name", e.target.value)} placeholder="e.g. Priya Sharma" /></div>
              <div className={styles.field}><label>Phone</label><input value={form.phone} onChange={e => updateField("phone", e.target.value)} placeholder="9876543210" /></div>
              <div className={styles.field}><label>Email</label><input type="email" value={form.email} onChange={e => updateField("email", e.target.value)} placeholder="priya@example.com" /></div>
              <div className={styles.field}><label>Age</label><input type="number" value={form.age} onChange={e => updateField("age", e.target.value)} placeholder="34" /></div>
              <div className={styles.field}><label>City</label><input value={form.city} onChange={e => updateField("city", e.target.value)} placeholder="Vapi" /></div>
              <div className={styles.field}><label>Occupation</label><input value={form.occupation} onChange={e => updateField("occupation", e.target.value)} /></div>
              <div className={styles.field} style={{ gridColumn: 'span 2' }}><label>Address</label><textarea value={form.address} onChange={e => updateField("address", e.target.value)} rows="2" /></div>
              <div className={styles.field}><label>Emergency Contact</label><input value={form.emergency_contact} onChange={e => updateField("emergency_contact", e.target.value)} /></div>
              <div className={styles.field} style={{ position: 'relative' }}>
                <label>Referred By (Search Client)</label>
                <input 
                  value={form.referred_by_name} 
                  onChange={e => {
                    updateField("referred_by_name", e.target.value);
                    handleSearchReferrer(e.target.value);
                  }} 
                  placeholder="Search existing client..."
                />
                {searchResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    {searchResults.map(r => (
                      <div 
                        key={r.client_id} 
                        style={{ padding: '0.75rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        onClick={() => {
                          setForm({ ...form, referred_by_client_id: r.client_id, referred_by_name: r.full_name });
                          setSearchResults([]);
                        }}
                      >
                        <strong>{r.full_name}</strong> ({r.client_id})
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.field}><label>Source</label>
                <select value={form.source} onChange={e => updateField("source", e.target.value)}>
                  {SOURCE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* PLAN & GOALS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-bullseye"></i>
              Plan & Goals
            </div>
            <div className={styles.formBody}>
              <div className={styles.formGrid} style={{ gridTemplateColumns: '1fr' }}>
                <div className={styles.field}><label>Plan Type</label>
                  <select value={form.plan_type} onChange={e => updateField("plan_type", e.target.value)}>
                    <option value="">Select...</option>
                    {PLAN_TYPES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className={styles.field}><label>Plan Start Date</label><input type="date" value={form.plan_start_date} onChange={e => updateField("plan_start_date", e.target.value)} /></div>
                <div className={styles.field}><label>Follow-up Freq (days)</label><input type="number" value={form.follow_up_freq_days} onChange={e => updateField("follow_up_freq_days", parseInt(e.target.value))} /></div>
                <div className={styles.field}><label>Health Goal</label><textarea value={form.health_goal} onChange={e => updateField("health_goal", e.target.value)} rows="2" /></div>
              </div>
            </div>
          </section>

          {/* BODY STATS */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <i className="fa-solid fa-weight-scale"></i>
              Initial Body Stats
            </div>
            <div className={styles.formBody}>
              <div className={styles.formGrid} style={{ gridTemplateColumns: '1fr' }}>
                <div className={styles.field}><label>Height (cm)</label><input type="number" value={form.height_cm} onChange={e => updateField("height_cm", e.target.value)} /></div>
                <div className={styles.field}><label>Start Weight (kg)</label><input type="number" value={form.start_weight_kg} onChange={e => updateField("start_weight_kg", e.target.value)} /></div>
                <div className={styles.field}><label>Target Weight (kg)</label><input type="number" value={form.target_weight_kg} onChange={e => updateField("target_weight_kg", e.target.value)} /></div>
                <div className={styles.field}><label>Tier (1-5)</label>
                  <select value={form.tier} onChange={e => updateField("tier", parseInt(e.target.value))}>
                    {[1,2,3,4,5].map(t => <option key={t} value={t}>{t} ★</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fa-solid fa-notes-medical"></i>
            Medical & Lifestyle
          </div>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <div className={styles.field}><label>Medical Conditions</label><textarea value={form.medical_conditions} onChange={e => updateField("medical_conditions", e.target.value)} rows="2" /></div>
              <div className={styles.field}><label>Allergies</label><textarea value={form.allergies} onChange={e => updateField("allergies", e.target.value)} rows="2" /></div>
              <div className={styles.field}><label>Activity Level</label><input value={form.activity_level} onChange={e => updateField("activity_level", e.target.value)} placeholder="Sedentary, Active, etc." /></div>
              <div className={styles.field}><label>Current Medications</label><textarea value={form.current_medications} onChange={e => updateField("current_medications", e.target.value)} rows="2" /></div>
            </div>
          </div>
        </section>

        <div className={styles.formActions}>
          <Link href="/clients" className={styles.cancelBtn}>Discard</Link>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? "Onboarding..." : "Initialize Client"}
          </button>
        </div>
      </form>
    </div>
  );
}