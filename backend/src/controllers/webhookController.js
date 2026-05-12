const { mainPool } = require("../config/database");
require("dotenv").config();

/**
 * Legacy Clerk webhook endpoint. Clerk has been removed from this stack; respond consistently
 * so old dashboard URLs do not crash the process.
 */
async function handleClerkWebhook(req, res) {
  return res.status(410).json({
    success: false,
    message: "Clerk webhooks are disabled. This API uses application-managed JWT authentication.",
  });
}

module.exports = { handleClerkWebhook };
