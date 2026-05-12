"use client";

import Link from "next/link";
import styles from "./page.module.css";

const PLANS = [
  {
    name: "Starter",
    price: "999",
    period: "/month",
    desc: "Perfect for small teams just getting started with lead management.",
    features: [
      "Up to 3 Users",
      "500 Leads / month",
      "Lead Management",
      "Task & Follow-up Reminders",
      "Basic Reports",
      "Email Support",
    ],
    cta: "Get Started",
    href: "/schedule-demo",
    highlight: false,
  },
  {
    name: "Growth",
    price: "2,499",
    period: "/month",
    desc: "For growing sales teams that need more power and integrations.",
    features: [
      "Up to 10 Users",
      "Unlimited Leads",
      "Everything in Starter",
      "Facebook & IndiaMart Integration",
      "Advanced Analytics",
      "WhatsApp Notifications",
      "Priority Support",
    ],
    cta: "Start Free Trial",
    href: "/schedule-demo",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large organizations needing custom workflows and dedicated support.",
    features: [
      "Unlimited Users",
      "Unlimited Leads",
      "Everything in Growth",
      "Custom Integrations",
      "Dedicated Account Manager",
      "SLA Support",
      "On-premise Option",
    ],
    cta: "Contact Sales",
    href: "/contact-us",
    highlight: false,
  },
];

const FAQS = [
  {
    q: "Is there a free trial?",
    a: "Yes, the Growth plan comes with a 14-day free trial. No credit card required.",
  },
  {
    q: "Can I change plans later?",
    a: "Absolutely. You can upgrade or downgrade your plan at any time from your dashboard.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit/debit cards, UPI, and bank transfers for annual plans.",
  },
  {
    q: "Is my data secure?",
    a: "Yes, your data is encrypted in transit and at rest. We run on enterprise-grade infrastructure.",
  },
];

export default function PricingPageClient() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.tag}>Pricing</div>
        <h1 className={styles.title}>
          Simple, <span>Transparent</span> Pricing
        </h1>
        <p className={styles.subtitle}>
          No hidden fees. No long-term lock-ins. Pick the plan that fits your team and scale when ready.
        </p>
        <p style={{ marginTop: "24px", fontSize: "15px", color: "rgba(255,255,255,0.65)", maxWidth: "520px", marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
          Annual CRM licenses (Gold, Diamond, Platinum) are purchased signed-in via our package flow — same Stripe checkout as the rest of the product.
        </p>
        <Link
          href="/add-package"
          className={`${styles.planBtn} ${styles.planBtnHighlight}`}
          style={{ marginTop: "20px", display: "inline-flex", textDecoration: "none", alignItems: "center", justifyContent: "center" }}
        >
          View packages &amp; buy CRM
        </Link>
      </section>

      <section className={styles.plansSection}>
        <div className={styles.plansGrid}>
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`${styles.planCard} ${plan.highlight ? styles.planCardHighlight : ""}`}
            >
              {plan.highlight && <div className={styles.popularBadge}>Most Popular</div>}
              <p className={styles.planName}>{plan.name}</p>
              <div>
                <span className={styles.planPrice}>
                  {plan.price === "Custom" ? (
                    "Custom"
                  ) : (
                    <>
                      <sup>₹</sup>
                      {plan.price}
                    </>
                  )}
                </span>
                {plan.period && <span className={styles.planPeriod}>{plan.period}</span>}
              </div>
              <p className={styles.planDesc}>{plan.desc}</p>
              <ul className={styles.planFeatures}>
                {plan.features.map((f) => (
                  <li key={f} className={styles.planFeature}>
                    <span className={styles.checkIcon}>
                      <i className="fas fa-check" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={`${styles.planBtn} ${plan.highlight ? styles.planBtnHighlight : styles.planBtnDefault}`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.faqSection}>
        <div className={styles.faqInner}>
          <div className={styles.faqHeader}>
            <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
          </div>
          {FAQS.map((faq) => (
            <div key={faq.q} className={styles.faqItem}>
              <h3 className={styles.faqQ}>{faq.q}</h3>
              <p className={styles.faqA}>{faq.a}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
