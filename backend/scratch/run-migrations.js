const { ensureSchema } = require('../src/config/ensureSchema');
const { mainPool } = require('../src/config/database');

async function run() {
  try {
    console.log('Running ensureSchema...');
    await ensureSchema();
    console.log('Migration finished successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await mainPool.end();
  }
}

run();
