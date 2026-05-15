const { pool } = require("../config/database");
const { emitAdminChanged, emitNotesChanged } = require("../realtime/meetingsRealtime");

/** Safe substring for SQL LIKE (default MySQL escape `\`). */
function likeContains(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const esc = t.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${esc}%`;
}

async function getNotes(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const userIntId = req.user.id;

    const rawLimit = req.query.limit;
    const paginated =
      rawLimit !== undefined &&
      rawLimit !== "" &&
      String(rawLimit).toLowerCase() !== "all";

    const searchPat = likeContains(req.query.search);

    const baseFrom = `FROM notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.is_deleted = 0 AND n.created_by = ?`;
    const searchSql = searchPat
      ? ` AND (n.content LIKE ? OR n.title LIKE ? OR l.name LIKE ?)`
      : "";
    const searchParams = searchPat ? [searchPat, searchPat, searchPat] : [];

    if (!paginated) {
      const [rows] = await pool.execute(
        `SELECT n.*, l.name as lead_name
         ${baseFrom}
         ${searchSql}
         ORDER BY n.created_at DESC`,
        [userIntId, ...searchParams]
      );
      return res.json({
        success: true,
        notes: rows,
        total: rows.length,
        page: 1,
        limit: null,
      });
    }

    const limit = Math.min(100, Math.max(1, parseInt(String(rawLimit), 10) || 10));
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const offset = (page - 1) * limit;
    const lim = Number.isFinite(limit) ? Math.floor(limit) : 10;
    const off = Number.isFinite(offset) ? Math.floor(offset) : 0;

    const [[{ total: totalRaw }]] = await pool.execute(
      `SELECT COUNT(*) as total ${baseFrom} ${searchSql}`,
      [userIntId, ...searchParams]
    );
    const total = Number(totalRaw) || 0;

    const [rows] = await pool.execute(
      `SELECT n.*, l.name as lead_name
       ${baseFrom}
       ${searchSql}
       ORDER BY n.created_at DESC
       LIMIT ${lim} OFFSET ${off}`,
      [userIntId, ...searchParams]
    );

    res.json({
      success: true,
      notes: rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createNote(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const userIntId = req.user.id;

    const { title, content, lead_id } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: "Content is required" });
    }

    const [result] = await pool.execute(
      "INSERT INTO notes (created_by, title, content, lead_id) VALUES (?, ?, ?, ?)",
      [userIntId, title || null, content, lead_id || null]
    );
    const [[created]] = await pool.execute(
      `SELECT n.*, l.name as lead_name
       FROM notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.id = ? AND n.is_deleted = 0`,
      [result.insertId]
    );
    emitNotesChanged({ scope: "notes", action: "create", id: result.insertId });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "create" });
    res.json({ success: true, id: result.insertId, data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateNote(req, res) {
  try {
    const noteId = Number(req.params.id);
    if (!noteId) return res.status(400).json({ success: false, message: "Invalid note id" });

    const userIntId = req.user?.id;
    if (!userIntId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [[existing]] = await pool.execute(
      "SELECT id, created_by, title, content FROM notes WHERE id = ? AND is_deleted = 0",
      [noteId]
    );
    if (!existing) return res.status(404).json({ success: false, message: "Note not found" });
    if (existing.created_by !== userIntId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const { title, content } = req.body;
    const nextTitle =
      title !== undefined
        ? title == null || String(title).trim() === ""
          ? null
          : String(title).trim().slice(0, 200)
        : existing.title;
    const nextContent =
      content !== undefined ? String(content).trim() : String(existing.content || "");
    if (!nextContent.trim()) {
      return res.status(400).json({ success: false, message: "Content cannot be empty" });
    }

    await pool.execute(
      "UPDATE notes SET title = ?, content = ?, updated_at = NOW() WHERE id = ?",
      [nextTitle, nextContent, noteId]
    );
    const [[updated]] = await pool.execute(
      `SELECT n.*, l.name as lead_name
       FROM notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.id = ? AND n.is_deleted = 0`,
      [noteId]
    );
    emitNotesChanged({ scope: "notes", action: "update", id: noteId });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "update" });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteNote(req, res) {
  try {
    const noteId = Number(req.params.id);
    if (!noteId) return res.status(400).json({ success: false, message: "Invalid note id" });

    const userIntId = req.user?.id;
    if (!userIntId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [[row]] = await pool.execute(
      "SELECT id, created_by FROM notes WHERE id = ? AND is_deleted = 0",
      [noteId]
    );
    if (!row) return res.status(404).json({ success: false, message: "Note not found" });
    if (row.created_by !== userIntId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    await pool.execute(
      "UPDATE notes SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND is_deleted = 0",
      [noteId]
    );
    emitNotesChanged({ scope: "notes", action: "delete", id: noteId });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "delete" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getNotes, createNote, updateNote, deleteNote };
