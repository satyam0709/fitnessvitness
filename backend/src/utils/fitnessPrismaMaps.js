/**
 * Map API display enum values ↔ Prisma Client enum member names (@map).
 * Preserve API response shapes that historically used MySQL enum labels.
 */

const SOURCE_API_TO_PRISMA = {
  BNI: "BNI",
  Instagram: "Instagram",
  Facebook: "Facebook",
  "Referral - Existing Client": "Referral___Existing_Client",
  "Friend / Family": "Friend___Family",
  "Walk-in": "Walk_in",
  "Online / Website": "Online___Website",
  "Corporate / Company": "Corporate___Company",
};

const PLAN_API_TO_PRISMA = {
  "1 Month Plan": "Month_1_Plan",
  "3 Month Plan": "Month_3_Plan",
  "6 Month Plan": "Month_6_Plan",
  "1 Year Plan": "Year_1_Plan",
};

const PROGRESS_API_TO_PRISMA = {
  "Very Good": "Very_Good",
  Good: "Good",
  Neutral: "Neutral",
  Poor: "Poor",
  "Very Poor": "Very_Poor",
};

const CONSULT_API_TO_PRISMA = {
  Onboarding: "Onboarding",
  "Diet Review": "Diet_Review",
  "Check-in": "Check_in",
  "Follow-up": "Follow_up",
  Other: "Other",
};

const TASK_STATUS_API_TO_PRISMA = {
  Open: "Open",
  "In Progress": "In_Progress",
  Done: "Done",
  "Carried Forward": "Carried_Forward",
  Overdue: "Overdue",
};

const PAY_MODE_API_TO_PRISMA = {
  GPay: "GPay",
  Cash: "Cash",
  "Online Transfer": "Online_Transfer",
  Cheque: "Cheque",
  UPI: "UPI",
  NEFT: "NEFT",
};

function invert(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[v] = k;
  return out;
}

const SOURCE_PRISMA_TO_API = invert(SOURCE_API_TO_PRISMA);
const PLAN_PRISMA_TO_API = invert(PLAN_API_TO_PRISMA);
const PROGRESS_PRISMA_TO_API = invert(PROGRESS_API_TO_PRISMA);
const CONSULT_PRISMA_TO_API = invert(CONSULT_API_TO_PRISMA);
const TASK_STATUS_PRISMA_TO_API = invert(TASK_STATUS_API_TO_PRISMA);
const PAY_MODE_PRISMA_TO_API = invert(PAY_MODE_API_TO_PRISMA);

function mapOrSame(map, value) {
  if (value === undefined || value === null || value === "") return value;
  const s = String(value);
  return map[s] !== undefined ? map[s] : s;
}

function toPrismaDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function serializeFitnessRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  if ("source" in out) out.source = mapOrSame(SOURCE_PRISMA_TO_API, out.source);
  if ("plan_type" in out) out.plan_type = mapOrSame(PLAN_PRISMA_TO_API, out.plan_type);
  if ("progress" in out) out.progress = mapOrSame(PROGRESS_PRISMA_TO_API, out.progress);
  if ("consult_type" in out) out.consult_type = mapOrSame(CONSULT_PRISMA_TO_API, out.consult_type);
  if ("status" in out && TASK_STATUS_PRISMA_TO_API[out.status]) {
    // only remap fitness_client_tasks status; client status values match
  }
  if ("pay_mode" in out) out.pay_mode = mapOrSame(PAY_MODE_PRISMA_TO_API, out.pay_mode);

  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v && typeof v === "object" && typeof v.toNumber === "function") {
      out[key] = v.toNumber();
    } else if (v instanceof Date) {
      // Keep date-only fields as YYYY-MM-DD for API compatibility
      if (
        /_date$/.test(key) ||
        key === "completed_on" ||
        key === "recorded_date" ||
        key === "consult_date" ||
        key === "prescribed_date" ||
        key === "transaction_date" ||
        key === "referral_date" ||
        key === "paid_at" ||
        key === "start_date" ||
        key === "end_date"
      ) {
        out[key] = toYmd(v);
      }
    }
  }

  if ("status" in out && TASK_STATUS_PRISMA_TO_API[out.status]) {
    out.status = TASK_STATUS_PRISMA_TO_API[out.status];
  }

  return out;
}

function serializeFitnessRows(rows) {
  return Array.isArray(rows) ? rows.map(serializeFitnessRow) : rows;
}

function toPrismaSource(v) {
  return v == null ? v : mapOrSame(SOURCE_API_TO_PRISMA, v);
}
function toPrismaPlan(v) {
  return v == null ? v : mapOrSame(PLAN_API_TO_PRISMA, v);
}
function toPrismaProgress(v) {
  return v == null ? v : mapOrSame(PROGRESS_API_TO_PRISMA, v);
}
function toPrismaConsult(v) {
  return v == null ? v : mapOrSame(CONSULT_API_TO_PRISMA, v);
}
function toPrismaTaskStatus(v) {
  return v == null ? v : mapOrSame(TASK_STATUS_API_TO_PRISMA, v);
}
function toPrismaPayMode(v) {
  return v == null ? v : mapOrSame(PAY_MODE_API_TO_PRISMA, v);
}

module.exports = {
  toPrismaDate,
  toYmd,
  numOrNull,
  serializeFitnessRow,
  serializeFitnessRows,
  toPrismaSource,
  toPrismaPlan,
  toPrismaProgress,
  toPrismaConsult,
  toPrismaTaskStatus,
  toPrismaPayMode,
  SOURCE_API_TO_PRISMA,
  PLAN_API_TO_PRISMA,
  PROGRESS_API_TO_PRISMA,
  CONSULT_API_TO_PRISMA,
  TASK_STATUS_API_TO_PRISMA,
  PAY_MODE_API_TO_PRISMA,
};
