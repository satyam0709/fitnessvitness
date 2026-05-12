const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function main() {
  const pool = mysql.createPool({
    host: 'mysql-2cf0b539-iamsatyamsingh91-8dd6.e.aivencloud.com',
    port: 16900,
    user: 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: 'defaultdb',
  });

  try {
    const hash = await bcrypt.hash('RNDTECH@123', 12);
    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [hash, 'iamsatyamsingh91@gmail.com']
    );
    console.log(`Updated ${result.affectedRows} rows. Password for iamsatyamsingh91@gmail.com is now RNDTECH@123`);
  } catch(e) {
    console.error("DB Error:", e);
  } finally {
    pool.end();
  }
}
main();
