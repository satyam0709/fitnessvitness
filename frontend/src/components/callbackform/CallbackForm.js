"use client";
import { useState } from "react";
import Image from "next/image";
// We import the CSS directly from your blog folder so your existing styles work perfectly
import styles from "@/app/blog/page.module.css";

export default function CallbackForm() {
  const [formData, setFormData] = useState({ name: "", phone: "", email: "" });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required.";
    
    // Validates a standard 10 digit number
    if (!formData.phone.trim() || !/^\d{10}$/.test(formData.phone)) {
      newErrors.phone = "Enter a valid 10-digit number.";
    }
    
    // Simple email format validation
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Enter a valid email address.";
    }
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationErrors = validate();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSubmitted(false);
    } else {
      setErrors({});
      setSubmitted(true);
      // Your API call to save the lead will go here
      
      // Reset success message after 3 seconds
      setTimeout(() => setSubmitted(false), 3000);
      setFormData({ name: "", phone: "", email: "" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.callbackForm}>
      {submitted && (
        <p style={{ color: "#27ae60", fontSize: "13px", fontWeight: "bold", marginBottom: "8px" }}>
          Request submitted successfully!
        </p>
      )}

      <input
        type="text"
        name="name"
        placeholder="Name"
        value={formData.name}
        onChange={handleChange}
        className={`${styles.formInput} ${errors.name ? styles.errorInput : ""}`}
      />
      {errors.name && <span className={styles.errorText}>{errors.name}</span>}

      <div className={`${styles.phoneRow} ${errors.phone ? styles.errorInput : ""}`}>
        <span className={styles.phonePrefix}>
          <Image
            src="https://flagcdn.com/w20/in.png"
            alt="IN"
            width={20}
            height={15}
            className={styles.flagImg}
          />
          +91
        </span>
        <input
          type="tel"
          name="phone"
          placeholder="Mobile Number"
          value={formData.phone}
          onChange={handleChange}
          className={styles.formInputPhone}
        />
      </div>
      {errors.phone && <span className={styles.errorText}>{errors.phone}</span>}

      <input
        type="email"
        name="email"
        placeholder="Email Address"
        value={formData.email}
        onChange={handleChange}
        className={`${styles.formInput} ${errors.email ? styles.errorInput : ""}`}
      />
      {errors.email && <span className={styles.errorText}>{errors.email}</span>}

      <button type="submit" className={styles.submitBtn}>
        {submitted ? "Sent" : "Submit"}
      </button>
    </form>
  );
}