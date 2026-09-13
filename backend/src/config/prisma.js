require("dotenv").config();
const { ensureDatabaseUrl } = require("./ensureDatabaseUrl");

// Must run before PrismaClient reads env("DATABASE_URL")
ensureDatabaseUrl();

const { PrismaClient } = require("../generated/prisma");

/** Recursively remove `undefined` so Prisma never binds it into SQL. */
function omitUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : omitUndefinedDeep(item)));
  }
  // Prisma Decimal / other objects with custom prototype — leave as-is
  const ctor = value.constructor?.name;
  if (ctor && ctor !== "Object") return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = omitUndefinedDeep(v);
  }
  return out;
}

function sanitizeQueryArgs(args) {
  if (args == null) return args;
  if (Array.isArray(args)) {
    // $executeRaw / $queryRaw template values
    return args.map((v) => (v === undefined ? null : omitUndefinedDeep(v)));
  }
  if (typeof args === "object" && args !== null) {
    // Preserve Prisma Sql objects by duck typing (they always have .strings and .values arrays)
    if (Array.isArray(args.strings) && Array.isArray(args.values)) {
      args.values = args.values.map((v) => (v === undefined ? null : v));
      return args;
    }
    
    // Prisma may pass { values: [...] } for raw queries
    if (Array.isArray(args.values)) {
      return {
        ...omitUndefinedDeep(args),
        values: args.values.map((v) => (v === undefined ? null : v)),
      };
    }
    return omitUndefinedDeep(args);
  }
  return args === undefined ? null : args;
}

const globalForPrisma = globalThis;

const basePrisma =
  globalForPrisma.__fitnessPrisma ||
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__fitnessPrisma = basePrisma;
}

function disconnectPrisma() {
  return basePrisma.$disconnect().catch(() => {});
}

if (!globalForPrisma.__fitnessPrismaShutdownBound) {
  globalForPrisma.__fitnessPrismaShutdownBound = true;
  process.once("beforeExit", () => {
    disconnectPrisma();
  });
  process.once("SIGINT", () => {
    disconnectPrisma().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    disconnectPrisma().finally(() => process.exit(0));
  });
  process.once("SIGUSR2", () => {
    disconnectPrisma().finally(() => process.kill(process.pid, "SIGUSR2"));
  });
}

const prisma = basePrisma.$extends({
  query: {
    $allOperations({ args, query }) {
      return query(sanitizeQueryArgs(args));
    },
  },
});

// Default export is the client. Also expose `.prisma` so
// `const { prisma } = require(...)` does not silently get undefined.
module.exports = prisma;
module.exports.prisma = prisma;
module.exports.omitUndefinedDeep = omitUndefinedDeep;
module.exports.disconnectPrisma = disconnectPrisma;
module.exports.__leadBindFix = "2026-07-14-bind-null-v3";
