/**
 * Quick checks for hostname → subdomain (no database).
 */
const { parseSubdomainFromHost } = require("../src/middleware/subdomain");

const base = "365rndcrm.vercel.app";
const cases = [
  ["365rndcrm.vercel.app", null],
  ["acme.365rndcrm.vercel.app", "acme"],
  ["localhost", null],
];
let ok = true;
for (const [host, expect] of cases) {
  const got = parseSubdomainFromHost(host, base);
  if (got !== expect) {
    console.error("FAIL", host, "expected", expect, "got", got);
    ok = false;
  }
}
if (ok) console.log("test-subdomain-routing: ok");
process.exit(ok ? 0 : 1);
