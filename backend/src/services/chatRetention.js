const { pool } = require("../config/database");

async function runChatRetentionOnce() {
  // Messages older than 60 days are deleted; media after 15 days is stripped.
  // Matches UI notice in the requested chat screen.
  try {
    await pool.execute(
      "UPDATE chat_thread_messages SET attachments_json = NULL WHERE attachments_json IS NOT NULL AND created_at < (NOW() - INTERVAL 15 DAY)"
    );
  } catch (e) {
    // table may not exist yet; ignore
  }
  try {
    await pool.execute(
      "DELETE FROM chat_thread_messages WHERE created_at < (NOW() - INTERVAL 60 DAY)"
    );
  } catch (e) {
    // table may not exist yet; ignore
  }
}

function startChatRetentionLoop() {
  // Run once at boot, then every 6 hours (cheap, keeps DB tidy).
  void runChatRetentionOnce();
  const everyMs = 6 * 60 * 60 * 1000;
  return setInterval(() => void runChatRetentionOnce(), everyMs);
}

module.exports = { runChatRetentionOnce, startChatRetentionLoop };

