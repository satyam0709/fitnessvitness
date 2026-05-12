import Image from "next/image"; // 1. Import this
import styles from "./whychoose.module.css";

const STATS = [
  {
    icon: "/assets/lead-leakage.png",
    value: "<0.1%",
    label: "Lead leakage",
  },
  {
    icon: "/assets/Faster-lead.png",
    value: "61%",
    label: "Faster lead response",
  },
  {
    icon: "/assets/Task-efficiency.png",
    value: "2x",
    label: "Task efficiency",
  },
  {
    icon: "/assets/Faster-funnel.png",
    value: "70%",
    label: "Faster funnel movement",
  },
];

export default function WhyChooseSection() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        
        {/* HEADER & TEXT */}
        <div className={styles.header}>
          <h2 className={styles.title}>Why Choose 365 RND CRM Software?</h2>
          <div className={styles.desc}>
            <p>
               365 RND CRM Software offers a comprehensive solution to enhance your sales processes by eliminating lead leakage, ensuring faster response times, and boosting task efficiency. It centralizes lead tracking and automates follow-ups, simplifying lead management and reducing missed opportunities.
            </p>
            <p>
              365 RND CRM accelerates funnel movement by streamlining lead nurturing and ensuring timely actions, such as automated reminders and task assignments. Its robust lead management system provides real-time analytics and actionable insights, helping sales teams prioritize leads, improve conversion rates, and optimize workflows. By offering the best lead management software CRM with seamless automation and insightful tools, 365 RND CRM system drives productivity and overall sales performance.
            </p>
          </div>
        </div>

        {/* STATS GRID */}
        <div className={styles.statsGrid}>
          {STATS.map((stat, index) => (
            <div key={index} className={styles.statItem}>
              
              <div className={styles.iconWrapper}>
                {/* 2. Replace <i> with <Image /> */}
                <Image 
                  src={stat.icon} 
                  alt={stat.label} 
                  width={40} 
                  height={40} 
                  style={{ objectFit: "contain" }}
                />
              </div>

              <h3 className={styles.statValue}>{stat.value}</h3>
              <p className={styles.statLabel}>{stat.label}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}