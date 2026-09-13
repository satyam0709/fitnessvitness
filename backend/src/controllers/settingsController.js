const path = require("path");
const multer = require("multer");
const prisma = require("../config/prisma");
const { emitInvoicesChanged, emitStorageChanged } = require("../realtime/meetingsRealtime");
const {
  getWebSettings,
  updateWebSettings,
  resetInvoiceStart,
  ensureUploadDir,
  resolveWebAsset,
} = require("../services/webSettingsService");

function computeInvoiceSettingsComplete(row) {
  if (!row) return false;
  const company = String(row.company_name || "").trim();
  const bank = String(row.invoice_bank_name || "").trim();
  const acc = String(row.invoice_account_no || "").trim();
  const ifsc = String(row.invoice_ifsc || "").trim();
  return company.length > 0 && bank.length > 0 && acc.length > 0 && ifsc.length > 0;
}

async function getCompanySettings(_req, res) {
  try {
    const pack = await getWebSettings();
    const data = pack.data;
    res.json({
      success: true,
      data,
      invoiceSettingsComplete: computeInvoiceSettingsComplete(data),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateCompanySettings(req, res) {
  try {
    const {
      company_name, website, phone, email, address,
      city, state, country, gst_number, pan_number,
      invoice_bank_name, invoice_account_no, invoice_ifsc,
      invoice_currency, invoice_gst_mode,
    } = req.body;

    const payload = {
      company_name: company_name || null,
      website: website || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      city: city || null,
      state: state || null,
      country: country || "India",
      gst_number: gst_number || null,
      pan_number: pan_number || null,
      invoice_bank_name: invoice_bank_name || null,
      invoice_account_no: invoice_account_no || null,
      invoice_ifsc: invoice_ifsc || null,
      invoice_currency: invoice_currency || "INR",
      invoice_gst_mode: invoice_gst_mode || "none",
      updated_at: new Date(),
    };

    await prisma.company_settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...payload },
      update: payload,
    });

    emitInvoicesChanged({ reason: "company_settings_updated" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getWebSettingsHandler(_req, res) {
  try {
    const pack = await getWebSettings();
    res.json({
      success: true,
      ...pack,
      invoiceSettingsComplete: computeInvoiceSettingsComplete(pack.data),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function putWebSettingsHandler(req, res) {
  try {
    const pack = await updateWebSettings(req.body || {});
    emitInvoicesChanged({ reason: "web_settings_updated" });
    res.json({ success: true, ...pack });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function resetInvoiceStartHandler(req, res) {
  try {
    const pack = await resetInvoiceStart(req.body?.start || req.body?.invoice_start_no);
    emitInvoicesChanged({ reason: "invoice_start_reset" });
    res.json({ success: true, ...pack });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".png";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only image files allowed"));
  },
});

function uploadLogoMiddleware(req, res, next) {
  upload.single("logo")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

function uploadSignatureMiddleware(req, res, next) {
  upload.single("signature")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

async function uploadLogoHandler(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "logo file required" });
    const pack = await updateWebSettings({ logo_path: req.file.filename });
    emitInvoicesChanged({ action: "logo" });
    emitStorageChanged({ action: "logo" });
    res.json({ success: true, ...pack });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function uploadSignatureHandler(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "signature file required" });
    const pack = await updateWebSettings({ invoice_signature_path: req.file.filename });
    emitInvoicesChanged({ action: "signature" });
    emitStorageChanged({ action: "signature" });
    res.json({ success: true, ...pack });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getWebAssetHandler(req, res) {
  try {
    const abs = resolveWebAsset(req.params.file);
    if (!abs) return res.status(404).json({ success: false, message: "Not found" });
    return res.sendFile(abs);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getIntegrations(_req, res) {
  try {
    const integrations = await prisma.integrations.findMany({
      orderBy: { key: "asc" },
    });
    res.json({ success: true, integrations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleIntegration(req, res) {
  try {
    const { key } = req.params;
    const existing = await prisma.integrations.findUnique({
      where: { key: String(key) },
      select: { key: true, is_active: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    const updated = await prisma.integrations.update({
      where: { key: String(key) },
      data: { is_active: !existing.is_active },
      select: { is_active: true },
    });

    res.json({ success: true, is_active: !!updated.is_active });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getCompanySettings,
  updateCompanySettings,
  getIntegrations,
  toggleIntegration,
  getWebSettingsHandler,
  putWebSettingsHandler,
  resetInvoiceStartHandler,
  uploadLogoMiddleware,
  uploadSignatureMiddleware,
  uploadLogoHandler,
  uploadSignatureHandler,
  getWebAssetHandler,
};
