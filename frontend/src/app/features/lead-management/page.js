import FeaturePage from "@/components/FeaturePage/featurePage";

export const metadata = {
  title: "Lead Management – RND TECHNOSOFT CRM",
  description: "Capture, track, and convert leads from IndiaMart, Facebook, Google Ads, and more. Never lose a lead again.",
};

export default function LeadManagementPage() {
  return (
    <FeaturePage
      icon="fas fa-filter"
      color="rgba(245,196,0,0.15)"
      accentColor="#D4A900"
      title="Lead Management"
      subtitle="Capture leads from every source, assign them to your team, and track every interaction until the deal is closed."
      description="Lead Management is the heart of RND TECHNOSOFT CRM. It brings all your enquiries from IndiaMart, Facebook Ads, Google Ads, 99acres, Housing.com, and your website into one unified pipeline. Every lead gets timestamped, auto-assigned, and tracked — so nothing falls through the cracks. Your team knows exactly what to do next, and your managers see the full picture in real time."
      howItWorks={[
        {
          title: "Lead Capture",
          desc: "Leads arrive automatically from all your connected sources. No manual entry, no copy-pasting.",
        },
        {
          title: "Auto Assignment",
          desc: "Set rules to auto-assign leads to the right salesperson based on source, location, or round-robin.",
        },
        {
          title: "Track & Nurture",
          desc: "Update lead status, add notes, set follow-up reminders, and log every call or meeting.",
        },
        {
          title: "Convert & Close",
          desc: "Mark leads as closed, track conversion rates, and analyse which sources bring the best customers.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-bolt",
          title: "Instant Lead Alerts",
          desc: "Get notified the moment a new lead arrives so your team can respond within minutes, not hours.",
        },
        {
          icon: "fas fa-user-tag",
          title: "Smart Assignment Rules",
          desc: "Define who gets which leads automatically — by source, territory, or workload balance.",
        },
        {
          icon: "fas fa-history",
          title: "Complete Lead History",
          desc: "Every note, call, meeting, and status change is logged so any team member can pick up where another left off.",
        },
        {
          icon: "fas fa-chart-bar",
          title: "Pipeline Analytics",
          desc: "See your entire funnel at a glance. Identify bottlenecks, track conversion rates, and optimise your process.",
        },
        {
          icon: "fas fa-ban",
          title: "Duplicate Detection",
          desc: "Automatically flag or merge duplicate leads so your team never wastes time on the same prospect twice.",
        },
      ]}
      useCases={[
        {
          role: "Sales Manager",
          desc: "Monitor every salesperson's pipeline, reassign stale leads, and set daily targets — all from the dashboard.",
        },
        {
          role: "Sales Executive",
          desc: "See your assigned leads, log follow-ups, and know exactly which leads need attention today.",
        },
        {
          role: "Business Owner",
          desc: "Track how many leads come in, how many convert, and which sources bring the highest ROI.",
        },
      ]}
    />
  );
}