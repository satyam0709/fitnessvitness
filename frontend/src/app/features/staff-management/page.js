import FeaturePage from "@/components/FeaturePage/featurePage";
export default function StaffManagementPage() {
  return (
    <FeaturePage
      icon="fas fa-user-friends"
      color="rgba(180,83,9,0.12)"
      accentColor="#b45309"
      title="Staff Management"
      subtitle="Add team members, assign roles, control access, and track performance."
      description="Staff Management gives business owners complete control over their team. Add staff members, assign roles (Admin, Manager, or Staff), and control what each person can see. Track individual performance — how many leads they have, tasks completed, and deals closed."
      howItWorks={[
        {
          title: "Add Staff",
          desc: "Invite team members by email. They sign up and get the assigned role.",
        },
        {
          title: "Assign Roles",
          desc: "Choose Admin, Manager, or Staff with different access levels.",
        },
        {
          title: "Track Performance",
          desc: "See each member's lead count, task completion, and conversion rate.",
        },
        {
          title: "Manage Users",
          desc: "Activate or deactivate any user instantly.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-lock",
          title: "Role-Based Access",
          desc: "Control exactly what each team member can view, edit, or delete.",
        },
        {
          icon: "fas fa-chart-line",
          title: "Performance Reports",
          desc: "Track leads, tasks, and deals per staff member.",
        },
        {
          icon: "fas fa-user-shield",
          title: "Secure Access Control",
          desc: "Deactivate any user immediately when they leave.",
        },
        {
          icon: "fas fa-random",
          title: "Lead Assignment Rules",
          desc: "Set round-robin or manual rules for distributing leads.",
        },
        {
          icon: "fas fa-activity",
          title: "Activity Tracking",
          desc: "See when each staff member last logged in.",
        },
      ]}
      useCases={[
        {
          role: "Business Owner",
          desc: "Add sales staff, assign roles, get performance reports.",
        },
        {
          role: "Sales Manager",
          desc: "See team workload, reassign leads, monitor daily activity.",
        },
        {
          role: "Admin",
          desc: "Manage all user accounts, reset access, control permissions.",
        },
      ]}
    />
  );
}
