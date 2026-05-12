"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar/Navbar";
import Footer from "@/components/Footer/Footer";
import ContactPopup from "@/components/contactpopup/ContactPopup";
import Providers from "@/app/providers";
import { PROTECTED_PREFIXES } from "@/lib/constants";

/** Auth flows use their own layout; skip marketing chrome to avoid "logged in" header on /login. */
const AUTH_LANDING_PREFIXES = ["/login", "/signup", "/sign-in", "/register", "/invite", "/reset-password"];

function isAuthLandingPath(pathname) {
  return AUTH_LANDING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function ConditionalLayout({ children }) {
  const pathname = usePathname();
  const isApp = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthLanding = isAuthLandingPath(pathname);
  const showMarketingChrome = !isApp && !isAuthLanding;

  return (
    <Providers>
      {showMarketingChrome && <Navbar />}
      {isApp ? children : <main>{children}</main>}
      {showMarketingChrome && <Footer />}
      {showMarketingChrome && <ContactPopup />}
    </Providers>
  );
}