import AppErrorPage from "@/components/AppErrorPage/AppErrorPage";

/** Use with redirect('/forbidden') when a user lacks permission for a resource. */
export default function ForbiddenPage() {
  return (
    <AppErrorPage
      code="403"
      title="Access denied"
      description="You don't have permission to view this page. If you think this is a mistake, contact your administrator."
      showSecondaryLink={false}
    />
  );
}
