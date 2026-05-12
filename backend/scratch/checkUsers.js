const mysql = require("mysql2/promise");
require("dotenv").config();

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    const [rows] = await connection.execute("SELECT id, email, role, is_active FROM users");
    console.log("Users:", rows);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await connection.end();
  }
}

run();
