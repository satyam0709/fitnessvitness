require("dotenv").config();

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "");
const DEFAULT_TOKEN = process.env.SMOKE_BEARER_TOKEN || "";
const SUPERADMIN_TOKEN = process.env.SMOKE_SUPERADMIN_TOKEN || "";
const TENANT_ADMIN_TOKEN = process.env.SMOKE_TENANT_ADMIN_TOKEN || "";
const STAFF_TOKEN = process.env.SMOKE_STAFF_TOKEN || "";
const STRICT_MODE = String(process.env.SMOKE_STRICT || "1") === "1";

async function callApi(path, options = {}, token = "") {
  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function logResult(label, result) {
  const suffix = result.ok ? "OK" : `FAIL (${result.status})`;
  console.log(`${label}: ${suffix}`);
  if (!result.ok && result.body) {
    console.log(JSON.stringify(result.body, null, 2));
  }
}

function expectStatus(result, allowedStatuses) {
  return allowedStatuses.includes(result.status);
}

function logExpectation(label, result, allowedStatuses) {
  const ok = expectStatus(result, allowedStatuses);
  const allowed = allowedStatuses.join("|");
  console.log(`${label}: ${ok ? "OK" : `FAIL (${result.status}, expected ${allowed})`}`);
  if (!ok && result.body) {
    console.log(JSON.stringify(result.body, null, 2));
  }
  return ok;
}

async function main() {
  console.log(`Smoke base URL: ${BASE_URL}`);
  console.log(
    DEFAULT_TOKEN
      ? "Using fallback token from SMOKE_BEARER_TOKEN."
      : "No fallback token set; role checks use dedicated env tokens."
  );

  const checks = [];
  checks.push(["PUBLIC GET /health", await callApi("/health"), [200]]);
  checks.push(["PUBLIC GET /packages/catalog", await callApi("/packages/catalog"), [200]]);

  const superToken = SUPERADMIN_TOKEN || DEFAULT_TOKEN;
  const tenantToken = TENANT_ADMIN_TOKEN || DEFAULT_TOKEN;
  const staffToken = STAFF_TOKEN || "";

  if (superToken) {
    checks.push(["SUPERADMIN GET /me", await callApi("/me", {}, superToken), [200]]);
    checks.push([
      "SUPERADMIN GET /superadmin/analytics",
      await callApi("/superadmin/analytics", {}, superToken),
      [200],
    ]);
    checks.push([
      "SUPERADMIN GET /superadmin/tenants",
      await callApi("/superadmin/tenants", {}, superToken),
      [200],
    ]);
  }

  if (tenantToken) {
    checks.push(["TENANT_ADMIN GET /auth/me", await callApi("/auth/me", {}, tenantToken), [200]]);
    checks.push(["TENANT_ADMIN GET /crm/dashboard", await callApi("/crm/dashboard", {}, tenantToken), [200]]);
    checks.push(["TENANT_ADMIN GET /admin/usage", await callApi("/admin/usage", {}, tenantToken), [200]]);
    checks.push([
      "TENANT_ADMIN GET /admin/subscription",
      await callApi("/admin/subscription", {}, tenantToken),
      [200],
    ]);
  }

  if (staffToken) {
    checks.push(["STAFF GET /me", await callApi("/me", {}, staffToken), [200]]);
    checks.push(["STAFF GET /crm/tasks", await callApi("/crm/tasks", {}, staffToken), [200]]);
    checks.push(["STAFF GET /crm/leads", await callApi("/crm/leads", {}, staffToken), [200]]);
  }

  if (STRICT_MODE) {
    if (tenantToken) {
      checks.push([
        "TENANT_ADMIN FORBIDDEN GET /superadmin/analytics",
        await callApi("/superadmin/analytics", {}, tenantToken),
        [403],
      ]);
    }
    if (staffToken) {
      checks.push([
        "STAFF FORBIDDEN GET /superadmin/tenants",
        await callApi("/superadmin/tenants", {}, staffToken),
        [403],
      ]);
      checks.push([
        "STAFF FORBIDDEN GET /admin/usage",
        await callApi("/admin/usage", {}, staffToken),
        [403],
      ]);
    }
    if (superToken) {
      checks.push([
        "SUPERADMIN FORBIDDEN GET /admin/usage",
        await callApi("/admin/usage", {}, superToken),
        [403],
      ]);
    }
  }

  let failed = 0;
  for (const [label, result, expected] of checks) {
    if (!expected || expected.length === 0) {
      logResult(label, result);
      if (!result.ok) failed += 1;
      continue;
    }
    const ok = logExpectation(label, result, expected);
    if (!ok) failed += 1;
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Smoke contract script failed:", err);
  process.exit(1);
});

