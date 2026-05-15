const DEFAULT_LOCAL_BACKEND_API_URL = "http://localhost:5000";

function normalizeBackendUrl(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/** Host only (no path) for building https://… URLs. */
function hostOnly(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  return t.replace(/^https?:\/\//i, "").split("/")[0].replace(/\/+$/, "");
}

/**
 * Vercel monorepo experimental backend (see vercel.json routePrefix: "/_/backend").
 * Uses deployment host from env (no protocol on VERCEL_URL).
 */
function vercelColocatedBackendBase() {
  const raw = String(
    process.env.VERCEL_URL ||
      process.env.VERCEL_BRANCH_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      ""
  ).trim();
  const host = hostOnly(raw);
  if (!host) return "";
  return `https://${host}/_/backend`;
}

function appBaseBackend() {
  const host = hostOnly(process.env.NEXT_PUBLIC_APP_BASE_DOMAIN);
  if (!host) return "";
  return `https://${host}/_/backend`;
}

/**
 * Base URL for the Express API (no trailing slash), used by the Next.js server proxy.
 * Priority: BACKEND_API_URL → BACKEND_URL → NEXT_PUBLIC_API_URL → Vercel colocated /_/backend
 * → NEXT_PUBLIC_APP_BASE_DOMAIN /_/backend → dev localhost.
 */
export function getBackendApiUrl() {
  const explicit = normalizeBackendUrl(
    process.env.BACKEND_API_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL
  );
  if (explicit) return explicit;

  if (process.env.NODE_ENV !== "production") {
    return DEFAULT_LOCAL_BACKEND_API_URL;
  }

  const vercel = vercelColocatedBackendBase();
  if (vercel) return vercel;

  const fromAppDomain = appBaseBackend();
  if (fromAppDomain) return fromAppDomain;

  return "";
}
