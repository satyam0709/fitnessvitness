const { escapeHtml } = require("./emailTheme");
const { amountInWords, upiQrDataUri, fileToDataUri } = require("./invoiceDocumentHtml");

const BRAND = "#8bc34a";

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function fmtDate(raw) {
  const s = String(raw || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}-${mm}-${d.getFullYear()}`;
    }
  } catch {
    /* ignore */
  }
  return s || "—";
}

function safeColor(c) {
  const s = String(c || "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return BRAND;
}

function moneyLabel(currency, value) {
  const n = money(value).toFixed(2);
  if (String(currency || "INR").toUpperCase() === "INR") return `₹${n}`;
  return `${currency} ${n}`;
}

function companyAddress(s) {
  if (!s) return "";
  return [s.address, s.city, s.state, s.country, s.postal_code]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");
}

function gstPack(settings, gstMode) {
  if (!settings) return {};
  return gstMode === "none" ? settings.invoice_nongst || {} : settings.invoice_gst || {};
}

function flattenQuoteGroups(groups) {
  if (!Array.isArray(groups)) return { items: [], meta: {} };
  const items = [];
  const meta = {};
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    if (g.gst_mode) meta.gst_mode = g.gst_mode;
    if (g.customer_email) meta.customer_email = g.customer_email;
    if (g.customer_phone) meta.customer_phone = g.customer_phone;
    if (g.company_name) meta.company_name = g.company_name;
    if (g.customer_address) meta.customer_address = g.customer_address;
    if (g.auto_email) meta.auto_email = !!g.auto_email;
    if (g.auto_whatsapp) meta.auto_whatsapp = !!g.auto_whatsapp;
    if (g.inclusive) meta.inclusive = true;
    if (g.brochure) meta.brochure = true;
    if (g.brochure_id) meta.brochure_id = g.brochure_id;
    for (const i of Array.isArray(g.items) ? g.items : []) {
      items.push({
        ...i,
        cost: i.cost != null ? i.cost : i.price,
        qty: i.qty != null ? i.qty : i.quantity,
      });
    }
  }
  return { items, meta };
}

function lineDiscountAmt(l) {
  const qty = Number(l.qty) || 0;
  const cost = Number(l.cost) || 0;
  const base = money(cost * qty);
  const disc = Number(l.discount) || 0;
  if (l.discount_type === "percent") return money(Math.min(base, (base * disc) / 100));
  return money(Math.min(base, disc));
}

function lineDiscountLabel(currency, l) {
  const disc = Number(l.discount) || 0;
  if (l.discount_type === "percent") return disc ? `${disc}%` : moneyLabel(currency, 0);
  return moneyLabel(currency, disc);
}

function lineAmount(l) {
  if (l.total != null && l.total !== "") return money(l.total);
  if (l.subtotal != null && l.subtotal !== "") return money(l.subtotal);
  return money((Number(l.cost) || 0) * (Number(l.qty) || 0));
}

function termsHtml(terms) {
  const raw = String(terms || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length <= 1) return `<p>${escapeHtml(raw)}</p>`;
  return `<ol>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\d+[.)]\s*/, ""))}</li>`).join("")}</ol>`;
}

