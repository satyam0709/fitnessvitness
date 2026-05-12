const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "src");
const TARGET_DIRS = ["controllers", "routes", "services"];
const TENANT_TABLES = [
  "leads",
  "tasks",
  "reminders",
  "meetings",
  "notes",
  "customers",
  "invoices",
  "crm_todos",
  "contacts",
];

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".js")) out.push(p);
  }
  return out;
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function isLikelyUnsafeSql(sql) {
  const lower = sql.toLowerCase();
  const touchesTenantTable = TENANT_TABLES.some((t) =>
    new RegExp(`\\b(from|join|update|into|delete\\s+from)\\s+\\\`?${t}\\\`?\\b`).test(lower)
  );
  if (!touchesTenantTable) return false;
  if (lower.includes("tenant_id")) return false;
  return true;
}

function extractSqlStrings(content) {
  const regex = /pool\.(?:execute|query)\s*\(\s*`([\s\S]*?)`/g;
  const out = [];
  let m;
  while ((m = regex.exec(content))) {
    out.push({ sql: m[1], index: m.index });
  }
  return out;
}

function main() {
  const files = TARGET_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const sqls = extractSqlStrings(content);
    for (const item of sqls) {
      if (!isLikelyUnsafeSql(item.sql)) continue;
      findings.push({
        file: path.relative(path.resolve(__dirname, ".."), file).replace(/\\/g, "/"),
        line: lineNumberAt(content, item.index),
        snippet: item.sql.trim().split("\n").slice(0, 3).join(" ").slice(0, 220),
      });
    }
  }

  if (!findings.length) {
    console.log("Tenant SQL audit passed: no obvious missing tenant_id filters detected.");
    return;
  }

  console.log(`Tenant SQL audit found ${findings.length} potential issues:\n`);
  for (const f of findings) {
    console.log(`- ${f.file}:${f.line}`);
    console.log(`  ${f.snippet}`);
  }
  process.exitCode = 1;
}

main();

