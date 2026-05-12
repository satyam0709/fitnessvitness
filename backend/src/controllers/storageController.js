const { pool } = require("../config/database");

async function getStorage(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });

    const [files] = await pool.execute(
      `SELECT fa.*, l.name as lead_name
       FROM file_attachments fa
       LEFT JOIN leads l ON l.id = fa.lead_id
       WHERE fa.user_id = ?
       ORDER BY fa.created_at DESC`,
      [meId]
    );

    const totalBytes = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const usedMb = +(totalBytes / (1024 * 1024)).toFixed(2);

    res.json({
      success: true,
      usage: { used_mb: usedMb, total_mb: 1024 },
      files,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getStorage };
