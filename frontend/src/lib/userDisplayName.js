/**
 * Client-side display name aligned with backend `resolveClerkNamesForDb`
 * (used before /users/me has loaded).
 */

function prettifyEmailLocalPart(email) {
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at <= 0) return "";
  let local = e.slice(0, at).trim();
  if (!local) return "";
  local = local.replace(/[.+_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!local) return "";
  return local
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
}

/** @param {{ firstName?: string, lastName?: string, primaryEmailAddress?: { emailAddress?: string }, emailAddresses?: Array<{ emailAddress?: string }> } | null | undefined} user */
export function displayNameFromClerkUser(user) {
  if (!user) return "";
  const f = user.firstName?.trim() || "";
  const l = user.lastName?.trim() || "";
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const email =
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress ||
    "";
  return prettifyEmailLocalPart(email);
}

/** @param {{ first_name?: string|null; last_name?: string|null; full_name?: string|null } | null | undefined} row */
export function displayNameFromDbUser(row) {
  if (!row) return "";
  const f = row.first_name != null ? String(row.first_name).trim() : "";
  const l = row.last_name != null ? String(row.last_name).trim() : "";
  const joined = [f, l].filter(Boolean).join(" ").trim();
  if (joined) return joined;
  return row.full_name != null ? String(row.full_name).trim() : "";
}
