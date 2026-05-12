"use client";
import { useState } from "react";
import styles from "./page.module.css";

const PERKS = [
  { icon: "fas fa-clock",           text: "30-minute personalised walkthrough" },
  { icon: "fas fa-user-tie",        text: "Live session with a product expert" },
  { icon: "fas fa-industry",        text: "Tailored to your industry & team size" },
  { icon: "fas fa-question-circle", text: "Q&A — ask anything you need" },
  { icon: "fas fa-gift",            text: "Free 14-day trial after the demo" },
];

export default function ScheduleDemoPage() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type: "demo" }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ type: "success", msg: data.message });
        setForm({ name: "", phone: "", email: "", message: "" });
      } else {
        setStatus({ type: "error", msg: data.message || "Something went wrong." });
      }
    } catch {
      setStatus({ type: "error", msg: "Unable to submit. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.demoPage}>
      <div className={styles.demoInner}>
        <div className={styles.demoLeft}>
          <div className={styles.demoTag}>Free Demo</div>
          <h1 className={styles.demoTitle}>
            See RND CRM <span>Live</span> in 30 Minutes
          </h1>
          <p className={styles.demoDesc}>
            Book a personalised demo and watch how RND TECHNOSOFT CRM can transform
            your sales process — no fluff, just a real walkthrough of your actual workflow.
          </p>
          <ul className={styles.perksList}>
            {PERKS.map((p) => (
              <li key={p.text} className={styles.perkItem}>
                <div className={styles.perkIcon}><i className={p.icon} /></div>
                {p.text}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>Book Your Free Demo</h2>
          <p className={styles.formSubtitle}>We'll confirm within 2 business hours.</p>

          {status?.type === "success" && (
            <div className={styles.alertSuccess}>
              <i className="fas fa-check-circle" /> {status.msg}
            </div>
          )}
          {status?.type === "error" && (
            <div className={styles.alertError}>
              <i className="fas fa-exclamation-circle" /> {status.msg}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Full Name *</label>
                <input className={styles.formInput} type="text" name="name" value={form.name} onChange={handleChange} placeholder="Raj Patel" required />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Phone Number *</label>
                <input className={styles.formInput} type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="+91 98765 43210" required />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Work Email *</label>
              <input className={styles.formInput} type="email" name="email" value={form.email} onChange={handleChange} placeholder="raj@company.com" required />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>What would you like to see? (Optional)</label>
              <textarea className={`${styles.formInput} ${styles.formTextarea}`} name="message" value={form.message} onChange={handleChange} placeholder="e.g. Lead management for a real estate team of 10..." />
            </div>
            <button type="submit" className={`${styles.submitBtn} ${styles.submitBtnDark}`} disabled={loading}>
              {loading ? <><i className="fas fa-spinner fa-spin" /> Booking...</> : <><i className="fas fa-calendar-check" /> Schedule My Demo</>}
            </button>
            <p className={styles.privacyNote}>
              <i className="fas fa-lock" /> No spam. Your details are safe with us.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}