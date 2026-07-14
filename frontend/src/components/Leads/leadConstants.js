/** Legacy + reference lead statuses, sources, and display helpers */

export const LEGACY_STATUSES = [
  { key: "new", label: "New", color: "#0d9488", bg: "#0d94881a" },
  { key: "processing", label: "Processing", color: "#7c3aed", bg: "#7c3aed1a" },
  { key: "close_by", label: "Close-by", color: "#16a34a", bg: "#16a34a1a" },
  { key: "confirm", label: "Converted to Opportunity", color: "#15803d", bg: "#15803d1a" },
  { key: "cancel", label: "Cancel", color: "#dc2626", bg: "#dc26261a" },
];

/** Selected in status &lt;select&gt; to open convert modal (not a DB status). */
export const CONVERT_OPTION_VALUE = "__convert_opportunity__";

export function isLeadConverted(lead) {
  return Boolean(
    lead?.converted_opportunity_id ||
      lead?.status === "confirm" ||
      lead?.status_v2 === "converted"
  );
}

/** Pipeline chips / kanban columns (matches reference CRM status strip). */
export const REFERENCE_STATUSES = [
  { key: "new", label: "New", color: "#2563eb", bg: "#2563eb1a" },
  { key: "assigned", label: "Assigned", color: "#3b82f6", bg: "#3b82f61a" },
  { key: "in_process", label: "In Process", color: "#f59e0b", bg: "#f59e0b1a" },
  { key: "converted", label: "Converted", color: "#22c55e", bg: "#22c55e1a" },
  { key: "recycled", label: "Recycled", color: "#a855f7", bg: "#a855f71a" },
  { key: "dead", label: "Dead", color: "#ef4444", bg: "#ef44441a" },
];

const CUSTOM_STATUS_COLORS = ["#64748b", "#475569", "#6b7280", "#78716c", "#57534e", "#52525b"];

const LEGACY_TO_V2 = {
  new: "new",
  processing: "in_process",
  close_by: "assigned",
  confirm: "converted",
  cancel: "dead",
};

const KNOWN_STATUS_KEYS = new Set([
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
]);

const BUILTIN_PIPELINE_KEYS = new Set(REFERENCE_STATUSES.map((s) => s.key));

/** Resolve lead's pipeline key: status_v2 if set, else map from legacy. */
export function getLeadPipelineKey(lead) {
  if (!lead) return "new";
  if (isLeadConverted(lead)) return "converted";
  const v2 = lead.status_v2 != null ? String(lead.status_v2).trim() : "";
  if (v2) return v2;
  return LEGACY_TO_V2[lead.status] || lead.status || "new";
}

export function formatLeadStatus(lead) {
  const v2 = getLeadPipelineKey(lead);
  if (!BUILTIN_PIPELINE_KEYS.has(v2)) {
    return {
      key: v2,
      v2,
      label: v2,
      color: "#64748b",
      bg: "#64748b1a",
      isCustom: true,
    };
  }
  const ref = REFERENCE_STATUSES.find((s) => s.key === v2);
  const legacy = LEGACY_STATUSES.find((s) => s.key === lead?.status);
  return {
    key: v2,
    v2,
    label: ref?.label || legacy?.label || v2,
    color: ref?.color || legacy?.color || "#94a3b8",
    bg: ref?.bg || legacy?.bg || "#94a3b81a",
  };
}

export const SOURCES = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "Whatsapp" },
  { value: "google_form", label: "Google Form" },
  { value: "google_ads", label: "Google Ads" },
  { value: "indiamart", label: "IndiaMart" },
  { value: "website_lead", label: "Website" },
  { value: "customer_reminder", label: "Customer Reminder" },
  { value: "referral", label: "Referral" },
  { value: "99acres", label: "99Acres" },
  { value: "housing", label: "Housing.com" },
  { value: "magicbricks", label: "MagicBricks" },
  { value: "just_dial", label: "Just Dial" },
  { value: "tradeindia", label: "TradeIndia" },
  { value: "other", label: "Other" },
];

