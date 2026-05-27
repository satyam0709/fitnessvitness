const WA_MAX = 900;

function sanitizeWaText(s) {
  return String(s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WA_MAX);
}

export function phoneToWaDigits(phone, defaultDial = "91") {
  const raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.length >= 10 && raw.length <= 12) return raw.startsWith(defaultDial) ? raw : `${defaultDial}${raw.replace(/^0+/, "")}`;
  return raw;
}

/**
 * Open WhatsApp with a payment receipt summary and link.
 */
export function openWhatsAppPaymentReceipt({
  phone,
  customerName,
  invoiceNumber,
  totalInr,
  paidAt,
  payMode,
  receiptUrl,
  companyName,
}) {
  const digits = phoneToWaDigits(phone);
  if (!digits) {
    throw new Error("No phone number on file for this customer. Add phone on client profile.");
  }

  const lines = [
    `Hello${customerName ? ` ${customerName}` : ""},`,
    "",
    `Payment receipt from ${companyName || "us"}:`,
    `Receipt no: ${invoiceNumber || "—"}`,
    `Amount: ₹${Number(totalInr || 0).toLocaleString("en-IN")}`,
  ];
  if (paidAt) lines.push(`Date: ${paidAt}`);
  if (payMode) lines.push(`Mode: ${payMode}`);
  if (receiptUrl) {
    lines.push("", `View receipt: ${receiptUrl}`);
  }
  lines.push("", "Thank you for your payment.");

  const text = sanitizeWaText(lines.join("\n"));
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}
