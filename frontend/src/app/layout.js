import ConditionalLayout from "@/components/ConditionalLayout/conditionalLayout";
import "./globals.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { Inter, Lora, Montserrat } from "next/font/google";
import { APP_NAME, LOGO_SRC } from "@/lib/branding";

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
  title: APP_NAME,
  icons: {
    icon: LOGO_SRC,
    shortcut: LOGO_SRC,
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