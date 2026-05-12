const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: 'mysql-2cf0b539-iamsatyamsingh91-8dd6.e.aivencloud.com',
    port: 16900,
    user: 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: 'defaultdb',
  });

  try {
    const [rows] = await pool.execute('SELECT id, email, password_hash FROM users WHERE email = ?', ['iamsatyamsingh91@gmail.com']);
    console.log("DB Result:", rows);
    
    // Let's also check column schema
    const [cols] = await pool.execute('DESCRIBE users');
    console.log("Columns:", cols.map(c => c.Field).join(', '));
  } catch(e) {
    console.error("DB Error:", e);
  } finally {
    pool.end();
  }
}
main();
