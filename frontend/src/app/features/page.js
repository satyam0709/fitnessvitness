import Link from "next/link";
import styles from "./page.module.css";

export const metadata = {
  title: "Features – RND TECHNOSOFT CRM",
  description: "Explore all the powerful features RND TECHNOSOFT CRM offers to supercharge your sales team.",
};

const FEATURES = [
  { icon: "fas fa-filter",        title: "Lead Management",              href: "/features/lead-management",              desc: "Capture leads from every source — IndiaMart, Facebook, Google Ads — and manage them all in one pipeline.", bullets: ["Multi-source lead capture", "Lead status tracking", "Auto-assignment rules", "Duplicate detection"], color: "#fff7e6", accent: "#D4A900" },
  { icon: "fas fa-calendar-check",title: "Task Management",              href: "/features/task-management",              desc: "Create, assign, and track tasks for every lead. Set due dates, priorities, and get reminded before anything slips.", bullets: ["Task assignment", "Priority levels", "Due date tracking", "Linked to leads"], color: "#eff6ff", accent: "#1d4ed8" },
  { icon: "fas fa-bell",          title: "Customer Reminders & Meetings", href: "/features/customer-reminders-meeting",  desc: "Never miss a follow-up call, meeting, or renewal. Set smart reminders that notify your team via WhatsApp.", bullets: ["WhatsApp reminders", "Meeting scheduling", "Birthday alerts", "Renewal notifications"], color: "#f0fdf4", accent: "#15803d" },
  { icon: "far fa-sticky-note",   title: "Notes Management",             href: "/features/notes-management",             desc: "Keep detailed notes on every customer interaction. Attach notes to leads so your team always has context.", bullets: ["Rich text notes", "Attached to leads", "Searchable history", "Timestamped entries"], color: "#fdf4ff", accent: "#7e22ce" },
  { icon: "far fa-comment",       title: "Live Chat",                    href: "/features/live-chat",                    desc: "Chat with website visitors in real time and convert them to leads instantly. Every chat is logged in the CRM.", bullets: ["Real-time chat", "Auto lead creation", "Chat history", "Team inbox"], color: "#fff1f2", accent: "#be123c" },
  { icon: "fas fa-calendar-alt",  title: "Calendar",                     href: "/features/calendar",                     desc: "A unified calendar showing all your team's follow-ups, meetings, and tasks.", bullets: ["Team-wide view", "Follow-up scheduling", "Meeting blocks", "Daily & weekly views"], color: "#ecfdf5", accent: "#065f46" },
  { icon: "fas fa-user-friends",  title: "Staff Management",             href: "/features/staff-management",             desc: "Add team members, assign roles, and control who can see and do what in the CRM.", bullets: ["Role-based permissions", "Activity tracking", "Performance reports", "Lead assignment rules"], color: "#fff7e6", accent: "#b45309" },
  { icon: "fas fa-bullseye",      title: "Target Management",            href: "/features/target-management",            desc: "Set monthly, quarterly, or annual targets for your sales team. Track progress in real time.", bullets: ["Individual & team targets", "Progress dashboards", "Target vs actual", "Period comparisons"], color: "#eff6ff", accent: "#1e40af" },
  { icon: "fas fa-bullhorn",      title: "Campaign & Channels",          href: "/features/campaign-channels",            desc: "Run targeted campaigns across channels and measure which campaigns bring the best leads.", bullets: ["Multi-channel campaigns", "Lead source attribution", "Campaign ROI", "Conversion analytics"], color: "#fdf4ff", accent: "#6b21a8" },
  { icon: "fas fa-layer-group",   title: "Service Management",           href: "/features/service-management",           desc: "Track post-sale service requests and support tickets. Keep customers happy after the deal closes.", bullets: ["Service ticket tracking", "SLA management", "Customer satisfaction", "Team assignment"], color: "#f0fdf4", accent: "#166534" },
  { icon: "fas fa-code-branch",   title: "Integrations",                 href: "/integrations",                          desc: "Connect with 13+ lead sources including IndiaMart, Facebook, 99acres, Housing, and your WordPress site.", bullets: ["13+ integrations", "Auto lead import", "Real-time sync", "Zero manual entry"], color: "#fff7e6", accent: "#c2410c" },
  { icon: "fas fa-handshake",     title: "Greetings",                    href: "/features/greetings",                    desc: "Send personalised birthday, anniversary, and festival greetings to customers automatically.", bullets: ["Birthday messages", "Festival greetings", "WhatsApp & SMS", "Custom templates"], color: "#fff1f2", accent: "#9f1239" },
];

export default function FeaturesPage() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.tag}>Features</div>
        <h1 className={styles.title}>
          Every Tool Your Team Needs to <span>Close More Deals</span>
        </h1>
        <p className={styles.subtitle}>
          Built specifically for Indian sales teams — every feature solves a real problem your team faces every day.
        </p>
        <div className={styles.heroMeta}>
          <i className="fas fa-th-large" /> 12 powerful features included
        </div>
      </section>

      <section className={styles.body}>
        <div className={styles.inner}>
          <div className={styles.grid}>
            {FEATURES.map((feat) => (
              <div key={feat.href} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.icon} style={{ background: feat.color, color: feat.accent }}>
                    <i className={feat.icon} />
                  </div>
                  <h2 className={styles.cardTitle}>{feat.title}</h2>
                </div>
                <p className={styles.cardDesc}>{feat.desc}</p>
                <ul className={styles.bullets}>
                  {feat.bullets.map((b) => (
                    <li key={b} className={styles.bullet}>
                      <span className={styles.bulletDot} style={{ background: feat.accent }} />
                      {b}
                    </li>
                  ))}
                </ul>
                <Link href={feat.href} className={styles.cardLink}>
                  Learn more <i className="fas fa-arrow-right" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>
            Ready to See These <span>Features in Action?</span>
          </h2>
          <p className={styles.ctaDesc}>
            Book a free demo and we'll walk you through everything your team needs.
          </p>
          <Link href="/schedule-demo" className={styles.btnPrimary}>
            <i className="fas fa-calendar-check" /> Book Free Demo
          </Link>
        </div>
      </section>
    </>
  );
}