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
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (VALID_LEGACY.has(s)) {
    return { legacy: s, v2: legacyToV2(s) };
  }
  if (VALID_V2.has(s)) {
    return { legacy: v2ToLegacy(s), v2: s };
  }
  return null;
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
  enrichLeadStatus,
};
