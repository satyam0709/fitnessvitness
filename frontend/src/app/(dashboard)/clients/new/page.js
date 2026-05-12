"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import styles from "../clients.module.css";

const SOURCE_OPTIONS = [
  "BNI", "Instagram", "Facebook", "Referral - Existing Client", "Friend / Family", "Walk-in", "Online / Website", "Corporate / Company"
];
const PLAN_TYPES = ["1 Month Plan", "3 Month Plan", "6 Month Plan", "1 Year Plan"];

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({});

  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", age: "", city: "", address: "", occupation: "",
    emergency_contact: "", referred_by_client_id: "", source: "Walk-in", tier: 3,
    health_goal: "", plan_type: "", plan_start_date: "", follow_up_freq_days: 14,
    medical_conditions: "", allergies: "", activity_level: "", current_medications: "",
    height_cm: "", start_weight_kg: "", current_weight_kg: "", target_weight_kg: ""
  });

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await apiFetch("/fitness/settings");
      const json = await res.json();
      if (json.success) setSettings(json.data);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch("/fitness/clients", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        router.push(`/clients/${json.data.client_id}`);
      } else {
        alert("Failed to create client");
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
        <Link href="/clients" className={styles.backBtn}><i className="fa-solid fa-arrow-left"></i> Back</Link>
        <h1>Add New Client</h1>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formSection}>
          <h3>Personal Details</h3>
          <div className={styles.formGrid}>
            <div className={styles.field}><label>Full Name *</label><input required value={form.full_name} onChange={e => updateField("full_name", e.target.value)} /></div>
            <div className={styles.field}><label>Phone</label><input value={form.phone} onChange={e => updateField("phone", e.target.value)} /></div>
            <div className={styles.field}><label>Email</label><input type="email" value={form.email} onChange={e => updateField("email", e.target.value)} /></div>
            <div className={styles.field}><label>Age</label><input type="number" value={form.age} onChange={e => updateField("age", e.target.value)} /></div>
            <div className={styles.field}><label>City</label><input value={form.city} onChange={e => updateField("city", e.target.value)} /></div>
            <div className={styles.field}><label>Occupation</label><input value={form.occupation} onChange={e => updateField("occupation", e.target.value)} /></div>
            <div className={styles.field}><label>Address</label><textarea value={form.address} onChange={e => updateField("address", e.target.value)} /></div>
            <div className={styles.field}><label>Emergency Contact</label><input value={form.emergency_contact} onChange={e => updateField("emergency_contact", e.target.value)} /></div>
          </div>
        </div>

        <div className={styles.formSection}>
          <h3>Plan & Goals</h3>
          <div className={styles.formGrid}>
            <div className={styles.field}><label>Source</label>
              <select value={form.source} onChange={e => updateField("source", e.target.value)}>
                {SOURCE_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.field}><label>Tier (1-5)</label>
              <select value={form.tier} onChange={e => updateField("tier", parseInt(e.target.value))}>
                {[1,2,3,4,5].map(t => <option key={t} value={t}>{t} ★</option>)}
              </select>
            </div>
            <div className={styles.field}><label>Health Goal</label><textarea value={form.health_goal} onChange={e => updateField("health_goal", e.target.value)} /></div>
            <div className={styles.field}><label>Plan Type</label>
              <select value={form.plan_type} onChange={e => updateField("plan_type", e.target.value)}>
                <option value="">Select...</option>
                {PLAN_TYPES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className={styles.field}><label>Plan Start Date</label><input type="date" value={form.plan_start_date} onChange={e => updateField("plan_start_date", e.target.value)} /></div>
            <div className={styles.field}><label>Follow-up Frequency (days)</label><input type="number" value={form.follow_up_freq_days} onChange={e => updateField("follow_up_freq_days", parseInt(e.target.value))} /></div>
            <div className={styles.field}><label>Medical Conditions</label><textarea value={form.medical_conditions} onChange={e => updateField("medical_conditions", e.target.value)} /></div>
            <div className={styles.field}><label>Allergies</label><textarea value={form.allergies} onChange={e => updateField("allergies", e.target.value)} /></div>
            <div className={styles.field}><label>Activity Level</label><input value={form.activity_level} onChange={e => updateField("activity_level", e.target.value)} /></div>
            <div className={styles.field}><label>Current Medications</label><textarea value={form.current_medications} onChange={e => updateField("current_medications", e.target.value)} /></div>
          </div>
        </div>

        <div className={styles.formSection}>
          <h3>Body Stats</h3>
          <div className={styles.formGrid}>
            <div className={styles.field}><label>Height (cm)</label><input type="number" value={form.height_cm} onChange={e => updateField("height_cm", e.target.value)} /></div>
            <div className={styles.field}><label>Start Weight (kg)</label><input type="number" value={form.start_weight_kg} onChange={e => updateField("start_weight_kg", e.target.value)} /></div>
            <div className={styles.field}><label>Current Weight (kg)</label><input type="number" value={form.current_weight_kg} onChange={e => updateField("current_weight_kg", e.target.value)} /></div>
            <div className={styles.field}><label>Target Weight (kg)</label><input type="number" value={form.target_weight_kg} onChange={e => updateField("target_weight_kg", e.target.value)} /></div>
          </div>
        </div>

        <div className={styles.formActions}>
          <Link href="/clients" className={styles.cancelBtn}>Cancel</Link>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? "Creating..." : "Create Client"}
          </button>
        </div>
      </form>
    </div>
  );
}