"use client";

import { useState } from "react";
import styles from "./contactform.module.css";

export default function ContactForm() {
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const newErrors = {};
    if (!form.name.trim()) newErrors.name = "Please enter your name";
    if (!form.phone.trim()) newErrors.phone = "Please enter your mobile number";
    else if (!/^[0-9]{10}$/.test(form.phone.trim())) newErrors.phone = "Enter a valid 10-digit number";
    if (!form.email.trim()) newErrors.email = "Please enter your email address";
    else if (!/\S+@\S+\.\S+/.test(form.email)) newErrors.email = "Enter a valid email address";
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccess(false);
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type: "contact" }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setForm({ name: "", phone: "", email: "" });
      } else {
        setErrors({ submit: data.message || "Something went wrong. Try again." });
      }
    } catch {
      setErrors({ submit: "Unable to submit. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <h2 className={styles.title}>
          Empowering Businesses with <span>365 RND TECHNOSOFT CRM Solutions</span>
        </h2>
        <p className={styles.desc}>
          Track leads, assign tasks, set reminders, and communicate effortlessly — all with 365 RND TECHNOSOFT CRM Software.
        </p>

        {success && (
          <div className={styles.successMsg}>
            <i className="fas fa-check-circle" /> We will contact you soon!
          </div>
        )}

        {errors.submit && (
          <div className={styles.errorMsg}>
            <i className="fas fa-exclamation-circle" /> {errors.submit}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.formRow}>

            <div className={styles.inputGroup}>
              <div className={`${styles.inputWrapper} ${errors.name ? styles.inputError : ""}`}>
                <input
                  type="text"
                  placeholder="Name"
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                />
                {errors.name && <i className={`fas fa-exclamation-circle ${styles.errorIcon}`} />}
              </div>
              {errors.name && <span className={styles.errorText}>{errors.name}</span>}
            </div>

            <div className={styles.inputGroup}>
              <div className={`${styles.inputWrapper} ${errors.phone ? styles.inputError : ""}`}>
                <span className={styles.flagPrefix}>🇮🇳 +91</span>
                <input
                  type="tel"
                  placeholder="Mobile Number"
                  value={form.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  maxLength={10}
                />
                {errors.phone && <i className={`fas fa-exclamation-circle ${styles.errorIcon}`} />}
              </div>
              {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}
            </div>

            <div className={styles.inputGroup}>
              <div className={`${styles.inputWrapper} ${errors.email ? styles.inputError : ""}`}>
                <input
                  type="email"
                  placeholder="Email Address"
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                />
                {errors.email && <i className={`fas fa-exclamation-circle ${styles.errorIcon}`} />}
              </div>
              {errors.email && <span className={styles.errorText}>{errors.email}</span>}
            </div>

          </div>

          <div className={styles.btnWrapper}>
            <button type="submit" className={styles.contactBtn} disabled={loading}>
              {loading ? <><i className="fas fa-spinner fa-spin" /> Sending...</> : "Contact Us"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}