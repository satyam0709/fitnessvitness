const fs = require("fs");
const path = require("path");
const { escapeHtml } = require("./emailTheme");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "settings");
const BRAND = "#8bc34a";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function money(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "object") {
    if (typeof v.toNumber === "function") {
      const n = v.toNumber();
      if (Number.isFinite(n)) return Math.round(n * 100) / 100;
    }
    if (typeof v.toString === "function" && v.toString !== Object.prototype.toString) {
      const n = Number(String(v.toString()).replace(/,/g, ""));
      if (Number.isFinite(n)) return Math.round(n * 100) / 100;
    }
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function underHundred(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function underThousand(n) {
  if (n < 100) return underHundred(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return ONES[h] + " Hundred" + (r ? " " + underHundred(r) : "");
}

function amountInWords(amount) {
  const n = money(amount);
  if (n === 0) return "Zero";
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  const parts = [];
  if (crore) parts.push(underThousand(crore) + " Crore");
  if (lakh) parts.push(underThousand(lakh) + " Lakh");
  if (thousand) parts.push(underThousand(thousand) + " Thousand");
  if (rest) parts.push(underThousand(rest));
  let out = parts.join(" ") || "Zero";
  if (paise) out += " and " + underHundred(paise) + " Paise";
  return out;
}

function invoiceTitle(row) {
  const total = money(row.total);
  const paid = money(row.amount_paid);
  const due = row.due_amount != null ? money(row.due_amount) : Math.max(0, money(total - paid));
  if (total <= 0) return "Invoice";
  if (due <= 0 && total > 0) return "Paid Invoice";
  if (paid <= 0) return "Unpaid Invoice";
  const half = money(total / 2);
  if (Math.abs(paid - half) < 0.02) return "Half Paid Invoice";
  return "Invoice";
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

function fileToDataUri(_ignored, storedPath) {
  const file = path.basename(String(storedPath || ""));
  if (!file) return null;
  const abs = path.join(UPLOAD_ROOT, file);
  if (!abs.startsWith(UPLOAD_ROOT) || !fs.existsSync(abs)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".svg"
              ? "image/svg+xml"
              : "image/png";
  try {
    const buf = fs.readFileSync(abs);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
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

function qtyLabel(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q ?? "");
  return n.toFixed(2);
}

function partyAddressFromRow(row) {
  return String(row?.billing_address || row?.customer_address || "").trim();
}

async function upiQrDataUri(upiId, companyName, due, invoiceNumber) {
  const pa = String(upiId || "").trim();
  if (!pa) return null;
  let qrcode;
  try {
    qrcode = require("qrcode");
  } catch {
    return null;
  }
  const params = new URLSearchParams();
  params.set("pa", pa);
  params.set("pn", String(companyName || "Invoice").slice(0, 50));
  params.set("cu", "INR");
  if (due > 0) params.set("am", due.toFixed(2));
  if (invoiceNumber) params.set("tn", String(invoiceNumber).slice(0, 50));
  const payload = `upi://pay?${params.toString()}`;
  try {
    return await qrcode.toDataURL(payload, { margin: 1, width: 160, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

function termsHtml(terms) {
  const raw = String(terms || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length <= 1) return `<p>${escapeHtml(raw)}</p>`;
  return `<ol>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\d+[.)]\s*/, ""))}</li>`).join("")}</ol>`;
}

async function buildInvoiceDocumentHtml({ row, settings }) {
  const s = settings || {};
  const pack = gstPack(s, row.gst_mode);
  const brand = safeColor(s.theme_color);
  const cur = row.currency || "INR";
  const lines = Array.isArray(row.line_items) ? row.line_items : [];
  const title = invoiceTitle(row);
  const logo = fileToDataUri(null, s.logo_path);
  const logoFile = path.basename(String(s.logo_path || ""));
  const signFile = path.basename(String(pack.signature_path || s.invoice_signature_path || ""));
  const sign = signFile && signFile !== logoFile ? fileToDataUri(null, pack.signature_path || s.invoice_signature_path) : null;
  const addr = companyAddress(s);
  const total = money(row.total);
  const tax = money(row.tax);
  const due = money(row.due_amount != null ? row.due_amount : Math.max(0, total - money(row.amount_paid)));
  const discountSum = money(lines.reduce((a, l) => a + lineDiscountAmt(l), 0));
  const subTotal = money(
    row.subtotal != null ? row.subtotal : lines.reduce((a, l) => a + money((Number(l.cost) || 0) * (Number(l.qty) || 0)), 0)
  );
  const bankName = String(pack.bank_name || s.invoice_bank_name || "").trim();
  const accountNo = String(pack.account_no || s.invoice_account_no || "").trim();
  const ifsc = String(pack.ifsc || s.invoice_ifsc || "").trim();
  const qr = await upiQrDataUri(pack.upi_id, s.company_name, due, row.invoice_number);
  const terms = String(pack.terms || "").trim();
  const notes = String(row.notes || "").trim();
  const partyAddress = partyAddressFromRow(row);
  const showTax = String(row.gst_mode || "none").toLowerCase() !== "none";
  const defaultHsn = String(s.invoice_hsn || "").trim();

  const lineRows = lines.length
    ? lines
        .map((l, i) => {
          const name = escapeHtml(l.product_name || "");
          const hsn = String(l.hsn || "").trim() || defaultHsn;
          const nameCell = hsn ? `${name}<div class="muted">HSN ${escapeHtml(hsn)}</div>` : name;
          return `<tr>
            <td>${i + 1}</td>
            <td>${nameCell}</td>
            <td class="num">${escapeHtml(moneyLabel(cur, l.cost))}</td>
            <td class="num">${escapeHtml(qtyLabel(l.qty))}</td>
            <td class="num">${escapeHtml(lineDiscountLabel(cur, l))}</td>
            <td class="num">${escapeHtml(moneyLabel(cur, lineAmount(l)))}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">No line items</td></tr>`;

  const gstBits = [];
  if (s.gst_number) gstBits.push(`GSTIN ${escapeHtml(s.gst_number)}`);
  if (s.pan_number) gstBits.push(`PAN ${escapeHtml(s.pan_number)}`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(
    row.invoice_number || title
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
.bar{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:18px;border:1px solid var(--border)}
.bar .pair{display:grid;grid-template-columns:140px 1fr}
.bar .pair + .pair{border-left:1px solid var(--border)}
.bar .lab{background:var(--brand);color:#fff;padding:8px 12px;font-weight:700;font-size:13px;border-right:1px solid var(--border)}
.bar .val{padding:8px 12px;font-size:13px;background:#fff}
.to{margin-bottom:18px;font-size:13px;line-height:1.5;border:1px solid var(--border);padding:10px 12px}
.to h2{margin:0 0 6px;font-size:14px;color:var(--brand)}
table.items{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;border:1px solid var(--border)}
table.items th,table.items td{border:1px solid var(--border);padding:8px 10px;vertical-align:top}
table.items th{background:var(--brand);color:#fff;font-weight:700;text-align:left}
table.items th.num,table.items td.num{text-align:right;white-space:nowrap}
.bottom{display:grid;grid-template-columns:1.2fr auto 1fr;border:1px solid var(--border);margin-bottom:16px}
.bottom > div{padding:12px}
.bottom > div + div{border-left:1px solid var(--border)}
.pay h2{margin:0 0 8px;font-size:14px;color:var(--brand)}
.pay p{margin:0 0 4px;font-size:13px}
.qr-wrap{display:flex;align-items:center;justify-content:center;min-width:148px;min-height:148px}
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
.sign .sign-slot{min-height:56px;width:160px;margin:0 auto 8px}
.sign span{font-size:12px;color:var(--text)}
.notes{font-size:12px;color:var(--muted);margin:0 0 16px;white-space:pre-wrap;border:1px solid var(--border);padding:8px 10px}
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
  <h1 class="title">${escapeHtml(title)}</h1>
  <div class="head">
    <div>${logo ? `<img class="logo" src="${logo}" alt="Logo"/>` : ""}</div>
    <div class="company">
      <strong>${escapeHtml(s.company_name || "Invoice")}</strong>
      ${s.email ? `<div>${escapeHtml(s.email)}</div>` : ""}
      ${s.phone ? `<div>${escapeHtml(s.phone)}</div>` : ""}
      ${addr ? `<div>${escapeHtml(addr)}</div>` : ""}
      ${gstBits.length ? `<div class="muted">${gstBits.join(" · ")}</div>` : ""}
    </div>
  </div>
  <div class="bar">
    <div class="pair"><div class="lab">Invoice #</div><div class="val">${escapeHtml(row.invoice_number || "—")}</div></div>
    <div class="pair"><div class="lab">Invoice Date</div><div class="val">${escapeHtml(fmtDate(row.invoice_date))}</div></div>
  </div>
  <div class="to">
    <h2>Invoice To</h2>
    <div><strong>${escapeHtml(row.customer_name || "—")}</strong></div>
    ${row.company_name ? `<div>${escapeHtml(row.company_name)}</div>` : ""}
    ${row.customer_email ? `<div>${escapeHtml(row.customer_email)}</div>` : ""}
    ${row.customer_phone ? `<div>${escapeHtml(row.customer_phone)}</div>` : ""}
    ${partyAddress ? `<div>${escapeHtml(partyAddress)}</div>` : ""}
  </div>
  <table class="items">
    <thead><tr><th>#</th><th>Product Name</th><th class="num">Cost</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Total Amount</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <div class="bottom">
    <div class="pay">
      <h2>Payments Details</h2>
      ${bankName ? `<p><strong>Bank Name</strong> ${escapeHtml(bankName)}</p>` : ""}
      ${accountNo ? `<p><strong>Account No</strong> ${escapeHtml(accountNo)}</p>` : ""}
      ${ifsc ? `<p><strong>IFSC Code</strong> ${escapeHtml(ifsc)}</p>` : ""}
    </div>
    <div class="qr-wrap">${qr ? `<img class="qr" src="${qr}" alt="UPI QR"/>` : ""}</div>
    <div class="totals">
      <table>
        <tr><td>Sub Total</td><td>${escapeHtml(moneyLabel(cur, subTotal))}</td></tr>
        <tr><td>Discount</td><td>${escapeHtml(moneyLabel(cur, discountSum))}</td></tr>
        ${showTax ? `<tr><td>Tax</td><td>${escapeHtml(moneyLabel(cur, tax))}</td></tr>` : ""}
        <tr><td>Total</td><td>${escapeHtml(moneyLabel(cur, total))}</td></tr>
        <tr><td class="due">Total Due</td><td class="due">${escapeHtml(moneyLabel(cur, due))}</td></tr>
      </table>
    </div>
  </div>
  <div class="words">IN WORDS : ${escapeHtml(amountInWords(total))}</div>
  ${notes ? `<div class="notes">${escapeHtml(notes)}</div>` : ""}
  <div class="foot">
    <div class="terms">${terms ? `<h2>Terms &amp; Condition</h2>${termsHtml(terms)}` : ""}</div>
    <div class="sign">
      ${sign ? `<img src="${sign}" alt="Signature"/>` : `<div class="sign-slot"></div>`}
      <span>Authorized Signature</span>
    </div>
  </div>
</div>
</body></html>`;
}

module.exports = {
  buildInvoiceDocumentHtml,
  amountInWords,
  invoiceTitle,
  upiQrDataUri,
  fileToDataUri,
};
