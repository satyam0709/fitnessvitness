import FeaturePage from "@/components/FeaturePage/featurePage";
export default function LiveChatPage() {
  return (
    <FeaturePage
      icon="far fa-comment"
      color="rgba(190,18,60,0.12)"
      accentColor="#be123c"
      title="Live Chat"
      subtitle="Chat with your team in real time and turn website visitors into leads."
      description="Live Chat serves two purposes: internal team communication and external customer engagement. Team members message each other directly within the CRM, keeping discussions attached to leads. Website enquiries can be instantly converted into CRM leads with the full conversation attached."
      howItWorks={[
        {
          title: "Team Messaging",
          desc: "Send messages to any team member directly inside the CRM.",
        },
        {
          title: "Lead Discussions",
          desc: "Discuss a specific lead with colleagues from inside the lead profile.",
        },
        {
          title: "Customer Chats",
          desc: "Website visitors can chat with your team and conversations are auto-logged.",
        },
        {
          title: "Convert to Lead",
          desc: "One click converts any chat enquiry into a full CRM lead.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-comments",
          title: "Real-Time Communication",
          desc: "Instant messaging keeps everyone aligned without leaving the CRM.",
        },
        {
          icon: "fas fa-bell",
          title: "Unread Message Badges",
          desc: "Topbar shows unread counts so nothing goes unseen.",
        },
        {
          icon: "fas fa-history",
          title: "Chat History",
          desc: "All conversations are stored permanently.",
        },
        {
          icon: "fas fa-user-plus",
          title: "Auto Lead Creation",
          desc: "Website enquiries convert to CRM leads automatically.",
        },
        {
          icon: "fas fa-inbox",
          title: "Team Inbox",
          desc: "Incoming messages visible to assigned team members.",
        },
      ]}
      useCases={[
        {
          role: "Sales Team",
          desc: "Discuss lead strategy and coordinate follow-ups without switching to WhatsApp.",
        },
        {
          role: "Manager",
          desc: "Get real-time updates and coach salespeople by reviewing conversations.",
        },
        {
          role: "Customer Support",
          desc: "Handle website enquiries and instantly create support leads.",
        },
      ]}
    />
  );
}
