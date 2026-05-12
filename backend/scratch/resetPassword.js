const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
require("dotenv").config();

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    const hash = await bcrypt.hash("password123", 12);
    await connection.execute("UPDATE users SET password_hash = ? WHERE email = ?", [hash, 'owner@example.com']);
    console.log("Password reset successful for owner@example.com to 'password123'");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await connection.end();
  }
}

run();