async function buildQuotationDocumentHtml({ row, settings }) {
  const s = settings || {};
  const groups = Array.isArray(row.line_items_groups) ? row.line_items_groups : [];
  const { items: lines, meta } = flattenQuoteGroups(groups);
  const gstMode = meta.gst_mode || "none";
  const pack = gstPack(s, gstMode);
  const brand = safeColor(s.theme_color);
  const cur = row.currency || "INR";
  const logo = fileToDataUri(null, s.logo_path);
  const sign = fileToDataUri(null, pack.signature_path || s.invoice_signature_path);
  const addr = companyAddress(s);
  const total = money(row.grand_total != null ? row.grand_total : row.line_total);
  const tax = money(row.total_tax != null ? row.total_tax : 0);
  const discountSum = money(
    row.total_discount != null ? row.total_discount : lines.reduce((a, l) => a + lineDiscountAmt(l), 0)
  );
  const subTotal = money(
    row.sub_total != null
      ? row.sub_total
      : lines.reduce((a, l) => a + money((Number(l.cost) || 0) * (Number(l.qty) || 0)), 0)
  );
  const bankName = String(pack.bank_name || row.bank_name || s.invoice_bank_name || "").trim();
  const accountNo = String(pack.account_no || s.invoice_account_no || "").trim();
  const ifsc = String(pack.ifsc || s.invoice_ifsc || "").trim();
  const hasBank = !!(bankName || accountNo || ifsc);
  const qr = await upiQrDataUri(pack.upi_id, s.company_name, total, row.quotation_no);
  const terms = String(row.terms_description || pack.terms || "").trim();
  const partyPhone = meta.customer_phone || "";
  const partyCompany = meta.company_name || "";
  const partyEmail = meta.customer_email || "";
  const partyAddress = String(meta.customer_address || row.billing_address || "").trim();
  const showTax = gstMode !== "none";

  const lineRows = lines.length
    ? lines
        .map((l, i) => {
          const name = escapeHtml(l.product_name || "");
          const hsn = String(l.hsn || "").trim();
          const nameCell = hsn ? `${name}<div class="muted">HSN ${escapeHtml(hsn)}</div>` : name;
          return `<tr>
            <td>${i + 1}</td>
            <td>${nameCell}</td>
            <td class="num">${escapeHtml(moneyLabel(cur, l.cost))}</td>
            <td class="num">${escapeHtml(String(l.qty ?? ""))}</td>
            <td class="num">${escapeHtml(lineDiscountLabel(cur, l))}</td>
            <td class="num">${escapeHtml(moneyLabel(cur, lineAmount(l)))}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">No line items</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(
    row.quotation_no || "Quotation"
  )}</title>
<style>
:root{--brand:${brand};--text:#1a1a2e;--muted:#5a5f7d;--border:#111;--bg:#fff}
*{box-sizing:border-box}
body{font-family:Segoe UI,Arial,sans-serif;color:var(--text);margin:0;padding:28px 32px;background:#fff}
.toolbar{margin-bottom:16px}
.toolbar button{background:var(--brand);color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:700}
.sheet{max-width:860px;margin:0 auto;border:1px solid var(--border);padding:20px}
.title{text-align:center;color:var(--brand);font-size:26px;font-weight:800;margin:0 0 20px;letter-spacing:.02em}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:18px}
.logo{max-height:72px;max-width:220px;object-fit:contain}
.company{text-align:right;font-size:13px;line-height:1.45}
.company strong{display:block;font-size:16px;margin-bottom:4px}
.muted{color:var(--muted);font-size:12px;margin-top:2px}
.bar{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:18px;border:1px solid #cfcfcf}
.bar .pair{display:grid;grid-template-columns:120px 1fr}
.bar .pair + .pair{border-left:1px solid #cfcfcf}
.bar .lab{background:var(--brand);color:#fff;padding:8px 12px;font-weight:700;font-size:13px;border-right:1px solid #cfcfcf}
.bar .val{padding:8px 12px;font-size:13px;background:#fff}
.to{margin-bottom:18px;font-size:13px;line-height:1.5}
.to h2{margin:0 0 6px;font-size:14px;color:var(--text)}
table.items{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;border:1px solid #cfcfcf}
table.items th,table.items td{border:1px solid #cfcfcf;padding:8px 10px;vertical-align:top}
table.items th{background:var(--brand);color:#fff;font-weight:700;text-align:left}
table.items th.num,table.items td.num{text-align:right;white-space:nowrap}
.bottom{display:grid;grid-template-columns:${hasBank && qr ? "1.2fr auto 1fr" : hasBank || qr ? "1fr 1fr" : "1fr"};border:1px solid #cfcfcf;margin-bottom:16px}
.bottom > div{padding:12px}
.bottom > div + div{border-left:1px solid var(--border)}
.pay h2{margin:0 0 8px;font-size:14px;color:var(--brand)}
.pay p{margin:0 0 4px;font-size:13px}
.qr-wrap{display:flex;align-items:center;justify-content:center}
.qr{width:140px;height:140px;object-fit:contain;border:1px solid var(--border);padding:4px;background:#fff}
.totals table{width:100%;border-collapse:collapse;font-size:13px}
.totals td{border:1px solid var(--border);padding:6px 8px}
.totals td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.totals .due{color:var(--brand);font-weight:800}
.words{background:var(--brand);color:#fff;padding:10px 14px;font-weight:700;font-size:13px;margin-bottom:16px;letter-spacing:.02em;border:1px solid var(--border)}
.foot{display:grid;grid-template-columns:1fr 200px;border:1px solid var(--border);min-height:120px}
.terms{padding:10px 12px;font-size:12px;color:var(--muted);border-right:1px solid var(--border)}
.terms h2{margin:0 0 6px;font-size:14px;color:var(--brand)}
.terms ol{margin:0;padding-left:18px}
.terms p{margin:0}
.sign{padding:10px 12px;text-align:center;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-height:120px}
.sign img{max-height:56px;max-width:160px;object-fit:contain;display:block;margin:0 auto 8px}
.sign span{font-size:12px;color:var(--text)}
@media print{
  .toolbar{display:none}
  body{padding:12px}
}
@media (max-width:700px){
  .head{flex-direction:column}
  .company{text-align:left}
  .bar,.bottom,.foot{grid-template-columns:1fr}
  .bar .pair + .pair,.bottom > div + div,.terms{border-left:none;border-top:1px solid var(--border)}
}
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
<div class="sheet">
  <h1 class="title">Quotation</h1>
  <div class="head">
    <div>${logo ? `<img class="logo" src="${logo}" alt="Logo"/>` : ""}</div>
    <div class="company">
      <strong>${escapeHtml(s.company_name || "Quotation")}</strong>
      ${s.email ? `<div>${escapeHtml(s.email)}</div>` : ""}
      ${s.phone ? `<div>${escapeHtml(s.phone)}</div>` : ""}
      ${addr ? `<div>${escapeHtml(addr)}</div>` : ""}
    </div>
  </div>
  <div class="bar">
    <div class="pair"><div class="lab">Quotation #</div><div class="val">${escapeHtml(row.quotation_no || "—")}</div></div>
    <div class="pair"><div class="lab">Quotation Date</div><div class="val">${escapeHtml(fmtDate(row.quotation_date))}</div></div>
  </div>
  <div class="to">
    <h2>Quote To</h2>
    <div><strong>${escapeHtml(row.name || "—")}</strong></div>
    ${partyCompany ? `<div>${escapeHtml(partyCompany)}</div>` : ""}
    ${partyEmail ? `<div>${escapeHtml(partyEmail)}</div>` : ""}
    ${partyPhone ? `<div>${escapeHtml(partyPhone)}</div>` : ""}
    ${partyAddress ? `<div>${escapeHtml(partyAddress)}</div>` : ""}
  </div>
  <table class="items">
    <thead><tr><th>#</th><th>Product Name</th><th class="num">Cost</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Total Amount</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <div class="bottom">
    ${
      hasBank
        ? `<div class="pay">
      <h2>Payments Details</h2>
        ${bankName ? `<p><strong>Bank Name :</strong> ${escapeHtml(bankName)}</p>` : ""}
        ${accountNo ? `<p><strong>Account No :</strong> ${escapeHtml(accountNo)}</p>` : ""}
        ${ifsc ? `<p><strong>IFSC Code :</strong> ${escapeHtml(ifsc)}</p>` : ""}
    </div>`
        : ""
    }
    ${qr ? `<div class="qr-wrap"><img class="qr" src="${qr}" alt="UPI QR"/></div>` : ""}
    <div class="totals">
      <table>
        <tr><td>Sub Total</td><td>${escapeHtml(moneyLabel(cur, subTotal))}</td></tr>
        <tr><td>Discount</td><td>${escapeHtml(moneyLabel(cur, discountSum))}</td></tr>
        ${showTax ? `<tr><td>Tax</td><td>${escapeHtml(moneyLabel(cur, tax))}</td></tr>` : ""}
        <tr><td class="due">Total</td><td class="due">${escapeHtml(moneyLabel(cur, total))}</td></tr>
      </table>
    </div>
  </div>
  <div class="words">IN WORDS : ${escapeHtml(amountInWords(total))}</div>
  <div class="foot">
    <div class="terms">${terms ? `<h2>Terms &amp; Condition</h2>${termsHtml(terms)}` : ""}</div>
    <div class="sign">
      ${sign ? `<img src="${sign}" alt="Signature"/>` : ""}
      <span>Authorized Signature</span>
    </div>
  </div>
</div>
</body></html>`;
}

module.exports = {
  buildQuotationDocumentHtml,
  flattenQuoteGroups,
};
