/** Legacy ENUM status ↔ reference status_v2 during transition */

const LEGACY_TO_V2 = {
  new: "new",
  processing: "in_process",
  close_by: "assigned",
  confirm: "converted",
  cancel: "dead",
};

const V2_TO_LEGACY = {
  new: "new",
  assigned: "close_by",
  in_process: "processing",
  converted: "confirm",
  recycled: "processing",
  dead: "cancel",
};

const VALID_LEGACY = new Set(["new", "processing", "close_by", "confirm", "cancel"]);
const VALID_V2 = new Set(["new", "assigned", "in_process", "converted", "recycled", "dead"]);

function legacyToV2(status) {
  const s = String(status || "").trim().toLowerCase();
  if (VALID_V2.has(s)) return s;
  return LEGACY_TO_V2[s] || "new";
}

function v2ToLegacy(statusV2) {
  const s = String(statusV2 || "").trim().toLowerCase();
  if (VALID_LEGACY.has(s)) return s;
  return V2_TO_LEGACY[s] || "new";
}

function resolveStatusFilter(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (VALID_LEGACY.has(lower)) {
    return { legacy: lower, v2: legacyToV2(lower), custom: false };
  }
  if (VALID_V2.has(lower)) {
    return { legacy: v2ToLegacy(lower), v2: lower, custom: false };
  }
  return { legacy: null, v2: s, custom: true };
}

/** Parse status from create/update body; custom values live in status_v2. */
function parseStatusInput(body = {}, fallbackLegacy = "new") {
  const raw = body.status != null ? String(body.status).trim() : "";
  const rawV2 = body.status_v2 != null ? String(body.status_v2).trim() : "";
  const candidate = raw || rawV2;
  if (!candidate) {
    const legacy = fallbackLegacy || "new";
    return { legacy, v2: legacyToV2(legacy), custom: false };
  }
  const lower = candidate.toLowerCase();
  if (VALID_LEGACY.has(lower)) {
    return { legacy: lower, v2: legacyToV2(lower), custom: false };
  }
  if (VALID_V2.has(lower)) {
    return { legacy: v2ToLegacy(lower), v2: lower, custom: false };
  }
  const customVal = raw || rawV2;
  return { legacy: "processing", v2: customVal, custom: true };
}

function enrichLeadStatus(row) {
  if (!row || typeof row !== "object") return row;
  const legacy = row.status != null ? String(row.status) : null;
  const v2 = row.status_v2 != null ? String(row.status_v2) : legacyToV2(legacy);
  return {
    ...row,
    status: legacy,
    status_v2: v2,
    display_status: v2,
  };
}

module.exports = {
  LEGACY_TO_V2,
  V2_TO_LEGACY,
  VALID_LEGACY,
  VALID_V2,
  legacyToV2,
  v2ToLegacy,
  resolveStatusFilter,
  parseStatusInput,
  enrichLeadStatus,
};
