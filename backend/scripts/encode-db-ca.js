/**
 * Encode Aiven CA certificate for Render env var DB_SSL_CA.
 * Usage: node scripts/encode-db-ca.js path/to/ca.pem
 * Paste the printed line into Render → DB_SSL_CA
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "..", "certs", "ca.pem");
if (!fs.existsSync(file)) {
  console.error("File not found:", file);
  console.error("Download CA from Aiven → Connection info → CA certificate → save as backend/certs/ca.pem");
  process.exit(1);
}
const b64 = fs.readFileSync(file).toString("base64");
console.log(b64);
