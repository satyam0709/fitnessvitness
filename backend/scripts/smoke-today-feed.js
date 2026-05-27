require("dotenv").config();

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "");
const TOKEN =
  process.env.SMOKE_TENANT_ADMIN_TOKEN ||
  process.env.SMOKE_STAFF_TOKEN ||
  process.env.SMOKE_BEARER_TOKEN ||
  "";
const DAYS = Number.parseInt(String(process.env.SMOKE_TODAY_DAYS || "7"), 10) || 7;

function addDaysYmd(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function callApi(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

function keyOf(item) {
  return `${item?.source_type || "unknown"}:${item?.source_id ?? item?.id ?? "na"}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printSources(label, list) {
  const counts = {};
  for (const it of list || []) {
    const k = String(it?.source_type || "unknown");
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(`${label} source counts:`, counts);
}

async function main() {
  console.log(`Today smoke base URL: ${BASE_URL}`);
  if (!TOKEN) {
    throw new Error(
      "Missing auth token. Set one of: SMOKE_TENANT_ADMIN_TOKEN, SMOKE_STAFF_TOKEN, SMOKE_BEARER_TOKEN."
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const future = addDaysYmd(today, DAYS);

  const [todayRes, futureRes] = await Promise.all([
    callApi(`/today?date=${encodeURIComponent(today)}&include_google=1`),
    callApi(`/today?date=${encodeURIComponent(future)}&include_google=1`),
  ]);

  assert(todayRes.ok, `GET /today failed (${todayRes.status})`);
  assert(futureRes.ok, `GET /today future failed (${futureRes.status})`);

  const payload = todayRes.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming : [];

  assert(payload.success === true, "Response success is false");
  assert(Array.isArray(payload.items), "items is not an array");
  assert(Array.isArray(payload.upcoming), "upcoming is not an array");
  assert(typeof payload.summary === "object" && payload.summary != null, "summary missing");

  const todayKeys = new Set(items.map(keyOf));
  const overlap = upcoming.filter((it) => todayKeys.has(keyOf(it)));
  assert(
    overlap.length === 0,
    `Today/upcoming overlap detected (${overlap.length} duplicate keys)`
  );

  const hasCalendarLike = items.some((it) =>
    ["calendar_event", "google_event", "apple_event"].includes(String(it.source_type))
  );
  if (!hasCalendarLike) {
    console.warn(
      "WARN: No calendar/google/apple events in today's items. This can be valid if no events exist."
    );
  }

  printSources("today.items", items);
  printSources("today.upcoming", upcoming);
  console.log(`future date checked: ${future}, status=${futureRes.status}`);
  console.log("Today feed smoke passed.");
}

main().catch((err) => {
  console.error("Today feed smoke failed:", err.message || err);
  process.exit(1);
});

