const subscriptionCache = new Map();

const CACHE_TTL_MS = 60 * 1000; // 1 minute

function getSubscription(tenantId) {
  if (!tenantId) return null;
  const entry = subscriptionCache.get(tenantId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    subscriptionCache.delete(tenantId);
    return null;
  }
  return entry.data;
}

function setSubscription(tenantId, data) {
  if (!tenantId) return;
  subscriptionCache.set(tenantId, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function delSubscription(tenantId) {
  if (!tenantId) return;
  subscriptionCache.delete(tenantId);
}

module.exports = {
  getSubscription,
  setSubscription,
  delSubscription,
};