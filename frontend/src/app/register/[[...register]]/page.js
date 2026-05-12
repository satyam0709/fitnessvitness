import Link from "next/link";
import styles from "./page.module.css";

export const metadata = {
  title: "Create Account – RND TECHNOSOFT CRM",
  description: "Create your RND TECHNOSOFT CRM account and start managing leads today.",
};

export default function RegisterPage() {
  return (
    <div className={styles.page}>
      <div className={styles.clerkPanel}>
        <h2 style={{ marginTop: 0, fontSize: 22 }}>Create an account</h2>
        <p style={{ color: "#4b5563", lineHeight: 1.5 }}>
          Workspace accounts are created by your administrator, or you can accept an email invitation to set a password.
        </p>
        <p style={{ marginTop: 16 }}>
          <Link href="/signup" style={{ color: "#111827", fontWeight: 600 }}>
            Create workspace (signup)
          </Link>
          {" · "}
          <Link href="/login" style={{ color: "#111827", fontWeight: 600 }}>
            Sign in
          </Link>
          {" · "}
          <Link href="/invite/accept" style={{ color: "#111827", fontWeight: 600 }}>
            Accept invitation
          </Link>
        </p>
      </div>

      <div className={styles.panel}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>RND</span>
          <span className={styles.logoText}>TECHNOSOFT</span>
        </div>
        <h2 className={styles.panelTitle}>
          Start closing more deals in <span>under 10 minutes</span>
        </h2>
        <p className={styles.panelDesc}>
          Set up your CRM, invite your team, and start managing leads — all in one afternoon.
        </p>
        <div className={styles.trialBadge}>
          <i className="fas fa-gift" /> 14-day free trial. No credit card needed.
        </div>
        <ul className={styles.steps}>
          {["Create your account", "Set up your team & assign roles", "Connect your lead sources", "Start closing deals"].map(
            (step, i) => (
              <li key={step} className={styles.stepItem}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span className={styles.stepText}>{step}</span>
              </li>
            )
          )}
        </ul>
      </div>
    </div>
  );
}
