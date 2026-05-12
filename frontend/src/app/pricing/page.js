import PricingPageClient from "./pricing-page-client";

export const metadata = {
  title: "Pricing – RND TECHNOSOFT CRM",
  description: "Simple, transparent pricing for businesses of all sizes. No hidden fees.",
};

/** Server shell keeps metadata; interactive pricing lives in the client component. */
export default function PricingPage() {
  return <PricingPageClient />;
}
