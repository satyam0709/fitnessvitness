import {
  buildTenantDashboardUrl,
  getAppBaseDomain,
  getTenantSubdomainFromHost,
} from "./api";
import { getGlobalAuthData } from "@/contexts/AuthContext";

/**
 * True when the browser is on the main app host (no workspace subdomain).
 * Localhost without a tenant slug counts as apex.
 */
function isApexHost() {
  if (typeof window === "undefined") return true;
  return getTenantSubdomainFromHost() === "";
}

/**
 * Allow only redirects to our app domain (and subdomains); blocks open redirects.
 * In production, require https. In dev, allow http for localhost.
 */
function sanitizeWorkspaceDashboardUrl(href) {
  try {
    const u = new URL(href);
    const prod = typeof process !== "undefined" && process.env.NODE_ENV === "production";
    const base = getAppBaseDomain().replace(/^www\./, "");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const localHostOk =
      !prod && (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1");
    if (!localHostOk && host !== base && !host.endsWith(`.${base}`)) return null;

    if (prod) {
      if (u.protocol !== "https:") return null;
    } else if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    u.pathname = "/dashboard";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Preferred full URL for workspace CRM dashboard (from /auth/me tenant_url + path).
 */
function tenantWorkspaceDashboardHref(mePayload) {
  const sub = mePayload?.tenant_subdomain;
  if (!sub) return null;
  const baseUrl = String(mePayload.tenant_url || "").trim().replace(/\/+$/, "");
  if (baseUrl) {
    const candidate = `${baseUrl}/dashboard`;
    const safe = sanitizeWorkspaceDashboardUrl(candidate);
    if (safe) return safe;
  }
  const built = buildTenantDashboardUrl(sub);
  return sanitizeWorkspaceDashboardUrl(built) || built;
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {Promise<{ kind: "path" | "full"; href: string }>}
 */
export async function resolvePostLoginTarget(searchParams) {
  const { user, mePayload } = getGlobalAuthData();
  const returnTo = searchParams.get("returnTo");

  // Force onboarding completion FIRST
  if (mePayload?.onboarding_locked) {
    return { kind: "path", href: "/dashboard" };
  }

  if (!user || !mePayload) {
    return { kind: "path", href: "/dashboard" };
  }

  // Tenant workspace members: enforce assigned workspace URL before checking returnTo
  const expectedSub = mePayload.tenant_subdomain;
  const workspaceHrefBase = tenantWorkspaceDashboardHref(mePayload);
  let isWrongSubdomain = false;
  
  if (expectedSub && workspaceHrefBase) {
    const currentSub = getTenantSubdomainFromHost();
    if (currentSub !== expectedSub) {
      isWrongSubdomain = true;
    }
  }

  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    // If they provided returnTo but are on the wrong subdomain, append the returnTo path to their workspace base URL
    if (isWrongSubdomain) {
      try {
        const u = new URL(workspaceHrefBase);
        // Replace '/dashboard' at the end with the returnTo path
        u.pathname = returnTo;
        return { kind: "full", href: u.toString() };
      } catch {
        return { kind: "full", href: workspaceHrefBase };
      }
    }
    
    return { kind: "path", href: returnTo };
  }

  if (isWrongSubdomain) {
    return { kind: "full", href: workspaceHrefBase };
  }

  // No tenant (e.g. platform-only user) or already on correct sub — stay on current host.
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
    return;
  }

  const target = await resolvePostLoginTarget(searchParams);
  if (target.kind === "full") {
    const verified = sanitizeWorkspaceDashboardUrl(target.href);
    window.location.href = verified || target.href;
    return true; // Indicates full page navigation has started
  }

  if (target.href !== "/dashboard") {
    router.replace(target.href);
    return false;
  }

  router.replace("/dashboard");
  return false;
}
