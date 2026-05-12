import FeaturePage from "@/components/FeaturePage/featurePage";
export default function NotesManagementPage() {
  return (
    <FeaturePage
      icon="far fa-sticky-note"
      color="rgba(126,34,206,0.12)"
      accentColor="#7e22ce"
      title="Notes Management"
      subtitle="Keep detailed notes on every customer interaction attached directly to leads."
      description="Notes Management solves the problem of lost context. When a salesperson logs a call summary or records a key detail, that note is permanently attached to the lead and visible to the entire team. New team members understand a customer's history immediately. Handovers become seamless."
      howItWorks={[
        {
          title: "Add a Note",
          desc: "Write a note directly on a lead profile from the detail page.",
        },
        {
          title: "Attach to Lead",
          desc: "Every note is linked to the specific lead it belongs to.",
        },
        {
          title: "Search Notes",
          desc: "Search across all notes by keyword to find information instantly.",
        },
        {
          title: "Team Access",
          desc: "All authorised team members can see notes.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-link",
          title: "Lead-Linked Notes",
          desc: "Notes attach to leads permanently so history is always available.",
        },
        {
          icon: "fas fa-search",
          title: "Searchable History",
          desc: "Find any note instantly by searching keywords.",
        },
        {
          icon: "fas fa-clock",
          title: "Timestamped Entries",
          desc: "Every note shows who wrote it and when — full audit trail.",
        },
        {
          icon: "fas fa-users",
          title: "Team Collaboration",
          desc: "Multiple team members can add notes on the same lead.",
        },
        {
          icon: "fas fa-mobile-alt",
          title: "Mobile Access",
          desc: "Add notes from the field immediately after a meeting.",
        },
      ]}
      useCases={[
        {
          role: "Sales Executive",
          desc: "Log call summaries and customer preferences as notes after every interaction.",
        },
        {
          role: "Sales Manager",
          desc: "Review notes on any lead to understand deal status without asking.",
        },
        {
          role: "Support Team",
          desc: "Log post-sale interactions as notes on the customer record.",
        },
      ]}
    />
  );
}
