"use strict";

const FIELD_MAX = {
  external_id: 120,
  first_name: 100,
  last_name: 100,
  name: 100,
  phone: 20,
  phone_dial: 10,
  email: 150,
  company_name: 150,
  source: 50,
  status: 32,
  label: 50,
  designation: 120,
  industry: 120,
  department: 120,
  product_category: 80,
  team: 160,
  account_relationship: 80,
  followup_type: 80,
  address_line1: 255,
  address_line2: 255,
  city: 120,
  state: 120,
  country: 120,
  postal_code: 32,
  reference: 255,
  currency: 8,
};

function stripControlChars(value) {
  return String(value || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function trimStr(value) {
  return stripControlChars(value).trim();
}

function maxLen(value, limit) {
  const s = trimStr(value);
  if (!limit || s.length <= limit) return s;
  return s.slice(0, limit);
}

function normalizeEmail(value) {
  const s = maxLen(value, FIELD_MAX.email).toLowerCase();
  return s || "";
}

function validEmail(value) {
  const s = normalizeEmail(value);
  if (!s) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizePhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || "";
}

function normalizePhoneStorage(value, dial) {
  const raw = trimStr(value);
  const dialStr = trimStr(dial);
  let combined = raw;
  if (dialStr && raw && !raw.startsWith("+")) {
    combined = `${dialStr}${raw.replace(/^0+/, "")}`;
  } else if (!raw && dialStr) {
    combined = dialStr;
  }
  return maxLen(combined, FIELD_MAX.phone);
}

function parseImportDate(value) {
  if (value == null || value === "") return { date: null, error: null };
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value, error: null };
  }
  const s = trimStr(value);
  if (!s) return { date: null, error: null };
  const isoDate = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return { date: d, error: null };
  }
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) {
    return { date: null, error: "Invalid date format" };
  }
  return { date: d, error: null };
}

function parseImportAmount(value) {
  if (value == null || value === "") return { amount: 0, error: null };
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) {
    return { amount: null, error: "Invalid amount" };
  }
  return { amount: Math.round(n * 100) / 100, error: null };
}

function sanitizeField(field, value) {
  if (value == null) return "";
  if (field === "email") return normalizeEmail(value);
  if (field === "phone") return normalizePhoneStorage(value);
  if (field === "currency") return maxLen(value, FIELD_MAX.currency).toUpperCase() || "INR";
  const limit = FIELD_MAX[field];
  return limit ? maxLen(value, limit) : trimStr(value);
}

module.exports = {
  FIELD_MAX,
  trimStr,
  normalizeEmail,
  validEmail,
  normalizePhoneDigits,
  normalizePhoneStorage,
  parseImportDate,
  parseImportAmount,
  sanitizeField,
};
