"use client";
import { useState } from "react";
import styles from "./page.module.css";

export default function ContactPage() {
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
        body: JSON.stringify({ ...form, type: "contact" }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ type: "success", msg: data.message });
        setForm({ name: "", phone: "", email: "", message: "" });
      } else {
        setStatus({ type: "error", msg: data.message || "Something went wrong." });
      }
    } catch {
      setStatus({ type: "error", msg: "Unable to send message. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.tag}>Contact Us</div>
        <h1 className={styles.title}>
          We'd Love to <span>Hear From You</span>
        </h1>
        <p className={styles.subtitle}>
          Have a question, need a demo, or want to talk to sales? We're here to help.
        </p>
      </section>

      <section className={styles.body}>
        <div className={styles.grid}>
          <div className={styles.infoCard}>
            <h2 className={styles.infoCardTitle}>Get in Touch</h2>
            <p className={styles.infoCardDesc}>
              Our team is available Monday to Saturday, 10am to 7pm IST.
            </p>
            <div className={styles.infoItem}>
              <div className={styles.infoIcon}><i className="fas fa-map-marker-alt" /></div>
              <div>
                <p className={styles.infoLabel}>Address</p>
                <p className={styles.infoVal}>2047, Silver Business Point, Near VIP Circle, Uttran, Surat – 394105</p>
              </div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.infoIcon}><i className="fas fa-phone-alt" /></div>
              <div>
                <p className={styles.infoLabel}>Phone</p>
                <p className={styles.infoVal}>+91 0000000000<br />+91 0000000000</p>
              </div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.infoIcon}><i className="fas fa-envelope" /></div>
              <div>
                <p className={styles.infoLabel}>Email</p>
                <p className={styles.infoVal}>contact@365RNDleadmanagement.com<br />support@365leadmanagement.com</p>
              </div>
            </div>
          </div>

          <div className={styles.formCard}>
            <h2 className={styles.formTitle}>Send Us a Message</h2>
            <p className={styles.formSubtitle}>
              Fill in the form and our team will get back to you within 24 hours.
            </p>

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
                <label className={styles.formLabel}>Email Address *</label>
                <input className={styles.formInput} type="email" name="email" value={form.email} onChange={handleChange} placeholder="raj@company.com" required />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Message</label>
                <textarea className={`${styles.formInput} ${styles.formTextarea}`} name="message" value={form.message} onChange={handleChange} placeholder="Tell us how we can help you..." />
              </div>
              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading ? <><i className="fas fa-spinner fa-spin" /> Sending...</> : <><i className="fas fa-paper-plane" /> Send Message</>}
              </button>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}