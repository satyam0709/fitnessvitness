const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
require("dotenv").config();

async function createAdmin() {
  const email = "iamsatyamsingh91@gmail.com";
  const plainPassword = "12345678";

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "crm_local",
  });

  try {
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    
    // Check if user already exists
    const [rows] = await conn.execute("SELECT id FROM users WHERE email = ?", [email]);
    
    if (rows.length > 0) {
      // Update existing user
      await conn.execute(
        "UPDATE users SET password_hash = ?, role = 'owner', is_active = 1 WHERE email = ?",
        [passwordHash, email]
      );
      console.log(`Updated existing user ${email} to admin with new password.`);
    } else {
      // Insert new user
      await conn.execute(
        `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
         VALUES (?, ?, ?, 'owner', 1, 1)`,
        [email, passwordHash, 'Satyam Singh']
      );
      console.log(`Created new admin user ${email}.`);
    }
  } catch (error) {
    console.error("Error creating admin:", error);
  } finally {
    await conn.end();
  }
}

createAdmin();
