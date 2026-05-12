import FeaturePage from "@/components/FeaturePage/featurePage";
export default function CampaignChannelsPage() {
  return (
    <FeaturePage
      icon="fas fa-bullhorn"
      color="rgba(107,33,168,0.12)"
      accentColor="#6b21a8"
      title="Campaign & Channels"
      subtitle="Run targeted campaigns across WhatsApp, SMS, and Email — measure which bring the best leads."
      description="The Campaign & Channels module lets you plan, launch, and measure marketing campaigns across multiple channels from one dashboard. Send bulk WhatsApp, SMS, or email campaigns to segmented lead lists and track which leads responded and converted."
      howItWorks={[
        {
          title: "Create a Campaign",
          desc: "Define channel (WhatsApp/SMS/Email), audience, and message template.",
        },
        {
          title: "Segment Audience",
          desc: "Target leads by source, status, location, or any CRM criteria.",
        },
        {
          title: "Launch & Deliver",
          desc: "Send instantly or schedule for the best delivery time.",
        },
        {
          title: "Track & Analyse",
          desc: "See open rates, conversions, and cost per lead for every campaign.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-layer-group",
          title: "Multi-Channel",
          desc: "Reach customers on WhatsApp, SMS, and Email from one manager.",
        },
        {
          icon: "fas fa-filter",
          title: "Segmentation",
          desc: "Target the right people by filtering lead criteria.",
        },
        {
          icon: "fas fa-chart-pie",
          title: "Campaign ROI",
          desc: "Track which campaigns generate the most conversions.",
        },
        {
          icon: "fas fa-code-branch",
          title: "Source Attribution",
          desc: "Know exactly which campaign brought in each lead.",
        },
        {
          icon: "fas fa-robot",
          title: "Automation",
          desc: "Set up drip campaigns based on lead behaviour.",
        },
      ]}
      useCases={[
        {
          role: "Marketing Team",
          desc: "Launch WhatsApp campaigns to re-engage cold leads.",
        },
        {
          role: "Business Owner",
          desc: "Compare campaign performance to allocate marketing budget.",
        },
        {
          role: "Sales Manager",
          desc: "Identify which campaigns need immediate follow-up from the sales team.",
        },
      ]}
    />
  );
}
