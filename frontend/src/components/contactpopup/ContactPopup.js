"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePathname } from "next/navigation";
import styles from "./contactpopup.module.css";

export default function ContactPopup() {
  const { isSignedIn, isLoaded } = useAuth();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);
  const initialTimerRef = useRef(null);

  const showPopup = () => setVisible(true);

  const startInterval = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setVisible(true);
    }, 5 * 60 * 1000);
  };

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    if (pathname !== "/") return;

    // Clear any existing timers when route changes
    clearTimeout(initialTimerRef.current);
    clearInterval(intervalRef.current);
    setVisible(false);

    // Show 3 seconds after landing on the page and start 5-minute interval for subsequent popups
    initialTimerRef.current = setTimeout(() => {
      showPopup();
      startInterval();
    }, 3000);

    return () => {
      clearTimeout(initialTimerRef.current);
      clearInterval(intervalRef.current);
    };
  }, [pathname, isLoaded, isSignedIn]);

  const close = () => {
    setVisible(false);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Please enter your name";
    if (!form.phone.trim()) e.phone = "Please enter your mobile number";
    else if (!/^[0-9]{10}$/.test(form.phone.trim())) e.phone = "Enter a valid 10-digit number";
    if (!form.email.trim()) e.email = "Please enter your email";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Enter a valid email address";
    return e;
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
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
        setForm({ name: "", phone: "", email: "", message: "" });
        clearInterval(intervalRef.current);
        setTimeout(() => setVisible(false), 2500);
      } else {
        setErrors({ submit: data.message || "Something went wrong." });
      }
    } catch {
      setErrors({ submit: "Unable to submit. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <div className={styles.overlay} onClick={close} aria-hidden="true" />
      <div className={styles.popup} role="dialog" aria-modal="true" aria-label="Contact form">
        <div className={styles.header}>
          <h2 className={styles.title}>
            Have Questions? Contact <span>365 CRM</span> Anytime
          </h2>
          <button className={styles.closeBtn} onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        {success ? (
          <div className={styles.successState}>
            <div className={styles.successIcon}>
              <i className="fas fa-check-circle" />
            </div>
            <h3 className={styles.successTitle}>We'll contact you soon!</h3>
            <p className={styles.successDesc}>
              Thanks for reaching out. Our team will get back to you within 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className={styles.form}>
            {errors.submit && (
              <div className={styles.errorBanner}>
                <i className="fas fa-exclamation-circle" /> {errors.submit}
              </div>
            )}

            <div className={styles.field}>
              <div className={`${styles.inputWrap} ${errors.name ? styles.hasError : ""}`}>
                <input
                  type="text"
                  placeholder="Name"
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  className={styles.input}
                />
              </div>
              {errors.name && <span className={styles.errorText}>{errors.name}</span>}
            </div>

            <div className={styles.field}>
              <div className={`${styles.inputWrap} ${errors.phone ? styles.hasError : ""}`}>
                <span className={styles.prefix}>🇮🇳 +91</span>
                <input
                  type="tel"
                  placeholder="Mobile Number"
                  value={form.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  className={styles.input}
                  maxLength={10}
                />
              </div>
              {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}
            </div>

            <div className={styles.field}>
              <div className={`${styles.inputWrap} ${errors.email ? styles.hasError : ""}`}>
                <input
                  type="email"
                  placeholder="Email Address"
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className={styles.input}
                />
              </div>
              {errors.email && <span className={styles.errorText}>{errors.email}</span>}
            </div>

            <div className={styles.field}>
              <div className={styles.inputWrap}>
                <textarea
                  placeholder="Message"
                  value={form.message}
                  onChange={(e) => handleChange("message", e.target.value)}
                  className={`${styles.input} ${styles.textarea}`}
                  rows={4}
                />
              </div>
            </div>

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading
                ? <><i className="fas fa-spinner fa-spin" /> Sending...</>
                : "Submit"
              }
            </button>
          </form>
        )}
      </div>
    </>
  );
}

