"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const MAX_ROWS = 25000;
const PREVIEW_ROWS = 10;

const HEADER_ALIASES = {
  external_id: ["external_id", "externalid", "lead_id", "leadid", "id", "crm_id"],
  first_name: ["first_name", "firstname", "fname", "given_name"],
  last_name: ["last_name", "lastname", "lname", "surname", "family_name"],
  name: ["name", "full_name", "fullname", "contact_name", "lead_name"],
  phone: ["phone", "mobile", "phone_number", "mobilenumber", "cell", "telephone"],
  phone_dial: ["phone_dial", "dial_code", "country_code"],
  email: ["email", "email_address", "e_mail"],
  company_name: ["company_name", "company", "organization", "org"],
  source: ["source", "lead_source"],
  status: ["status", "lead_status"],
  label: ["label", "labels", "tag"],
  designation: ["designation", "title", "job_title"],
  industry: ["industry"],
  department: ["department", "dept"],
  product_category: ["product_category", "category", "product"],
  team: ["team"],
  account_relationship: ["account_relationship", "relationship", "account_type"],
  followup_type: ["followup_type", "follow_up_type"],
  follow_up_date: ["follow_up_date", "followup_date", "follow_up"],
  followup_at: ["followup_at", "follow_up_at", "followup_time"],
  address_line1: ["address_line1", "address1", "street", "address"],
  address_line2: ["address_line2", "address2"],
  city: ["city"],
  state: ["state", "province", "region"],
  country: ["country"],
  postal_code: ["postal_code", "zip", "zipcode", "pincode"],
  notes: ["notes", "note", "comments", "comments_history", "description"],
  amount: ["amount", "value", "deal_amount"],
  currency: ["currency"],
  reference: ["reference", "ref"],
  assigned_to: ["assigned_to", "assignee", "owner", "assigned_user"],
};

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value.text) return String(value.text).trim();
  if (typeof value === "object" && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"|"$/g, "").trim());
}

function uniquifyHeaders(headers) {
  const seen = new Map();
  return headers.map((raw, idx) => {
    let name = String(raw || "").trim();
    if (!name) name = `Column ${idx + 1}`;
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

function findHeaderRowIndex(matrix) {
  const maxScan = Math.min(matrix.length, 15);
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < maxScan; i += 1) {
    const cells = (matrix[i] || []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (!cells.length) continue;
    const unique = new Set(cells.map(normalizeHeader));
    let aliasHits = 0;
    for (const norm of unique) {
      if (Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(norm))) {
        aliasHits += 1;
      }
    }
    const diversity = unique.size / cells.length;
    const score = aliasHits * 12 + unique.size + diversity * 4 - (cells.length === 1 ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function matrixToParsed(matrix) {
  if (!matrix?.length) return { headers: [], rows: [] };
  const headerIdx = findHeaderRowIndex(matrix);
  const rawHeaders = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const dataRows = matrix.slice(headerIdx + 1);
  const keep = rawHeaders.map((h, i) => {
    if (h) return true;
    return dataRows.some((row) => row[i] != null && String(row[i]).trim());
  });
  const filtered = rawHeaders.filter((_, i) => keep[i]);
  const headers = uniquifyHeaders(filtered);
  const rows = dataRows
    .map((rowArr) => {
      const obj = {};
      let empty = true;
      let dest = 0;
      rawHeaders.forEach((_, src) => {
        if (!keep[src]) return;
        const val = rowArr[src] != null ? String(rowArr[src]).trim() : "";
        obj[headers[dest]] = val;
        if (val) empty = false;
        dest += 1;
      });
      return empty ? null : obj;
    })
    .filter(Boolean);
  return { headers, rows };
}

function scoreParsed(parsed, sheetName) {
  const skipName = /(setting|dropdown|list|lookup|config|template|instruction)/i.test(
    String(sheetName || "")
  );
  const aliasHits = Object.keys(suggestColumnMapping(parsed.headers)).length;
  return aliasHits * 20 + parsed.headers.length + parsed.rows.length * 0.01 - (skipName ? 80 : 0);
}

function pickBestSheet(sheets) {
  let best = sheets[0];
  let bestScore = -Infinity;
  for (const sheet of sheets) {
    const parsed = matrixToParsed(sheet.data || []);
    const score = scoreParsed(parsed, sheet.sheet);
    if (score > bestScore) {
      bestScore = score;
      best = sheet;
    }
  }
  return best;
}

function parseCsvBuffer(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  return matrixToParsed(lines.map((line) => parseCsvLine(line)));
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const data = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = [];
      const max = row.cellCount || 0;
      for (let c = 1; c <= max; c += 1) {
        values[c - 1] = cellText(row.getCell(c).value);
      }
      data.push(values);
    });
    sheets.push({ sheet: worksheet.name, data });
  });
  if (!sheets.length) return { headers: [], rows: [] };
  return matrixToParsed(pickBestSheet(sheets).data || []);
}

function detectFileType(fileName, mimeType) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  if (ext === ".csv" || mimeType === "text/csv" || mimeType === "application/vnd.ms-excel") {
    return "csv";
  }
  return null;
}

async function parseFileBuffer(buffer, fileType) {
  if (fileType === "xlsx") return parseXlsxBuffer(buffer);
  return parseCsvBuffer(buffer);
}

async function parseImportFile(filePath, fileType) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await parseFileBuffer(buffer, fileType);
  if (parsed.rows.length > MAX_ROWS) {
    const err = new Error(`File exceeds maximum of ${MAX_ROWS} rows`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

function suggestColumnMapping(headers) {
  const mapping = {};
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const used = new Set();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const match = normalizedHeaders.find((h) => !used.has(h.raw) && aliases.includes(h.norm));
    if (match) {
      mapping[field] = match.raw;
      used.add(match.raw);
    }
  }
  return mapping;
}

function applyMapping(rows, columnMapping) {
  const mapping = columnMapping || {};
  return rows.map((row, index) => {
    const out = { __rowNumber: index + 2 };
    for (const [field, fileCol] of Object.entries(mapping)) {
      if (!fileCol) continue;
      out[field] = row[fileCol] != null ? String(row[fileCol]).trim() : "";
    }
    return out;
  });
}

module.exports = {
  PREVIEW_ROWS,
  detectFileType,
  parseFileBuffer,
  parseImportFile,
  suggestColumnMapping,
  applyMapping,
};
