import FeaturePage from "@/components/FeaturePage/featurePage";

export const metadata = {
  title: "Task Management – RND TECHNOSOFT CRM",
  description: "Create, assign, and track tasks for every lead. Never miss a follow-up again.",
};

export default function TaskManagementPage() {
  return (
    <FeaturePage
      icon="fas fa-calendar-check"
      color="rgba(29,78,216,0.12)"
      accentColor="#1d4ed8"
      title="Task Management"
      subtitle="Assign tasks to your team, set due dates, and track completion — all linked directly to your leads."
      description="Task Management in RND TECHNOSOFT CRM ensures every follow-up, call, proposal, or meeting is tracked and owned. When a salesperson creates a task linked to a lead, the system tracks it from creation to completion. Managers can see pending tasks across the whole team and identify who is overloaded or slipping on deadlines."
      howItWorks={[
        {
          title: "Create Tasks",
          desc: "Create tasks manually or let reminders auto-generate tasks when follow-up dates are due.",
        },
        {
          title: "Assign to Team",
          desc: "Assign any task to any team member with a priority level and due date.",
        },
        {
          title: "Track Progress",
          desc: "Tasks move through Todo → In Progress → Done. Managers see status in real time.",
        },
        {
          title: "Get Reminded",
          desc: "Overdue tasks highlight in red. WhatsApp and SMS reminders can be triggered automatically.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-link",
          title: "Linked to Leads",
          desc: "Every task is connected to a specific lead so context is always one click away.",
        },
        {
          icon: "fas fa-users",
          title: "Team Visibility",
          desc: "Managers see every task across every team member without asking for updates.",
        },
        {
          icon: "fas fa-fire",
          title: "Priority Levels",
          desc: "Mark tasks as High, Medium, or Low priority so teams focus on what matters most.",
        },
        {
          icon: "fas fa-check-double",
          title: "Progress Tracking",
          desc: "See completion rates per person, per week — identify who needs help and who is excelling.",
        },
      ]}
      useCases={[
        {
          role: "Sales Manager",
          desc: "Assign follow-up tasks to salespeople, set deadlines, and verify completion without micromanaging.",
        },
        {
          role: "Sales Executive",
          desc: "Start each day knowing exactly what to do — your task list is prioritised and linked to leads.",
        },
        {
          role: "Support Team",
          desc: "Manage post-sale tasks like document collection, onboarding calls, and service requests.",
        },
      ]}
    />
  );
}