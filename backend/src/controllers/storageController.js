const prisma = require("../config/prisma");

async function getStorage(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });

    const rows = await prisma.file_attachments.findMany({
      where: { user_id: meId },
      include: {
        leads: { select: { name: true } },
      },
      orderBy: { created_at: "desc" },
    });

    const files = rows.map(({ leads, ...fa }) => ({
      ...fa,
      lead_name: leads?.name ?? null,
    }));

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
