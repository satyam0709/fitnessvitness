const { pool } = require("../config/prismaPool");

/**
 * @param {import("express").Request} _req
 */
function getCrmPoolFromRequest(_req) {
  return pool;
}

function getMainPool() {
  return pool;
}

module.exports = {
  getCrmPoolFromRequest,
  getMainPool,
};
