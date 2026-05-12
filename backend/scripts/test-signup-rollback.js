/**
 * Integration smoke:
 * - attempts signup with an already-used slug (expects 409),
 * - verifies no orphan user row was created for that email.
 *
 * Requires backend API running and DB connectivity.
 */
require("dotenv").config();

const crypto = require("crypto");
const { mainPool } = require("../src/config/database");

function apiBase() {
  return String(process.env.API_URL || "http://localhost:5000")
    .replace(/\/+$/, "")
    .concat("/api");
}

async function run() {
  const slug = String(process.env.TEST_EXISTING_TENANT_SLUG || "").trim().toLowerCase();
  if (!slug) {
    throw new Error("Set TEST_EXISTING_TENANT_SLUG to an existing tenant slug/subdomain");
  }

  const email = `rollback-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const body = {
    name: "Rollback Check",
    company_name: "Rollback Check Company",
    company_slug: slug,
    email,
    password: "RollbackCheck123!",
  };

  const res = await fetch(`${apiBase()}/auth/register-company`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status !== 409) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected 409 for duplicate slug, got ${res.status}. Body: ${text.slice(0, 250)}`);
  }

  const [users] = await mainPool.execute("SELECT id, tenant_id FROM users WHERE LOWER(email) = LOWER(?)", [email]);
  if (users.length > 0) {
    throw new Error(
      `Rollback failed: found ${users.length} user row(s) for rejected signup email ${email} (ids: ${users
        .map((u) => u.id)
        .join(",")})`
    );
  }

  console.log("test-signup-rollback: ok (duplicate slug rejected, no orphan user created)");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("test-signup-rollback: failed:", err.message || err);
    process.exit(1);
  });