export const PRODUCT_CATEGORIES = [
  { value: "initial_consultation", label: "Initial Consultation" },
  { value: "follow_up", label: "Follow Up" },
  { value: "membership_or_program", label: "Membership / Program" },
  { value: "personal_training", label: "Personal Training" },
  { value: "nutrition_or_supplements", label: "Nutrition / Supplements" },
  { value: "general_inquiry", label: "General Inquiry" },
  { value: "Services", label: "Services" },
  { value: "Hardware", label: "Hardware" },
  { value: "Software", label: "Software" },
  { value: "other", label: "Other" },
];

export const FOLLOWUP_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "demo", label: "Demo" },
  { value: "other", label: "Other" },
];

/** Form / select options for pipeline (reference statuses). */
export const FORM_STATUSES = REFERENCE_STATUSES.map((s) => ({ value: s.key, label: s.label }));

export const LABEL_PRESETS = ["Hot", "Warm", "Cold", "VIP", "Enterprise", "Partner", "Inbound"];

export const LABEL_OPTIONS = LABEL_PRESETS.map((l) => ({ value: l, label: l }));

export const ACCOUNT_RELATIONSHIPS = [
  { value: "competitor", label: "Competitor" },
  { value: "customer", label: "Customer" },
  { value: "integrator", label: "Integrator" },
  { value: "partner", label: "Partner" },
  { value: "prospect", label: "Prospect" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

export const OTHER_VALUE = "other";

export function normOptKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Remove built-in duplicates and the "other" sentinel from API custom lists. */
export function cleanCustomOptions(customList = [], staticList = []) {
  const staticKeys = new Set(
    staticList.map((s) => normOptKey(typeof s === "string" ? s : s.value))
  );
  return (customList || [])
    .filter((o) => o?.value && normOptKey(o.value) !== OTHER_VALUE)
    .filter((o) => !staticKeys.has(normOptKey(o.value)))
    .map((o) => ({ value: o.value, label: o.label || o.value, id: o.id }));
}

/** Merge static + custom (+ optional empty / Other) for a dropdown. */
export function buildFieldOptions(staticList, customList, opts = {}) {
  const { includeEmpty = false, includeOther = false, emptyLabel = "Select" } = opts;
  const merged = [
    ...(includeEmpty ? [{ value: "", label: emptyLabel }] : []),
    ...staticList,
    ...cleanCustomOptions(customList, staticList),
    ...(includeOther ? [{ value: OTHER_VALUE, label: "Other" }] : []),
  ];
  const seen = new Set();
  const out = [];
  for (const item of merged) {
    const key = normOptKey(item.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** True when pipeline status is a custom value (stored in status_v2). */
export function isCustomLeadStatus(lead) {
  const v2 = getLeadPipelineKey(lead);
  return Boolean(v2) && !BUILTIN_PIPELINE_KEYS.has(v2);
}

export function getLeadStatusSelectValue(lead) {
  return getLeadPipelineKey(lead);
}

/**
 * Status strip + kanban: colored built-ins + gray custom statuses from API.
 * Gray chips = custom options created via "Other" on lead save / manage modal.
 */
export function buildStatusColumns(customStatusOptions = []) {
  const staticForClean = REFERENCE_STATUSES.map((s) => ({ value: s.key, label: s.label }));
  const custom = cleanCustomOptions(customStatusOptions, staticForClean).map((o, i) => ({
    key: o.value,
    label: o.label,
    color: CUSTOM_STATUS_COLORS[i % CUSTOM_STATUS_COLORS.length],
    bg: `${CUSTOM_STATUS_COLORS[i % CUSTOM_STATUS_COLORS.length]}1a`,
    isCustom: true,
  }));
  return [
    ...REFERENCE_STATUSES.map((s) => ({ ...s, isCustom: false })),
    ...custom,
  ];
}

export function buildSourceFilterOptions(customSources = []) {
  return buildFieldOptions(SOURCES, customSources, { includeEmpty: false, includeOther: false });
}

export function buildLabelFilterOptions(customLabels = []) {
  return buildFieldOptions(LABEL_OPTIONS, customLabels, { includeEmpty: false, includeOther: false });
}
