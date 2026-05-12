/**
 * Legacy compatibility stubs (Clerk removed). Prefer `authController` + `/api/auth/*`.
 */
function signup(_req, res) {
  return res.status(410).json({
    success: false,
    message: "Use POST /api/auth/signup for account creation.",
  });
}

function login(_req, res) {
  return res.status(410).json({
    success: false,
    message: "Use POST /api/auth/login for sign-in.",
  });
}

function logout(_req, res) {
  return res.status(410).json({
    success: false,
    message: "Use POST /api/auth/logout.",
  });
}

function refresh(_req, res) {
  return res.status(410).json({
    success: false,
    message: "Use POST /api/auth/refresh.",
  });
}

module.exports = { signup, login, logout, refresh };
