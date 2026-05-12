import FeaturePage from "@/components/FeaturePage/featurePage";
export default function ServiceManagementPage() {
  return (
    <FeaturePage
      icon="fas fa-layer-group"
      color="rgba(22,101,52,0.12)"
      accentColor="#166534"
      title="Service Management"
      subtitle="Track post-sale service requests, assign technicians, and keep customers happy after the deal closes."
      description="Service Management extends your pipeline beyond the sale. After a customer is acquired, their service requests and support tickets are tracked with the same discipline as pre-sale leads. Create tickets, assign to field staff, track resolution, and send service reminders automatically."
      howItWorks={[
        {
          title: "Create Ticket",
          desc: "Log a service request and attach it to the customer's record.",
        },
        {
          title: "Assign to Staff",
          desc: "Assign ticket to the right technician with deadline and priority.",
        },
        {
          title: "Track Resolution",
          desc: "Staff updates status from Open to In Progress to Resolved.",
        },
        {
          title: "Send Reminders",
          desc: "Automated reminders notify customers of scheduled service visits.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-clipboard-list",
          title: "Ticket Tracking",
          desc: "Every service request is logged and tracked — nothing lost in WhatsApp.",
        },
        {
          icon: "fas fa-stopwatch",
          title: "SLA Management",
          desc: "Set resolution targets and get alerts when tickets risk breach.",
        },
        {
          icon: "fas fa-smile",
          title: "Customer Satisfaction",
          desc: "Log feedback after service visits to track satisfaction trends.",
        },
        {
          icon: "fas fa-users-cog",
          title: "Team Assignment",
          desc: "Assign service tasks with location context and customer details.",
        },
        {
          icon: "fas fa-bell",
          title: "Service Reminders",
          desc: "Send WhatsApp/SMS reminders before scheduled service visits.",
        },
      ]}
      useCases={[
        {
          role: "Service Manager",
          desc: "See all open tickets, monitor SLA, reassign when needed.",
        },
        {
          role: "Field Technician",
          desc: "Check assigned tickets on mobile, update status on-site.",
        },
        {
          role: "Business Owner",
          desc: "Track service performance metrics and customer satisfaction.",
        },
      ]}
    />
  );
}
