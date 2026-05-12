const { getMainPool } = require("../config/database");

/**
 * @param {import("express").Request} _req
 */
function getCrmPoolFromRequest(_req) {
  return getMainPool();
}

module.exports = {
  getCrmPoolFromRequest,
  getMainPool,
};