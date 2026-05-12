import DashboardAppShell from "./DashboardAppShell";

/** Clerk + subscription gate need a fresh render per request; avoids prerender/RSC 500s on /dashboard. */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }) {
  return <DashboardAppShell>{children}</DashboardAppShell>;
}
