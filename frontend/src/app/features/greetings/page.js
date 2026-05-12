import FeaturePage from "@/components/FeaturePage/featurePage";
export default function GreetingsPage() {
  return (
    <FeaturePage
      icon="fas fa-handshake"
      color="rgba(159,18,57,0.12)"
      accentColor="#9f1239"
      title="Greetings"
      subtitle="Send personalised birthday, anniversary, and festival greetings to customers automatically."
      description="The Greetings module helps you build genuine personal relationships at scale. The CRM automatically identifies upcoming occasions and sends branded, personalised greetings via WhatsApp or SMS. Festival greetings — Diwali, Eid, Christmas, New Year — can be scheduled in bulk. These touches create loyalty and keep your brand top-of-mind year-round."
      howItWorks={[
        {
          title: "Store Customer Dates",
          desc: "Save birthdays, anniversaries in the customer profile.",
        },
        {
          title: "Create Templates",
          desc: "Design personalised templates with customer name and brand.",
        },
        {
          title: "Automate Sending",
          desc: "CRM auto-sends greetings on the right date via WhatsApp/SMS.",
        },
        {
          title: "Festival Broadcasts",
          desc: "Schedule festival greetings as bulk campaigns.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-birthday-cake",
          title: "Birthday Messages",
          desc: "Automatically send personalised birthday wishes.",
        },
        {
          icon: "fas fa-gift",
          title: "Festival Greetings",
          desc: "Schedule Diwali, Eid, Christmas, New Year messages.",
        },
        {
          icon: "fab fa-whatsapp",
          title: "WhatsApp & SMS",
          desc: "Deliver greetings through WhatsApp or SMS.",
        },
        {
          icon: "fas fa-pencil-alt",
          title: "Custom Templates",
          desc: "Branded templates with customer name and logo.",
        },
        {
          icon: "fas fa-heart",
          title: "Customer Loyalty",
          desc: "Regular personal touches increase retention and referrals.",
        },
      ]}
      useCases={[
        {
          role: "Sales Executive",
          desc: "Never forget a customer's birthday — CRM handles it automatically.",
        },
        {
          role: "Business Owner",
          desc: "Send festival greetings to 500+ customers in seconds.",
        },
        {
          role: "Account Manager",
          desc: "Build loyalty with key accounts by sending anniversary messages.",
        },
      ]}
    />
  );
}
