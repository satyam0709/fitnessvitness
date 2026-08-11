import ConditionalLayout from "@/components/ConditionalLayout/conditionalLayout";
import DeferredIconCss from "@/components/DeferredIconCss";
import "./globals.css";
import { Roboto } from "next/font/google";
import { APP_NAME, LOGO_SRC } from "@/lib/branding";

const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-primary-face",
  display: "swap",
  weight: ["400", "500", "700", "900"],
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
    <html lang="en" className={roboto.variable} suppressHydrationWarning>
      <body suppressHydrationWarning className={roboto.className}>
        <DeferredIconCss />
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}
