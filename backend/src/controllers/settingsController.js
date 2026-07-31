const prisma = require("../config/prisma");
const { emitInvoicesChanged } = require("../realtime/meetingsRealtime");

// ── Company Settings ─────────────────────────────────────────

function computeInvoiceSettingsComplete(row) {
  if (!row) return false;
  const company = String(row.company_name || "").trim();
  const bank = String(row.invoice_bank_name || "").trim();
  const acc = String(row.invoice_account_no || "").trim();
  const ifsc = String(row.invoice_ifsc || "").trim();
  return company.length > 0 && bank.length > 0 && acc.length > 0 && ifsc.length > 0;
}

async function getCompanySettings(req, res) {
  try {
    const data = await prisma.company_settings.findUnique({ where: { id: 1 } });
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

// ── Integrations ─────────────────────────────────────────────

async function getIntegrations(req, res) {
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
};
