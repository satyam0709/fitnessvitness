import Link from "next/link";
import styles from "./page.module.css";
import { INTEGRATIONS } from "../../lib/integrations";

export const metadata = {
  title: "Integrations – RND TECHNOSOFT CRM",
  description: "Connect your lead sources to RND TECHNOSOFT CRM. IndiaMart, Facebook, Google Ads, 99acres, Housing and more.",
};

export default function IntegrationsPage() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.tag}>Integrations</div>
        <h1 className={styles.title}>
          All Your Lead Sources, <span>One CRM</span>
        </h1>
        <p className={styles.subtitle}>
          Stop copying leads manually. Connect once and every enquiry flows directly into your pipeline — automatically.
        </p>
        <div className={styles.stats}>
          {[{ v: "13+", l: "Integrations" }, { v: "Zero", l: "Manual entry" }, { v: "Real-time", l: "Lead sync" }].map((s) => (
            <div key={s.l} className={styles.stat}>
              <span className={styles.statVal}>{s.v}</span>
              <span className={styles.statLabel}>{s.l}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.body}>
        <div className={styles.inner}>
          <div className={styles.grid}>
            {INTEGRATIONS.map((item) => (
              <div key={item.href} className={styles.card}>
                {item.badge && <span className={styles.badge}>{item.badge}</span>}
                <div className={styles.cardTop}>
                  <div className={styles.icon} style={{ background: item.color, color: item.accent }}>
                    <i className={item.icon} />
                  </div>
                  <h2 className={styles.cardTitle}>{item.title}</h2>
                </div>
                <p className={styles.cardDesc}>{item.desc}</p>
                <Link href={item.href} className={styles.cardLink}>
                  Learn how to connect <i className="fas fa-arrow-right" />
                </Link>
              </div>
            ))}
          </div>
          <div className={styles.ctaBox}>
            <h2 className={styles.ctaTitle}>
              Don't see your lead source? <span>Talk to us.</span>
            </h2>
            <p className={styles.ctaDesc}>
              We regularly add new integrations. If you need a custom connection, our team can set it up.
            </p>
            <Link href="/contact-us" className={styles.btnPrimary}>
              <i className="fas fa-comments" /> Request an Integration
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
