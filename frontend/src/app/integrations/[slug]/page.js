import Link from "next/link";
import { notFound } from "next/navigation";
import { INTEGRATIONS, getIntegrationBySlug } from "../../../lib/integrations";
import styles from "./page.module.css";

export function generateStaticParams() {
  return INTEGRATIONS.map((integration) => ({ slug: integration.slug }));
}

export function generateMetadata({ params }) {
  const integration = getIntegrationBySlug(params.slug);

  if (!integration) {
    return {
      title: "Integration Not Found - FitnessVitness CRM",
    };
  }

  return {
    title: `${integration.title} Integration - FitnessVitness CRM`,
    description: integration.desc,
  };
}

function buildCurlSnippet(webhookUrl, integration) {
  return [
    `curl -X POST "${webhookUrl}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "x-integration-secret: <your-secret>" \\`,
    `  -d '${JSON.stringify(integration.samplePayload, null, 2)}'`,
  ].join("\n");
}

export default function IntegrationDetailPage({ params }) {
  const integration = getIntegrationBySlug(params.slug);

  if (!integration) {
    notFound();
  }

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
  const webhookUrl = `${apiBase}/api/integrations/webhook/${integration.key}`;
  const themeStyle = {
    "--accent": integration.accent,
    "--surface": integration.color,
  };

  return (
    <main className={styles.page} style={themeStyle}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link href="/integrations" className={styles.backLink}>
            <i className="fas fa-arrow-left" /> Back to Integrations
          </Link>
          <div className={styles.tag}>Integration Setup</div>
          <h1 className={styles.title}>
            Connect <span>{integration.title}</span> to FitnessVitness CRM
          </h1>
          <p className={styles.subtitle}>{integration.desc}</p>

          <div className={styles.badges}>
            <span className={styles.badge}>Source Key: {integration.key}</span>
            <span className={styles.badge}>Webhook Ready</span>
            {integration.badge ? <span className={styles.badgeAccent}>{integration.badge}</span> : null}
          </div>
        </div>

        <aside className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <i className={integration.icon} />
          </div>
          <div className={styles.summaryRows}>
            <div className={styles.summaryRow}>
              <span>Webhook URL</span>
              <strong>{webhookUrl}</strong>
            </div>
            <div className={styles.summaryRow}>
              <span>Auth</span>
              <strong>`x-integration-secret` header</strong>
            </div>
            <div className={styles.summaryRow}>
              <span>Minimum Fields</span>
              <strong>`name`, `phone`</strong>
            </div>
            <div className={styles.summaryRow}>
              <span>Optional Routing</span>
              <strong>`assigned_to`</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>How To Connect</h2>
          <div className={styles.steps}>
            {integration.setupSteps.map((step, index) => (
              <div key={step} className={styles.step}>
                <div className={styles.stepNumber}>{index + 1}</div>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>What CRM Does After Capture</h2>
          <div className={styles.outcomes}>
            {integration.crmOutcome.map((item) => (
              <div key={item} className={styles.outcome}>
                <i className="fas fa-check-circle" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Supported Fields</h2>
          <div className={styles.fieldList}>
            {integration.supportedFields.map((field) => (
              <span key={field} className={styles.fieldChip}>
                {field}
              </span>
            ))}
          </div>
          <p className={styles.note}>
            The backend also normalizes common aliases like `full_name`, `mobile`, `company`, `notes`, and nested `data.*` webhook fields.
          </p>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Example Payload</h2>
          <pre className={styles.codeBlock}>
            <code>{JSON.stringify(integration.samplePayload, null, 2)}</code>
          </pre>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Sample Request</h2>
        <pre className={styles.codeBlock}>
          <code>{buildCurlSnippet(webhookUrl, integration)}</code>
        </pre>
      </section>

      <section className={styles.cta}>
        <div>
          <h2>Need a custom mapping?</h2>
          <p>
            If the source sends unusual field names, we can extend the mapping layer in the backend without changing your sales workflow.
          </p>
        </div>
        <div className={styles.ctaActions}>
          <Link href="/contact-us" className={styles.primaryBtn}>
            Request Integration Help
          </Link>
          <Link href="/integrations" className={styles.secondaryBtn}>
            View All Integrations
          </Link>
        </div>
      </section>
    </main>
  );
}
