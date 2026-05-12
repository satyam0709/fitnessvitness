import AppErrorPage from "@/components/AppErrorPage/AppErrorPage";

/** Global 404 — unknown URLs. “Home” is smart: dashboard if subscribed, else add-package, else marketing /. */
export default function NotFound() {
  return (
    <AppErrorPage
      code="404"
      title="Page Not Found"
      description="Oops! The requested URL was not found on this server."
    />
  );
}
