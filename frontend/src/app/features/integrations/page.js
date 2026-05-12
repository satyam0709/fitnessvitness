import FeaturePage from "@/components/FeaturePage/featurePage";
import IntegrationsManager from "@/components/integrations/IntegrationsManager";

export default function IntegrationsFeaturePage() {
  return (
    <>
      <FeaturePage
        icon="fas fa-plug"
        color="rgba(15,118,110,0.15)"
        accentColor="#0f766e"
        title="Integrations"
        subtitle="Connect lead sources and tools so enquiries flow straight into your pipeline."
        description="Integrations let you turn on inbound channels—social ads, portals, website forms, and more—without manual CSV work. Each source can be enabled for your workspace, and webhooks post new leads into the CRM in real time."
        howItWorks={[
          {
            title: "Choose sources",
            desc: "Enable the channels your business actually uses.",
          },
          {
            title: "Secure webhooks",
            desc: "Each integration exposes a webhook URL for your provider to call.",
          },
          {
            title: "Mapped fields",
            desc: "Name, phone, and other required fields land on the lead record.",
          },
          {
            title: "Toggle anytime",
            desc: "Turn sources on or off from your workspace without redeploying.",
          },
        ]}
        benefits={[
          {
            icon: "fas fa-bolt",
            title: "Faster response",
            desc: "Leads appear as soon as the platform sends them.",
          },
          {
            icon: "fas fa-link",
            title: "One pipeline",
            desc: "Every source feeds the same lead list and follow-up flow.",
          },
          {
            icon: "fas fa-shield-alt",
            title: "Controlled access",
            desc: "Only enabled integrations accept traffic for your account.",
          },
        ]}
      />
      <IntegrationsManager />
    </>
  );
}
