import Link from "next/link";
import styles from "./featurePage.module.css";

export default function FeaturePage({
  icon,
  color,
  accentColor,
  title,
  subtitle,
  description,
  howItWorks = [],
  benefits = [],
  useCases = [],
  ctaText = "Book a Free Demo",
  ctaHref = "/schedule-demo",
}) {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.iconWrap} style={{ background: color }}>
            <i className={icon} style={{ color: accentColor }} />
          </div>
          <h1 className={styles.heroTitle}>{title}</h1>
          <p className={styles.heroSubtitle}>{subtitle}</p>
          <Link href={ctaHref} className={styles.heroBtn}>
            <i className="fas fa-calendar-check" /> {ctaText}
          </Link>
        </div>
      </section>

      <section className={styles.body}>
        <div className={styles.inner}>
          <div className={styles.descSection}>
            <h2 className={styles.sectionTitle}>What is {title}?</h2>
            <p className={styles.descText}>{description}</p>
          </div>

          {howItWorks.length > 0 && (
            <div className={styles.howSection}>
              <h2 className={styles.sectionTitle}>How It Works</h2>
              <div className={styles.stepsGrid}>
                {howItWorks.map((step, i) => (
                  <div key={i} className={styles.stepCard}>
                    <div className={styles.stepNum} style={{ background: color, color: accentColor }}>
                      {i + 1}
                    </div>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepDesc}>{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {benefits.length > 0 && (
            <div className={styles.benefitsSection}>
              <h2 className={styles.sectionTitle}>Key Benefits</h2>
              <div className={styles.benefitsGrid}>
                {benefits.map((b, i) => (
                  <div key={i} className={styles.benefitItem}>
                    <div className={styles.benefitIcon} style={{ background: color }}>
                      <i className={b.icon} style={{ color: accentColor }} />
                    </div>
                    <div>
                      <h3 className={styles.benefitTitle}>{b.title}</h3>
                      <p className={styles.benefitDesc}>{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {useCases.length > 0 && (
            <div className={styles.useCasesSection}>
              <h2 className={styles.sectionTitle}>Who Uses This?</h2>
              <div className={styles.useCasesGrid}>
                {useCases.map((u, i) => (
                  <div key={i} className={styles.useCaseCard}>
                    <span className={styles.useCaseTag}>{u.role}</span>
                    <p className={styles.useCaseText}>{u.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>
            Ready to Use <span>{title}?</span>
          </h2>
          <p className={styles.ctaDesc}>
            See how {title} works in a live demo. Book a free 30-minute session with our team.
          </p>
          <div className={styles.ctaButtons}>
            <Link href="/schedule-demo" className={styles.btnPrimary}>
              <i className="fas fa-calendar-check" /> Book Free Demo
            </Link>
            <Link href="/pricing" className={styles.btnSecondary}>
              View Pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}