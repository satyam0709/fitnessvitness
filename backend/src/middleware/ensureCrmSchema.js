const { pool } = require("../config/database");
const { ensureCrmSchemaCompat } = require("../utils/ensureCrmSchemaCompat");

let initPromise = null;

function ensureCrmSchemaMiddleware() {
  return async (_req, _res, next) => {
    try {
      if (!initPromise) {
        initPromise = ensureCrmSchemaCompat(pool).catch((err) => {
          initPromise = null;
          throw err;
        });
      }
      await initPromise;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { ensureCrmSchemaMiddleware };
