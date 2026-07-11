const { mainPool } = require('../src/config/database');

async function test() {
  try {
    const [rows] = await mainPool.execute('SELECT * FROM contacts c WHERE c.tenant_id = ? LIMIT 1', [1]);
    console.log('Success:', rows);
  } catch (err) {
    console.error('Error querying contacts with tenant_id:', err.message);
  } finally {
    await mainPool.end();
  }
}

test();
