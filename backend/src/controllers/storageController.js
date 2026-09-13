const fs = require("fs");
const prisma = require("../config/prisma");
const { emitStorageChanged, emitBrochuresChanged } = require("../realtime/meetingsRealtime");
const {
  canonicalUploadUrl,
  resolveDisk,
  fileExtOf,
  mimeOfExt,
  buildStorageOverview,
  deleteOwnedPath,
} = require("../services/storageOverviewService");

function parseFileId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

function streamDiskFile(res, diskPath, { mimeType, fileName, download = false }) {
  if (!diskPath || !fs.existsSync(diskPath)) {
    return res.status(404).json({ success: false, message: "File not found on disk" });
  }
  const stat = fs.statSync(diskPath);
  const safeName = String(fileName || "file").replace(/"/g, "");
  res.setHeader("Content-Type", mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="${safeName}"`
  );
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(diskPath).pipe(res);
}

async function getStorage(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const overview = await buildStorageOverview(meId);
    res.json({ success: true, ...overview });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function downloadStorageByPath(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const canonical = canonicalUploadUrl(req.query.path || req.query.file || "");
    if (!canonical) return res.status(400).json({ success: false, message: "Invalid file path" });

    const overview = await buildStorageOverview(meId);
    const owned = overview.files.find((f) => f.file_url === canonical);
    if (!owned) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    const diskPath = resolveDisk(canonical);
    const download =
      String(req.query.download || "") === "1" || String(req.query.download || "").toLowerCase() === "true";
    return streamDiskFile(res, diskPath, {
      mimeType: owned?.mime_type || mimeOfExt(fileExtOf(canonical)),
      fileName: owned?.file_name || canonical.split("/").pop(),
      download,
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
}

async function getStorageFile(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const fileId = parseFileId(req.params.id);
    if (!fileId) return res.status(400).json({ success: false, message: "Invalid file id" });

    const fa = await prisma.file_attachments.findFirst({
      where: { id: fileId, user_id: meId },
    });
    if (!fa) return res.status(404).json({ success: false, message: "File not found" });

    const diskPath = resolveDisk(fa.file_url);
    return streamDiskFile(res, diskPath, {
      mimeType: fa.mime_type || mimeOfExt(fileExtOf(fa.file_url || "")),
      fileName: fa.file_name,
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteStorageFile(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const fileId = parseFileId(req.params.id);
    if (!fileId) return res.status(400).json({ success: false, message: "Invalid file id" });

    const fa = await prisma.file_attachments.findFirst({
      where: { id: fileId, user_id: meId },
    });
    if (!fa) return res.status(404).json({ success: false, message: "File not found" });
    await deleteOwnedPath(meId, fa.file_url);
    emitStorageChanged({ action: "delete", id: fa.id });
    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function deleteStorageByPath(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const canonical = await deleteOwnedPath(meId, req.query.path || req.query.file || req.body?.path || "");
    emitStorageChanged({ action: "delete", path: canonical });
    emitBrochuresChanged({ action: "storage_delete" });
    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function bulkDeleteStorage(req, res) {
  try {
    const meId = Number(req.user?.id);
    if (!meId) return res.status(401).json({ success: false, message: "Not authenticated" });
    const raw = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const deleted = [];
    const failed = [];
    for (const p of raw) {
      try {
        const canonical = await deleteOwnedPath(meId, p);
        deleted.push(canonical);
      } catch {
        failed.push(p);
      }
    }
    if (deleted.length) {
      emitStorageChanged({ action: "bulk_delete", count: deleted.length });
      emitBrochuresChanged({ action: "storage_delete" });
    }
    res.json({ success: true, deleted: deleted.length, failed });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStorage,
  getStorageFile,
  deleteStorageFile,
  deleteStorageByPath,
  bulkDeleteStorage,
  downloadStorageByPath,
};
