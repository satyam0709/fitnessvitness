import FeaturePage from "@/components/FeaturePage/featurePage";
export default function CalendarPage() {
  return (
    <FeaturePage
      icon="fas fa-calendar-alt"
      color="rgba(6,95,70,0.12)"
      accentColor="#065f46"
      title="Calendar"
      subtitle="A unified calendar showing all team follow-ups, meetings, tasks, and reminders."
      description="The Calendar gives every team member and manager a single source of truth for what is happening today, this week, and this month. All follow-up dates, meetings, task due dates, and reminders automatically appear on the calendar. Managers toggle between personal and team-wide view."
      howItWorks={[
        {
          title: "Auto Population",
          desc: "Follow-up dates, meetings, and task due dates appear automatically.",
        },
        {
          title: "Personal & Team View",
          desc: "Switch between your schedule and a team-wide calendar.",
        },
        {
          title: "Daily & Weekly Views",
          desc: "View by day for detail or by week for broader planning.",
        },
        {
          title: "Click to Act",
          desc: "Click any calendar item to open the linked lead or task.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-eye",
          title: "Full Team Visibility",
          desc: "Managers see what every team member has scheduled.",
        },
        {
          icon: "fas fa-sync",
          title: "Automatic Sync",
          desc: "No manual calendar entries — everything syncs in real time.",
        },
        {
          icon: "fas fa-layer-group",
          title: "Multiple Event Types",
          desc: "Follow-ups, meetings, birthdays all appear colour-coded.",
        },
        {
          icon: "fas fa-mobile-alt",
          title: "Mobile Calendar",
          desc: "Access schedule from the mobile app for field teams.",
        },
        {
          icon: "fas fa-filter",
          title: "Filter by Type",
          desc: "Show only meetings, follow-ups, or tasks.",
        },
      ]}
      useCases={[
        {
          role: "Sales Manager",
          desc: "See the full team's daily schedule to plan coverage.",
        },
        {
          role: "Sales Executive",
          desc: "Start each day on calendar view to see all due items.",
        },
        {
          role: "Business Owner",
          desc: "Review weekly calendar to understand team activity.",
        },
      ]}
    />
  );
}
