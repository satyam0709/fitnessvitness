const prisma = require('../src/config/prisma');

async function check() {
  try {
    const cols = await prisma.$queryRaw`DESCRIBE meetings`;
    console.log('--- meetings columns ---');
    console.dir(cols, { depth: null });

    const cols2 = await prisma.$queryRaw`DESCRIBE crm_todos`;
    console.log('\n--- crm_todos columns ---');
    console.dir(cols2, { depth: null });
  } catch (err) {
    console.error('Error describing tables:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
