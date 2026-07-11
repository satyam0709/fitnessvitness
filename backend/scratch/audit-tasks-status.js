const { mainPool } = require('../src/config/database');

async function test() {
  try {
    const [rows] = await mainPool.execute('SELECT DISTINCT status, COUNT(*) AS count FROM tasks GROUP BY status');
    console.log('Task Status Audit Results:');
    console.log(rows);
  } catch (err) {
    console.error('Error auditing tasks status:', err.message);
  } finally {
    await mainPool.end();
  }
}

test();
