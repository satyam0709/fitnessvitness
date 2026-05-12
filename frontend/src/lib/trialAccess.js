/** Wall-clock trial length: 7 × 24 × 60 × 60 seconds (must match backend). */
export const TRIAL_SECONDS = 7 * 24 * 60 * 60;
export const TRIAL_MS = TRIAL_SECONDS * 1000;

export function trialEndMsFromCreated(createdAt) {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  return t + TRIAL_MS;
}

/** True if this order row currently allows dashboard access (matches backend rules). */
export function orderGrantsAccess(order) {
  if (!order || typeof order !== "object") return false;
  if (order.status === "active") return true;
  if (order.status !== "trial") return false;
  const end = trialEndMsFromCreated(order.created_at);
  if (end == null) return false;
  return end > Date.now();
}

/** Live access from GET /orders payload (uses API flag when present, else infers from orders). */
export function subscriptionGrantedFromOrdersPayload(data) {
  if (!data || !data.success) return false;
  if (typeof data.subscriptionAccess?.granted === "boolean") {
    return data.subscriptionAccess.granted;
  }
  const list = Array.isArray(data.orders) ? data.orders : [];
  return list.some(orderGrantsAccess);
}

/**
 * Countdown parts from absolute trial end (ISO string).
 * Call each second from a timer for a live clock.
 */
export function remainingPartsFromTrialEndsAt(trialEndsAtIso, nowMs = Date.now()) {
  const end = new Date(trialEndsAtIso).getTime();
  if (Number.isNaN(end)) {
    return { totalSeconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const ms = end - nowMs;
  if (ms <= 0) {
    return { totalSeconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(ms / 1000);
  let s = totalSeconds;
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return { totalSeconds, days, hours, minutes, seconds, expired: false };
}
