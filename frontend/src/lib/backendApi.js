const DEFAULT_LOCAL_BACKEND_API_URL = "http://localhost:5000";

function normalizeBackendUrl(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function getBackendApiUrl() {
  const backendApiUrl = normalizeBackendUrl(
    process.env.BACKEND_API_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL
  );
  if (backendApiUrl) {
    return backendApiUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEFAULT_LOCAL_BACKEND_API_URL;
  }

  return "";
}
