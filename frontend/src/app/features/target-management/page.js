import FeaturePage from "@/components/FeaturePage/featurePage";
export default function TargetManagementPage() {
  return (
    <FeaturePage
      icon="fas fa-bullseye"
      color="rgba(30,64,175,0.12)"
      accentColor="#1e40af"
      title="Target Management"
      subtitle="Set monthly, quarterly, and annual targets for your team and track progress in real time."
      description="Target Management brings accountability to your sales team. Set individual or team-level targets for lead conversions or revenue. Salespeople see their own progress, creating self-motivation. Managers get a clear view of who is on track and who needs coaching."
      howItWorks={[
        {
          title: "Set Targets",
          desc: "Define monthly, quarterly, or annual targets per person or team.",
        },
        {
          title: "Choose Metrics",
          desc: "Track lead conversions, revenue, calls, or meetings.",
        },
        {
          title: "Monitor Progress",
          desc: "Real-time dashboards show current progress vs target.",
        },
        {
          title: "Compare & Report",
          desc: "Generate target vs actual reports for any period.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-trophy",
          title: "Individual Targets",
          desc: "Set personalised targets based on role and territory.",
        },
        {
          icon: "fas fa-tachometer-alt",
          title: "Progress Dashboards",
          desc: "Visual progress bars show how far from target.",
        },
        {
          icon: "fas fa-balance-scale",
          title: "Target vs Actual",
          desc: "Compare planned targets against real results.",
        },
        {
          icon: "fas fa-calendar-check",
          title: "Period Comparison",
          desc: "Compare this month to last month or year-over-year.",
        },
        {
          icon: "fas fa-user-clock",
          title: "Forecast View",
          desc: "See projected performance based on current pace.",
        },
      ]}
      useCases={[
        {
          role: "Business Owner",
          desc: "Set annual targets and check weekly dashboards.",
        },
        {
          role: "Sales Manager",
          desc: "Assign monthly targets and coach those falling behind.",
        },
        {
          role: "Sales Executive",
          desc: "Check your dashboard to see progress toward this month's target.",
        },
      ]}
    />
  );
}
