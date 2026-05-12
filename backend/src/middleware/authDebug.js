// backend/src/middleware/authDebug.js
// No-op debug logger. Replace body with console.debug() calls if needed during dev.
function authDebug(_label, _req, _data) {}
module.exports = { authDebug };