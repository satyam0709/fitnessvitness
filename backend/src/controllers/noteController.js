const prisma = require("../config/prisma");
const { emitAdminChanged, emitNotesChanged } = require("../realtime/meetingsRealtime");

function searchTerm(raw) {
  const t = String(raw || "").trim();
  return t || null;
}

async function attachLeadNames(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const leadIds = [...new Set(list.map((n) => n.lead_id).filter((id) => id != null))];
  const nameById = new Map();
  if (leadIds.length) {
    const leads = await prisma.leads.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, name: true },
    });
    for (const l of leads) nameById.set(l.id, l.name || null);
  }
  return list.map((n) => ({
    ...n,
    lead_name: n.lead_id != null ? nameById.get(n.lead_id) || null : null,
  }));
}

async function buildNotesWhere(userIntId, search) {
  const where = {
    is_deleted: false,
    created_by: userIntId,
  };
  if (!search) return where;

  const leadMatches = await prisma.leads.findMany({
    where: {
      is_deleted: false,
      name: { contains: search },
    },
    select: { id: true },
    take: 200,
  });
  const leadIds = leadMatches.map((l) => l.id);

  where.OR = [
    { content: { contains: search } },
    { title: { contains: search } },
    ...(leadIds.length ? [{ lead_id: { in: leadIds } }] : []),
  ];
  return where;
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

    const search = searchTerm(req.query.search);
    const where = await buildNotesWhere(userIntId, search);

    if (!paginated) {
      const rows = await prisma.notes.findMany({
        where,
        orderBy: { created_at: "desc" },
      });
      const notes = await attachLeadNames(rows);
      return res.json({
        success: true,
        notes,
        total: notes.length,
        page: 1,
        limit: null,
      });
    }

    const limit = Math.min(100, Math.max(1, parseInt(String(rawLimit), 10) || 10));
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const offset = (page - 1) * limit;

    const total = await prisma.notes.count({ where });
    const rows = await prisma.notes.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
    const notes = await attachLeadNames(rows);

    res.json({
      success: true,
      notes,
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

    const created = await prisma.notes.create({
      data: {
        created_by: userIntId,
        title: title || null,
        content,
        lead_id: lead_id ? Number(lead_id) : null,
      },
    });

    const [withLead] = await attachLeadNames([created]);
    emitNotesChanged({ scope: "notes", action: "create", id: created.id });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "create" });
    res.json({ success: true, id: created.id, data: withLead });
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

    const existing = await prisma.notes.findFirst({
      where: { id: noteId, is_deleted: false },
      select: { id: true, created_by: true, title: true, content: true },
    });
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

    await prisma.notes.update({
      where: { id: noteId },
      data: {
        title: nextTitle,
        content: nextContent,
        updated_at: new Date(),
      },
    });

    const updated = await prisma.notes.findFirst({
      where: { id: noteId, is_deleted: false },
    });
    const [withLead] = await attachLeadNames(updated ? [updated] : []);
    emitNotesChanged({ scope: "notes", action: "update", id: noteId });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "update" });
    res.json({ success: true, data: withLead || null });
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

    const row = await prisma.notes.findFirst({
      where: { id: noteId, is_deleted: false },
      select: { id: true, created_by: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Note not found" });
    if (row.created_by !== userIntId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    await prisma.notes.update({
      where: { id: noteId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });
    emitNotesChanged({ scope: "notes", action: "delete", id: noteId });
    emitAdminChanged({ scope: "stats", reason: "notes", action: "delete" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getNotes, createNote, updateNote, deleteNote };
