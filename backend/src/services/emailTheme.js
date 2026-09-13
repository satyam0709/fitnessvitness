const EMAIL_THEME = {
  pageBg: "#f4f5f9",
  cardBg: "#ffffff",
  headerBg: "#ffffff",
  text: "#1a1a2e",
  muted: "#5a5f7d",
  faint: "#9ca3af",
  accent: "#8bc34a",
  accentSoft: "#eef8e4",
  border: "#e4e7f0",
  boxBg: "#f4f5f9",
  buttonText: "#ffffff",
};

function defaultAppBaseUrl() {
  const base =
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return String(base).replace(/\/+$/, "");
}

function emailLogoUrl(baseUrl) {
  const base = String(baseUrl || defaultAppBaseUrl()).replace(/\/+$/, "");
  return `${base}/logo.png`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell({
  headerTitle,
  headerSubtitle,
  bodyHtml,
  logoBaseUrl,
  showSupportLine = true,
  extraFooterHtml = "",
} = {}) {
  const t = EMAIL_THEME;
  const appName = process.env.APP_NAME || "FitnessVitness CRM";
  const supportEmail = process.env.SUPPORT_EMAIL || "";
  const logoUrl = emailLogoUrl(logoBaseUrl);
  const supportLine =
    showSupportLine && supportEmail
      ? `<p style="margin:24px 0 0;font-size:13px;color:${t.muted};text-align:center;">Questions? <a href="mailto:${escapeHtml(supportEmail)}" style="color:${t.accent};text-decoration:none;">${escapeHtml(supportEmail)}</a></p>`
      : "";
  const footerCell = extraFooterHtml
    ? `<tr><td style="background:${t.headerBg};border-top:1px solid ${t.border};padding:24px 40px;text-align:center;">${extraFooterHtml}</td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:${t.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${t.text};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${t.pageBg};padding:36px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${t.cardBg};border-radius:12px;overflow:hidden;border:1px solid ${t.border};">
<tr><td style="background:${t.headerBg};padding:32px;text-align:center;border-bottom:3px solid ${t.accent};">
<img src="${logoUrl}" alt="${escapeHtml(appName)}" style="display:inline-block;max-width:200px;height:auto;" />
<p style="margin:8px 0 0;font-size:12px;color:${t.accent};text-transform:uppercase;letter-spacing:.6px;font-weight:600;">${escapeHtml(headerSubtitle || "")}</p>
</td></tr>
<tr><td style="padding:32px;color:${t.text};">
<p style="margin:0 0 16px;font-size:22px;font-weight:700;color:${t.text};text-align:center;">${escapeHtml(headerTitle || "")}</p>
${bodyHtml || ""}
${supportLine}
</td></tr>
${footerCell}
</table>
</td></tr>
</table>
</body></html>`;
}

function detailsTable(rows) {
  const t = EMAIL_THEME;
  const trs = (rows || [])
    .filter((r) => r && r.label)
    .map(
      (r, i, arr) => `<tr>
<td style="padding:14px 18px;${i < arr.length - 1 ? `border-bottom:1px solid ${t.border};` : ""}">
<span style="display:block;font-size:12px;color:${t.muted};margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px;">${escapeHtml(r.label)}</span>
<span style="font-size:14px;font-weight:600;color:${r.color || t.text};">${r.html ? r.html : escapeHtml(r.value)}</span>
</td></tr>`
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${t.border};border-radius:10px;margin:20px 0;background:${t.boxBg};">${trs}</table>`;
}

function ctaButton(href, label, color = EMAIL_THEME.accent) {
  const t = EMAIL_THEME;
  const url = escapeHtml(href);
  return `<p style="text-align:center;margin:24px 0 8px;">
<a href="${url}" style="display:inline-block;background:${color};color:${t.buttonText};text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:700;">${escapeHtml(label)}</a>
</p>`;
}

module.exports = {
  EMAIL_THEME,
  emailLogoUrl,
  defaultAppBaseUrl,
  escapeHtml,
  emailShell,
  detailsTable,
  ctaButton,
};
