/**
 * Normalize how we store display names from Clerk + email.
 * - If the user entered a first and/or last name in Clerk, use those (trimmed).
 * - If both are empty, derive a friendly first name from the email local-part.
 */

function trimOrNull(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

function prettifyEmailLocalPart(email) {
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at <= 0) return null;
  let local = e.slice(0, at).trim();
  if (!local) return null;
  local = local.replace(/[.+_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!local) return null;
  const capped = local
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .filter(Boolean)
    .join(" ");
  const out = (capped || local).slice(0, 80);
  return out || null;
}

/**
 * @returns {{ first_name: string|null, last_name: string|null }}
 */
function resolveClerkNamesForDb(firstName, lastName, email) {
  const f = trimOrNull(firstName);
  const l = trimOrNull(lastName);
  if (f || l) {
    return { first_name: f, last_name: l };
  }
  const fromEmail = prettifyEmailLocalPart(email);
  return { first_name: fromEmail, last_name: null };
}

module.exports = { resolveClerkNamesForDb, prettifyEmailLocalPart, trimOrNull };
