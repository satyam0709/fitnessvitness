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

export const REFERENCE_STATUSES = [
  { key: "new", label: "New", color: "#6366f1" },
  { key: "assigned", label: "Assigned", color: "#3b82f6" },
  { key: "in_process", label: "In Process", color: "#f59e0b" },
  { key: "converted", label: "Converted", color: "#22c55e" },
  { key: "recycled", label: "Recycled", color: "#a855f7" },
  { key: "dead", label: "Dead", color: "#ef4444" },
];

const V2_MAP = {
  new: "new",
  assigned: "close_by",
  in_process: "processing",
  converted: "confirm",
  recycled: "processing",
  dead: "cancel",
};

const LEGACY_TO_V2 = {
  new: "new",
  processing: "in_process",
  close_by: "assigned",
  confirm: "converted",
  cancel: "dead",
};

export function formatLeadStatus(lead) {
  const v2 = lead?.status_v2 || LEGACY_TO_V2[lead?.status] || lead?.status || "new";
  const ref = REFERENCE_STATUSES.find((s) => s.key === v2);
  const legacy = LEGACY_STATUSES.find((s) => s.key === lead?.status);
  return {
    key: lead?.status || V2_MAP[v2] || "new",
    v2,
    label: ref?.label || legacy?.label || v2,
    color: ref?.color || legacy?.color || "#94a3b8",
    bg: legacy?.bg || "#94a3b81a",
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

export const FORM_STATUSES = LEGACY_STATUSES.map((s) => ({ value: s.key, label: s.label }));

export const LABEL_PRESETS = ["Hot", "Warm", "Cold", "VIP", "Enterprise", "Partner", "Inbound"];
