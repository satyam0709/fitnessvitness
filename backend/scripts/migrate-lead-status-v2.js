#!/usr/bin/env node
/**
 * One-time backfill: first_name/last_name, status_v2, last_touched_at
 * Run: node backend/scripts/migrate-lead-status-v2.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../src/config/database");
const { ensureCrmSchemaCompat } = require("../src/utils/ensureCrmSchemaCompat");
const { legacyToV2 } = require("../src/utils/leadStatusMap");

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

async function main() {
  await ensureCrmSchemaCompat(pool);

  const [rows] = await pool.execute(
    "SELECT id, name, status, status_v2, first_name, last_name, last_touched_at, updated_at FROM leads"
  );

  let updated = 0;
  for (const row of rows) {
    const { first_name, last_name } = splitName(row.name);
    const statusV2 = row.status_v2 || legacyToV2(row.status);
    const touched = row.last_touched_at || row.updated_at;

    const needsUpdate =
      !row.first_name ||
      !row.last_name ||
      !row.status_v2 ||
      !row.last_touched_at;

    if (!needsUpdate) continue;

    await pool.execute(
      `UPDATE leads SET
         first_name = COALESCE(first_name, ?),
         last_name = COALESCE(last_name, ?),
         status_v2 = COALESCE(status_v2, ?),
         last_touched_at = COALESCE(last_touched_at, ?)
       WHERE id = ?`,
      [first_name, last_name, statusV2, touched, row.id]
    );
    updated++;
  }

  console.log(`migrate-lead-status-v2: processed ${rows.length} leads, updated ${updated}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
