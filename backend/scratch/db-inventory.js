const prisma = require('../src/config/prisma');

async function getInventory() {
  try {
    const users = await prisma.users.findMany();
    console.log('Users in database:', users);
  } catch (error) {
    console.error('Inventory check failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getInventory();
