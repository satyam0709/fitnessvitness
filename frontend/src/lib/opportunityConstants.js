export const PRODUCT_CATEGORIES = [
  { value: "initial_consultation", label: "Initial consultation" },
  { value: "follow_up", label: "Follow-up visit" },
  { value: "membership_or_program", label: "Membership / program" },
  { value: "personal_training", label: "Personal training" },
  { value: "nutrition_or_supplements", label: "Nutrition / supplements" },
  { value: "general_inquiry", label: "General inquiry" },
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

export const OPPORTUNITY_TYPES = [
  { value: "new_business", label: "New Business" },
  { value: "upsell", label: "Upsell" },
  { value: "renewal", label: "Renewal" },
  { value: "cross_sell", label: "Cross-sell" },
  { value: "other", label: "Other" },
];

export const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "social_media", label: "Social Media" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "cold_call", label: "Cold Call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

export function emptyOpportunityCustomOptions() {
  return {
    product_category: [],
    followup_type: [],
    opportunity_type: [],
    source: [],
  };
}

export function prettifyToken(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function cleanCustomOptions(customList, staticList = []) {
  if (!Array.isArray(customList)) return [];
  const seen = new Set();
  staticList.forEach((s) => {
    if (s && s.value) seen.add(String(s.value).toLowerCase());
  });
  seen.add("other");

  return customList.filter((opt) => {
    if (!opt || opt.value == null) return false;
    const lower = String(opt.value).toLowerCase();
    if (!lower || seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

export function mergeOptionList(defaults, customs) {
  return [...defaults, ...cleanCustomOptions(customs, defaults)];
}

export function buildLabelMap(items) {
  return Object.fromEntries(
    (items || []).map((it) => [String(it.value).toLowerCase(), it.label || prettifyToken(it.value)])
  );
}

export function optionLabel(map, value) {
  const key = String(value || "").toLowerCase();
  if (!key) return "";
  return map[key] || prettifyToken(value);
}
