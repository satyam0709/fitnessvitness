const { createClient } = require("redis");

const TTL_SECONDS = 300;
let redisClient = null;
let redisReady = false;
const memory = new Map();

function redisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

async function getRedis() {
  if (!redisEnabled()) return null;
  if (redisClient) return redisClient;
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (err) => {
    redisReady = false;
    console.warn("redis cache error:", err.message);
  });
  await redisClient.connect();
  redisReady = true;
  return redisClient;
}

function key(tenantId) {
  return `sub:${tenantId}`;
}

async function getSubscription(tenantId) {
  if (!tenantId) return null;
  if (redisEnabled()) {
    try {
      const c = await getRedis();
      if (c && redisReady) {
        const raw = await c.get(key(tenantId));
        return raw ? JSON.parse(raw) : null;
      }
    } catch {
      // fallback below
    }
  }
  const item = memory.get(tenantId);
  if (!item || item.expiresAt <= Date.now()) return null;
  return item.value;
}

async function setSubscription(tenantId, value) {
  if (!tenantId) return;
  if (redisEnabled()) {
    try {
      const c = await getRedis();
      if (c && redisReady) {
        await c.setEx(key(tenantId), TTL_SECONDS, JSON.stringify(value));
        return;
      }
    } catch {
      // fallback below
    }
  }
  memory.set(tenantId, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

async function delSubscription(tenantId) {
  if (!tenantId) return;
  if (redisEnabled()) {
    try {
      const c = await getRedis();
      if (c && redisReady) {
        await c.del(key(tenantId));
      }
    } catch {
      // ignore and clear memory too
    }
  }
  memory.delete(tenantId);
}

module.exports = { getSubscription, setSubscription, delSubscription };

