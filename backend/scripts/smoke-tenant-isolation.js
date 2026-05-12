require("dotenv").config();

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "");
const TOKEN_A = process.env.SMOKE_TENANT_A_TOKEN || "";
const TOKEN_B = process.env.SMOKE_TENANT_B_TOKEN || "";

async function callApi(path, token) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  if (!TOKEN_A || !TOKEN_B) {
    console.error("Set SMOKE_TENANT_A_TOKEN and SMOKE_TENANT_B_TOKEN.");
    process.exit(1);
  }
  const [aLeads, bLeads] = await Promise.all([
    callApi("/crm/leads", TOKEN_A),
    callApi("/crm/leads", TOKEN_B),
  ]);
  if (aLeads.status !== 200 || bLeads.status !== 200) {
    console.error("Failed to fetch leads for one of the tenants.", { a: aLeads.status, b: bLeads.status });
    process.exit(1);
  }
  const aIds = new Set((aLeads.body?.data || []).map((x) => Number(x.id)).filter(Boolean));
  const bIds = new Set((bLeads.body?.data || []).map((x) => Number(x.id)).filter(Boolean));
  const overlaps = [...aIds].filter((id) => bIds.has(id));
  if (overlaps.length) {
    console.error("Tenant isolation FAILED. Shared lead IDs detected:", overlaps.slice(0, 20));
    process.exit(1);
  }
  console.log("Tenant isolation OK: no overlapping lead IDs between tenant A and tenant B.");
}

main().catch((err) => {
  console.error("Tenant isolation smoke failed:", err);
  process.exit(1);
});

