/**
 * Legacy pool helpers removed — use prisma from config/prisma.
 */
function getCrmPoolFromRequest() {
  throw new Error("getCrmPoolFromRequest removed — use prisma Client ORM");
}

function getMainPool() {
  throw new Error("getMainPool removed — use prisma Client ORM");
}

module.exports = {
  getCrmPoolFromRequest,
  getMainPool,
};
