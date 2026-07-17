const { PrismaClient, Prisma } = require('./src/generated/prisma');
const base = new PrismaClient();
const p = base.$extends({
  query: {
    $allOperations({ operation, args, query }) {
      console.log('Operation:', operation);
      console.log('Args type:', typeof args);
      console.log('Is Array?', Array.isArray(args));
      console.log('Args:', args);
      if (args && typeof args === 'object' && args.constructor) {
          console.log('Constructor name:', args.constructor.name);
      }
      return Promise.resolve([]);
    }
  }
});
p.$queryRaw`SELECT 1 as result`.catch(() => {});
