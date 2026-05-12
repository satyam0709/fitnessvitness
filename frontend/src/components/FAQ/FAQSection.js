"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import styles from "./faq.module.css";


const FAQS = [
  {
    category: "General",
    q: "What is CRM software?",
    a: "CRM (Customer Relationship Management) software helps businesses manage interactions with current and potential customers, streamline processes, and improve profitability.",
  },
  {
    category: "General",
    q: "Who can use this CRM software?",
    a: "Our CRM is designed for sales teams, marketing professionals, support agents, and business owners across various industries looking to optimize their operations.",
  },
  {
    category: "Features",
    q: "What features does the CRM software include?",
    a: "Key features include lead management, marketing automation, seamless integrations, performance analytics, task management, and communication tools.",
  },
  {
    category: "Features",
    q: "Does the software support multi-user access?",
    a: "Yes, our CRM supports multi-user access with customizable role-based permissions to ensure data security and team collaboration.",
  },
  {
    category: "Features",
    q: "Can I customize the CRM to fit my business needs?",
    a: "Yes. You can define custom role hierarchies and permissions based on your org structure, create department-specific modules for Sales, HR, Finance, and Marketing with automated cross-departmental workflows, and build custom dashboards to track team-level KPIs and performance metrics.",
  },
  {
    category: "Security",
    q: "How secure is the CRM software?",
    a: "We prioritize your data security with end-to-end encryption, regular automated backups, and strict compliance with global data protection regulations.",
  },
  {
    category: "Integrations",
    q: "Can the CRM integrate with other software?",
    a: "Yes, 365 CRM integrates with TradeIndia, 99acres, Justdial, Facebook, Instagram, MagicBricks, Google Calendar, SoftwareSuggest, and WordPress for seamless data sync. It also supports custom forms to collect and manage data specific to your business.",
  },
  {
    category: "Pricing",
    q: "What are the pricing plans?",
    a: "We offer flexible pricing plans tailored to businesses of all sizes. Please visit our pricing page or contact sales for a detailed breakdown.",
  },
  {
    category: "Pricing",
    q: "Is there a free trial available?",
    a: "Yes, we offer a 14-day free trial so you can explore all the premium features before making a commitment.",
  },
  {
    category: "Support",
    q: "What kind of support do you offer?",
    a: "We offer 24/7 email and chat support, along with a comprehensive knowledge base and dedicated account managers for enterprise plans.",
  },
  {
    category: "Mobile",
    q: "Does the CRM have a mobile app?",
    a: "Yes, our mobile app is available on both iOS and Android, allowing you to manage your business on the go.",
  },
  {
    category: "Mobile",
    q: "Can I work offline on the mobile app?",
    a: "Yes, the mobile app includes offline capabilities. Your changes will automatically sync once your connection is restored.",
  },
  {
    category: "Onboarding",
    q: "How do I get started?",
    a: "Simply sign up for our free trial, and our onboarding wizard will guide you through importing your contacts and setting up your first campaign.",
  },
  {
    category: "Onboarding",
    q: "Is training provided for new users?",
    a: "Absolutely. We provide extensive video tutorials, live webinars, and personalized onboarding sessions to ensure your team is set up for success.",
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(FAQS.map((f) => f.category)))];

function FAQItem({ faq, index, isOpen, onToggle }) {
  const answerRef = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (answerRef.current) {
      setHeight(isOpen ? answerRef.current.scrollHeight : 0);
    }
  }, [isOpen]);

  return (
    <div className={`${styles.faqCard} ${isOpen ? styles.activeCard : ""}`}>
      <button
        className={styles.faqQuestion}
        onClick={() => onToggle(index)}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${index}`}
        id={`faq-question-${index}`}
      >
        <span className={styles.questionText}>{faq.q}</span>
        <span className={`${styles.iconWrap} ${isOpen ? styles.iconOpen : ""}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      <div
        id={`faq-answer-${index}`}
        role="region"
        aria-labelledby={`faq-question-${index}`}
        className={styles.faqAnswerWrap}
        style={{ height: `${height}px` }}
      >
        <div ref={answerRef} className={styles.faqAnswer}>
          {typeof faq.a === "string" ? <p>{faq.a}</p> : faq.a}
        </div>
      </div>
    </div>
  );
}

export default function FAQSection({ preview = false }) {
  const [openIndex, setOpenIndex] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const baseFAQs = preview ? FAQS.slice(0, 6) : FAQS;

  const filtered = baseFAQs.filter((faq) => {
    const matchesSearch =
      search.trim() === "" ||
      faq.q.toLowerCase().includes(search.toLowerCase()) ||
      (typeof faq.a === "string" && faq.a.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = activeCategory === "All" || faq.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const leftColumn = filtered
    .map((faq, i) => ({ ...faq, originalIndex: i }))
    .filter((_, i) => i % 2 === 0);
  const rightColumn = filtered
    .map((faq, i) => ({ ...faq, originalIndex: i }))
    .filter((_, i) => i % 2 !== 0);

  const renderColumn = (columnData) => (
    <div className={styles.faqColumn}>
      {columnData.map((faq) => (
        <FAQItem
          key={faq.originalIndex}
          faq={faq}
          index={faq.originalIndex}
          isOpen={openIndex === faq.originalIndex}
          onToggle={toggleFAQ}
        />
      ))}
    </div>
  );

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Got Questions?</p>
          <h2 className={styles.title}>Frequently Asked Questions</h2>
          <p className={styles.subtitle}>
            Everything you need to know about 365 CRM. Can't find the answer? {" "}
            <a href="/contact-us" className={styles.contactLink}>Talk to our team.</a>
          </p>
        </div>

        {!preview && (
          <div className={styles.controls}>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search questions..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpenIndex(null);
                }}
                aria-label="Search frequently asked questions"
              />
              {search && (
                <button className={styles.clearBtn} onClick={() => setSearch("")} aria-label="Clear search">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <div className={styles.categories} role="group" aria-label="Filter by category">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`${styles.catBtn} ${activeCategory === cat ? styles.catActive : ""}`}
                  onClick={() => {
                    setActiveCategory(cat);
                    setOpenIndex(null);
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>No results found</p>
            <p className={styles.emptyText}>
              Try a different search term or{" "}
              <button className={styles.resetBtn} onClick={() => { setSearch(""); setActiveCategory("All"); }}>
                clear all filters
              </button>
            </p>
          </div>
        ) : (
          <div className={styles.faqWrapper}>
            {renderColumn(leftColumn)}
            {renderColumn(rightColumn)}
          </div>
        )}

        {preview && (
          <div className={styles.btnWrapper}>
            <Link href="/faqs" className={styles.viewMoreBtn}>
              View all
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}