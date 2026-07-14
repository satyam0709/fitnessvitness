const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const { canSeeAllTeamRecords } = require("../utils/crmTeamAccess");

function tenantIdFromReq(req) {
  if (!req) return null;
  return req.user?.tenantId ?? req.tenantId ?? null;
}

/** Base Prisma where for non-deleted opportunities, scoped like list routes. */
function baseWhere(req) {
  const where = {
    is_deleted: false,
    tenant_id: tenantIdFromReq(req),
  };
  if (req && !canSeeAllTeamRecords(req)) {
    const uid = Number(req.user?.id);
    if (Number.isFinite(uid)) {
      where.OR = [{ created_by: uid }, { owner_user_id: uid }];
    }
  }
  return where;
}

function num(v) {
  if (v == null) return 0;
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  return Number(v) || 0;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseYmd(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function inrValue(o, preferFinal) {
  if (String(o.currency || "INR").toUpperCase() !== "INR") return 0;
  if (preferFinal && o.final_amount != null) return num(o.final_amount);
  return num(preferFinal ? o.final_amount ?? o.amount : o.amount);
}

/**
 * Lifetime Closed Won / Closed Lost aggregates from opportunities.
 */
async function getClosedWonLostLifetime(req) {
  const base = baseWhere(req);
  const rows = await prisma.opportunities.findMany({
    where: {
      ...base,
      stage: { in: ["closed_won", "closed_lost"] },
    },
    select: {
      stage: true,
      amount: true,
      final_amount: true,
      currency: true,
    },
  });

  let closed_won_count = 0;
  let closed_won_value = 0;
  let closed_lost_count = 0;
  let closed_lost_value = 0;
  for (const o of rows) {
    if (o.stage === "closed_won") {
      closed_won_count += 1;
      closed_won_value += inrValue(o, true);
    } else {
      closed_lost_count += 1;
      closed_lost_value += inrValue(o, false);
    }
  }

  return {
    closed_won_count,
    closed_won_value,
    closed_lost_count,
    closed_lost_value,
  };
}

/**
 * Closed won/lost within [from, to] inclusive (use closed_won_at / closed_lost_at).
 */
async function getClosedWonLostInRange(req, from, to) {
  const base = baseWhere(req);
  const fromD = from ? startOfDay(from) : null;
  const toD = to ? endOfDay(to) : null;

  const wonWhere = { ...base, stage: "closed_won" };
  const lostWhere = { ...base, stage: "closed_lost" };
  if (fromD || toD) {
    wonWhere.closed_won_at = {};
    lostWhere.closed_lost_at = {};
    if (fromD) {
      wonWhere.closed_won_at.gte = fromD;
      lostWhere.closed_lost_at.gte = fromD;
    }
    if (toD) {
      wonWhere.closed_won_at.lte = toD;
      lostWhere.closed_lost_at.lte = toD;
    }
  }

  const [wonRows, lostRows] = await Promise.all([
    prisma.opportunities.findMany({
      where: wonWhere,
      select: { amount: true, final_amount: true, currency: true },
    }),
    prisma.opportunities.findMany({
      where: lostWhere,
      select: { amount: true, currency: true },
    }),
  ]);

  let closed_won_value = 0;
  for (const o of wonRows) closed_won_value += inrValue(o, true);
  let closed_lost_value = 0;
  for (const o of lostRows) closed_lost_value += inrValue(o, false);

  return {
    closed_won_count: wonRows.length,
    closed_won_value,
    closed_lost_count: lostRows.length,
    closed_lost_value,
  };
}

async function getClosedWonLostForMonth(req, year, month) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  return getClosedWonLostInRange(req, from, to);
}

/**
 * Monthly booked won totals keyed by YYYY-MM (closed_won_at).
 */
async function getClosedWonByMonth(req, from, to) {
  const fromD = from ? startOfDay(from) : null;
  const toD = to ? endOfDay(to) : null;
  const tid = tenantIdFromReq(req);
  const uid = req && !canSeeAllTeamRecords(req) ? Number(req.user?.id) : null;

  const conditions = [
    Prisma.sql`is_deleted = 0`,
    Prisma.sql`stage = 'closed_won'`,
    Prisma.sql`closed_won_at IS NOT NULL`,
  ];
  if (tid == null) {
    conditions.push(Prisma.sql`tenant_id IS NULL`);
  } else {
    conditions.push(Prisma.sql`tenant_id = ${tid}`);
  }
  if (fromD) conditions.push(Prisma.sql`closed_won_at >= ${fromD}`);
  if (toD) conditions.push(Prisma.sql`closed_won_at <= ${toD}`);
  if (uid) {
    conditions.push(Prisma.sql`(created_by = ${uid} OR owner_user_id = ${uid})`);
  }

  const whereSql = Prisma.join(conditions, " AND ");
  const rows = await prisma.$queryRaw`
    SELECT DATE_FORMAT(closed_won_at, '%Y-%m') AS ym,
           COUNT(*) AS cnt,
           COALESCE(SUM(
             CASE
               WHEN UPPER(COALESCE(currency, 'INR')) = 'INR'
               THEN COALESCE(final_amount, amount)
               ELSE 0
             END
           ), 0) AS booked
    FROM opportunities
    WHERE ${whereSql}
    GROUP BY DATE_FORMAT(closed_won_at, '%Y-%m')
    ORDER BY ym ASC
  `;

  return rows.map((r) => ({
    month_key: String(r.ym),
    closed_won_count: Number(r.cnt) || 0,
    booked_won_total: num(r.booked),
  }));
}

/**
 * Full summary for GET /opportunities/revenue-summary
 */
async function getRevenueSummary(req, { from, to } = {}) {
  const fromD = typeof from === "string" ? parseYmd(from) : from;
  const toD = typeof to === "string" ? parseYmd(to) : to;

  const now = new Date();
  const mtdFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtdTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [lifetime, mtd, windowStats] = await Promise.all([
    getClosedWonLostLifetime(req),
    getClosedWonLostInRange(req, mtdFrom, mtdTo),
    fromD || toD ? getClosedWonLostInRange(req, fromD || new Date(2000, 0, 1), toD || now) : null,
  ]);

  return {
    lifetime: {
      closed_won_count: lifetime.closed_won_count,
      closed_won_value: lifetime.closed_won_value,
      closed_lost_count: lifetime.closed_lost_count,
      closed_lost_value: lifetime.closed_lost_value,
    },
    mtd: {
      closed_won_count: mtd.closed_won_count,
      closed_won_value: mtd.closed_won_value,
      closed_lost_count: mtd.closed_lost_count,
      closed_lost_value: mtd.closed_lost_value,
    },
    window:
      windowStats && (fromD || toD)
        ? {
            from: fromD ? fromD.toISOString().slice(0, 10) : null,
            to: toD ? toD.toISOString().slice(0, 10) : null,
            closed_won_count: windowStats.closed_won_count,
            closed_won_value: windowStats.closed_won_value,
            closed_lost_count: windowStats.closed_lost_count,
            closed_lost_value: windowStats.closed_lost_value,
          }
        : null,
  };
}

module.exports = {
  baseWhere,
  getClosedWonLostLifetime,
  getClosedWonLostInRange,
  getClosedWonLostForMonth,
  getClosedWonByMonth,
  getRevenueSummary,
  parseYmd,
};
