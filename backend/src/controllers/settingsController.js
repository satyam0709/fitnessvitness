const { pool } = require("../config/database");
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
    const [rows] = await pool.execute("SELECT * FROM company_settings WHERE id = 1 LIMIT 1");
    const data = rows[0] || null;
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

    await pool.execute(
      `INSERT INTO company_settings
         (id, company_name, website, phone, email, address, city, state, country, gst_number, pan_number,
          invoice_bank_name, invoice_account_no, invoice_ifsc, invoice_currency, invoice_gst_mode)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         company_name=VALUES(company_name), website=VALUES(website), phone=VALUES(phone),
         email=VALUES(email), address=VALUES(address), city=VALUES(city),
         state=VALUES(state), country=VALUES(country),
         gst_number=VALUES(gst_number), pan_number=VALUES(pan_number),
         invoice_bank_name=VALUES(invoice_bank_name),
         invoice_account_no=VALUES(invoice_account_no),
         invoice_ifsc=VALUES(invoice_ifsc),
         invoice_currency=VALUES(invoice_currency),
         invoice_gst_mode=VALUES(invoice_gst_mode)`,
      [
        company_name || null, website || null, phone || null, email || null,
        address || null, city || null, state || null, country || "India",
        gst_number || null, pan_number || null,
        invoice_bank_name || null,
        invoice_account_no || null,
        invoice_ifsc || null,
        invoice_currency || "INR",
        invoice_gst_mode || "none",
      ]
    );
    emitInvoicesChanged({ reason: "company_settings_updated" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── Integrations ─────────────────────────────────────────────

async function getIntegrations(req, res) {
  try {
    const [rows] = await pool.execute("SELECT * FROM integrations ORDER BY `key` ASC");
    res.json({ success: true, integrations: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleIntegration(req, res) {
  try {
    const { key } = req.params;
    await pool.execute(
      "UPDATE integrations SET is_active = NOT is_active WHERE `key` = ?",
      [key]
    );
    const [[row]] = await pool.execute(
      "SELECT is_active FROM integrations WHERE `key` = ?", [key]
    );
    res.json({ success: true, is_active: !!row?.is_active });
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