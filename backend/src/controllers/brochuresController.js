const fs = require("fs");
const {
  listBrochures,
  createBrochure,
  updateBrochure,
  deleteBrochure,
  getBrochureFile,
} = require("../services/brochuresService");
const { emitBrochuresChanged, emitStorageChanged } = require("../realtime/meetingsRealtime");

async function getBrochures(req, res) {
  try {
    const type = req.query?.type;
    const brochures = await listBrochures(type || null);
    res.json({ success: true, brochures });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function postBrochure(req, res) {
  try {
    const row = await createBrochure({
      name: req.body?.name,
      type: req.body?.type,
      file: req.file,
    });
    emitBrochuresChanged({ action: "create", id: row.id });
    if (req.file) emitStorageChanged({ action: "brochure_upload", id: row.id });
    res.json({ success: true, brochure: row });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function putBrochure(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await updateBrochure(id, {
      name: req.body?.name,
      type: req.body?.type,
      file: req.file,
    });
    emitBrochuresChanged({ action: "update", id: row.id });
    if (req.file) emitStorageChanged({ action: "brochure_upload", id: row.id });
    res.json({ success: true, brochure: row });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function removeBrochure(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    await deleteBrochure(id);
    emitBrochuresChanged({ action: "delete", id });
    emitStorageChanged({ action: "brochure_delete", id });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function downloadBrochure(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const file = await getBrochureFile(id);
    if (!fs.existsSync(file.abs)) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.fileName)}"`);
    fs.createReadStream(file.abs).pipe(res);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getBrochures,
  postBrochure,
  putBrochure,
  removeBrochure,
  downloadBrochure,
};
