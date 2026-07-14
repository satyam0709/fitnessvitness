/** Built-in lead dropdown values — skip registry for these (single-admin CRM). */

const BUILT_IN = {
  source: new Set([
    "online",
    "offline",
    "facebook",
    "instagram",
    "whatsapp",
    "google_form",
    "google_ads",
    "indiamart",
    "website_lead",
    "customer_reminder",
    "referral",
    "99acres",
    "housing",
    "magicbricks",
    "just_dial",
    "tradeindia",
    "other",
    "cold call",
    "cold_call",
    "website",
  ]),
  label: new Set([
    "hot",
    "warm",
    "cold",
    "vip",
    "enterprise",
    "partner",
    "inbound",
  ]),
  status: new Set([
    "new",
    "processing",
    "close_by",
    "confirm",
    "cancel",
    "assigned",
    "in_process",
    "converted",
    "recycled",
    "dead",
  ]),
  account_relationship: new Set([
    "competitor",
    "customer",
    "integrator",
    "partner",
    "prospect",
    "vendor",
    "other",
  ]),
  followup_type: new Set(["call", "email", "meeting", "whatsapp", "demo", "other"]),
  product_category: new Set([
    "initial_consultation",
    "follow_up",
    "membership_or_program",
    "personal_training",
    "nutrition_or_supplements",
    "general_inquiry",
    "hardware",
    "software",
    "services",
    "other",
  ]),
  team: new Set([]),
};

const DISTINCT_FIELDS = new Set(["source", "label"]);

const REGISTRY_FIELDS = new Set([
  "status",
  "account_relationship",
  "followup_type",
  "product_category",
  "team",
]);

/** Maps registry field_name → leads column for rename/delete cascade */
const LEAD_COLUMN_MAP = {
  source: "source",
  label: "label",
  status: "status_v2",
  account_relationship: "account_relationship",
  followup_type: "followup_type",
  product_category: "product_category",
  team: "team",
};

function normKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isBuiltInOption(fieldName, value) {
  const val = String(value || "").trim();
  if (!val) return true;
  const set = BUILT_IN[fieldName];
  if (!set) return false;
  return set.has(normKey(val)) || set.has(val.toLowerCase());
}

function toOption(value, label) {
  const v = String(value || "").trim();
  if (!v) return null;
  return { value: v, label: label || v };
}

function dedupeOptions(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item?.value) continue;
    const key = normKey(item.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: item.value, label: item.label || item.value });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

module.exports = {
  BUILT_IN,
  DISTINCT_FIELDS,
  REGISTRY_FIELDS,
  LEAD_COLUMN_MAP,
  normKey,
  isBuiltInOption,
  toOption,
  dedupeOptions,
};
