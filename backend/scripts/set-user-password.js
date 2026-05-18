/**
 * Set or create a CRM login user on the database in backend/.env
 *
 * PowerShell:
 *   $env:SET_USER_EMAIL="iamsatyamsingh91@gmail.com"
 *   $env:SET_USER_PASSWORD="YourNewPassword123!"
 *   node scripts/set-user-password.js
 */
require("dotenv").config();
const { pool } = require("../src/config/database");
const { hashPassword } = require("../src/services/authService");

const email = String(process.env.SET_USER_EMAIL || process.argv[2] || "")
  .trim()
  .toLowerCase();
const password = process.env.SET_USER_PASSWORD || process.argv[3];
const firstName = process.env.SET_USER_FIRST_NAME || "Satyam";
const lastName = process.env.SET_USER_LAST_NAME || "Singh";
const role = process.env.SET_USER_ROLE || "owner";

if (!email || !password) {
  console.error(`
Usage:
  SET_USER_EMAIL=you@example.com SET_USER_PASSWORD=Secret123! node scripts/set-user-password.js

Optional:
  SET_USER_FIRST_NAME=Satyam
  SET_USER_LAST_NAME=Singh
  SET_USER_ROLE=admin   (use admin on Aiven if "owner" fails)
`);
  process.exit(1);
}

async function columnSet(table) {
  const [cols] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(cols.map((c) => c.COLUMN_NAME));
}

async function main() {
  const cols = await columnSet("users");
  if (!cols.size) {
    throw new Error("Table users does not exist. Run ensureSchema / import dump first.");
  }

  const hash = await hashPassword(password);

  const [upd] = await pool.execute(
    `UPDATE users SET password_hash = ?, is_active = 1 WHERE email = ?`,
    [hash, email]
  );

  if (cols.has("email_verified")) {
    await pool.execute(`UPDATE users SET email_verified = 1 WHERE email = ?`, [email]);
  }

  if (upd.affectedRows > 0) {
    console.log(`Updated password for ${email}`);
    console.log(`Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    process.exit(0);
  }

  const fields = ["email", "password_hash"];
  const values = [email, hash];

  if (cols.has("first_name")) {
    fields.push("first_name");
    values.push(firstName);
  }
  if (cols.has("last_name")) {
    fields.push("last_name");
    values.push(lastName);
  }
  if (cols.has("full_name")) {
    fields.push("full_name");
    values.push(`${firstName} ${lastName}`.trim());
  }
  if (cols.has("role")) {
    fields.push("role");
    values.push(role);
  }
  if (cols.has("is_active")) {
    fields.push("is_active");
    values.push(1);
  }
  if (cols.has("email_verified")) {
    fields.push("email_verified");
    values.push(1);
  }
  if (cols.has("is_platform_admin")) {
    fields.push("is_platform_admin");
    values.push(1);
  }

  const placeholders = fields.map(() => "?").join(", ");
  await pool.execute(
    `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders})`,
    values
  );

  console.log(`Created user ${email} with role "${role}"`);
  console.log(`Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log("You can now log in with this email and the password you set.");
}

main()
  .catch((e) => {
    console.error("Failed:", e.message);
    if (e.message.includes("Data truncated") && role !== "admin") {
      console.error('Tip: run again with SET_USER_ROLE=admin');
    }
    process.exit(1);
  })
  .finally(() => pool.end());
