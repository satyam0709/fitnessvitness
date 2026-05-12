import { getGlobalAuthData } from "@/contexts/AuthContext";

/**
 * @param {URLSearchParams} searchParams
 * @returns {Promise<{ kind: "path"; href: string }>}
 */
export async function resolvePostLoginTarget(searchParams) {
  const returnTo = searchParams.get("returnTo");

  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return { kind: "path", href: returnTo };
  }

  return { kind: "path", href: "/dashboard" };
}

/**
 * After cookies exist: sync user, password gate, role-based landing, subscription wall for default dashboard.
 * @param {{ replace: (href: string) => void }} router
 * @param {URLSearchParams} searchParams
 */
export async function runPostLoginDashboardRouting(router, searchParams) {
  const { user } = getGlobalAuthData();

  const mustChange = user?.mustChangePassword === true;
  if (mustChange) {
    router.replace("/settings/change-password?forced=true");
    return false;
  }

  const target = await resolvePostLoginTarget(searchParams);
  router.replace(target.href);
  return false;
}
