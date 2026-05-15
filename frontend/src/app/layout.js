import ConditionalLayout from "@/components/ConditionalLayout/conditionalLayout";
import "./globals.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { Inter, Lora, Montserrat } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata = {
  title: "365 RND CRM",
  icons: {
    icon: "/assets/365-rnd-crm-sidebar-compressed-logo-dark.svg",
    shortcut: "/assets/365-rnd-crm-sidebar-compressed-logo-dark.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${montserrat.variable} ${inter.variable} ${lora.variable}`}
      >
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}