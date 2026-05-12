"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./happycustomers.module.css";

const TESTIMONIALS = [
  {
    name: "Jiya Jain",
    text: "Great service support. I'm so happy. Thank you 365 CRM team.",
  },
  {
    name: "Bansi Patel",
    text: "Awesome experience with 365 Team Management application. It's make easy to our life for day to day.",
  },
  {
    name: "Rahul Mehta",
    text: "The lead management feature is exactly what our sales team needed. Follow-ups are so much easier now.",
  },
  {
    name: "Priya Shah",
    text: "Best CRM for Indian businesses. The IndiaMart integration saved us hours of manual work every day.",
  },
  {
    name: "Amit Desai",
    text: "Our team productivity has doubled since we started using 365 CRM. Highly recommended!",
  },
  {
    name: "Neha Patel",
    text: "Simple, clean, and powerful. The reminders feature ensures we never miss a follow-up.",
  },
  {
    name: "Vikram Singh",
    text: "Customer support is outstanding. Any issue gets resolved within hours. Very satisfied.",
  },
  {
    name: "Kavya Reddy",
    text: "The dashboard gives us a complete picture of our pipeline at a glance. Absolutely love it.",
  },
  {
    name: "Suresh Kumar",
    text: "Switched from another CRM and never looked back. 365 CRM is far more intuitive.",
  },
  {
    name: "Anita Sharma",
    text: "Our sales cycle has shortened significantly. The task management alone is worth it.",
  },
  {
    name: "Rohit Verma",
    text: "Facebook Lead integration works flawlessly. Leads come in instantly without any manual effort.",
  },
  {
    name: "Deepika Nair",
    text: "The mobile app means our field team can update leads on the go. Game changer for us.",
  },
];

const VISIBLE = 2;

export default function HappyCustomers() {
  const [current, setCurrent] = useState(0);
  const total = TESTIMONIALS.length;

  const prev = () => setCurrent((c) => (c - 1 + total) % total);
  const next = () => setCurrent((c) => (c + 1) % total);

  const visible = [
    TESTIMONIALS[current % total],
    TESTIMONIALS[(current + 1) % total],
  ];

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <h2 className={styles.heading}>Happy Customers</h2>
          <p className={styles.desc}>
            Customer satisfaction is at the heart of everything we do. Hear
            directly from our clients about how our services have made a
            difference for their business.
          </p>
          <div className={styles.actions}>
            <Link href="/testimonials" className={styles.viewMore}>
              View More
            </Link>
            <div className={styles.arrows}>
              <button
                className={styles.arrow}
                onClick={prev}
                aria-label="Previous"
              >
                &#8249;
              </button>
              <button className={styles.arrow} onClick={next} aria-label="Next">
                &#8250;
              </button>
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.cards}>
            {visible.map((t, i) => (
              <div key={`${current}-${i}`} className={styles.card}>
                <div className={styles.quoteIcon}>"</div>
                <p className={styles.quote}>"{t.text}"</p>
                <div className={styles.author}>
                  <div className={styles.avatar}>{t.name.charAt(0)}</div>
                  <span className={styles.name}>{t.name}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.dots}>
            {TESTIMONIALS.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === current ? styles.dotActive : ""}`}
                onClick={() => setCurrent(i)}
                aria-label={`Go to testimonial ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
