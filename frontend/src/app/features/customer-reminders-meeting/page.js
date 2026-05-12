import FeaturePage from "@/components/FeaturePage/featurePage";
export default function CustomerRemindersMeetingPage() {
  return (
    <FeaturePage
      icon="fas fa-bell"
      color="rgba(34,197,94,0.12)"
      accentColor="#15803d"
      title="Customer Reminders & Meeting"
      subtitle="Never miss a follow-up, birthday, renewal, or meeting with smart automated reminders."
      description="Reminders and Meetings eliminate the most common reason deals fall through: forgetting to follow up. Set reminders for individual leads, get notified via WhatsApp or SMS, schedule meetings with customers, and invite team members — all with full automatic logging."
      howItWorks={[
        {
          title: "Set a Reminder",
          desc: "Add a reminder to any lead with date, time, and note.",
        },
        {
          title: "Get Notified",
          desc: "Alerts arrive via WhatsApp, SMS, or in-app notification.",
        },
        {
          title: "Schedule Meetings",
          desc: "Book meetings from a lead profile, invite attendees, add meet link.",
        },
        {
          title: "Log & Follow Up",
          desc: "Mark reminders done, add notes, set next follow-up.",
        },
      ]}
      benefits={[
        {
          icon: "fab fa-whatsapp",
          title: "WhatsApp Reminders",
          desc: "Reminders sent directly to WhatsApp so nothing is missed.",
        },
        {
          icon: "fas fa-birthday-cake",
          title: "Birthday & Anniversary Alerts",
          desc: "Auto-remind team when a customer occasion is approaching.",
        },
        {
          icon: "fas fa-calendar-alt",
          title: "Integrated Calendar",
          desc: "All meetings and reminders sync with the CRM calendar.",
        },
        {
          icon: "fas fa-redo",
          title: "Renewal Reminders",
          desc: "Automated alerts 30, 15, and 7 days before expiry.",
        },
        {
          icon: "fas fa-video",
          title: "Google Meet",
          desc: "Add a Google Meet link to any meeting in seconds.",
        },
      ]}
      useCases={[
        {
          role: "Sales Executive",
          desc: "Set a follow-up reminder after every call.",
        },
        {
          role: "Account Manager",
          desc: "Get renewal reminders weeks in advance to prepare proposals.",
        },
        {
          role: "Business Owner",
          desc: "See all team meetings and reminders on a single calendar.",
        },
      ]}
    />
  );
}
