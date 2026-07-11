const prisma = require('../src/config/prisma');
const { Prisma } = require('../src/generated/prisma');

async function testQueryRaw() {
  try {
    const from = new Date('2026-01-01');
    const to = new Date();

    const conditions = [];
    if (from) {
      conditions.push(Prisma.sql`created_at >= ${from}`);
    }
    if (to) {
      conditions.push(Prisma.sql`created_at <= ${to}`);
    }

    const whereSql = conditions.length > 0 ? Prisma.join(conditions, ' AND ') : Prisma.sql`1=1`;

    console.log('Running dynamic raw query...');
    const rows = await prisma.$queryRaw`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(0), 0) AS total_value
      FROM leads
      WHERE ${whereSql}
      GROUP BY status
      ORDER BY count DESC
    `;

    console.log('Query success! Rows:', rows);
  } catch (error) {
    console.error('Query failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testQueryRaw();
