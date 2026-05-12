const { mainPool } = require("../config/database");

function sym(currency) {
  return currency === "USD" ? "$" : "₹";
}

function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === "USD") return `$${n}`;
  return `₹${n}`;
}

function normalizeFeatures(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Stripe smallest units: INR paise, USD cents.
 */
function stripeUnitAmount(priceMajor, currency) {
  const c = String(currency || "INR").toUpperCase();
  const n = Number(priceMajor) || 0;
  if (c === "USD") return Math.round(n * 100);
  return Math.round(n * 100);
}

async function seedSubscriptionCatalogIfEmpty() {
  const [[{ pc }]] = await mainPool.execute("SELECT COUNT(*) AS pc FROM subscription_packages");
  if (Number(pc) > 0) return;

  const goldFeatures = [
    { key: "lead_management", label: "Lead Management", included: true },
    { key: "task_management", label: "Task Management", included: true },
    { key: "reminders_meetings", label: "Reminders & Meetings", included: true },
    { key: "notes_calendar", label: "Notes & Calendar", included: true },
    { key: "customer_management", label: "Customer Management", included: true },
    { key: "basic_reports", label: "Basic Reports", included: true },
    { key: "invoice_management", label: "Invoice Management", included: false },
    { key: "hr_management", label: "HR Management", included: false },
    { key: "hr_operations_payroll", label: "HR Operations (Payroll)", included: false },
    { key: "advanced_analytics", label: "Advanced Analytics", included: false },
  ];
  const diamondFeatures = [
    { key: "lead_management", label: "Lead Management", included: true },
    { key: "task_management", label: "Task Management", included: true },
    { key: "reminders_meetings", label: "Reminders & Meetings", included: true },
    { key: "notes_calendar", label: "Notes & Calendar", included: true },
    { key: "customer_management", label: "Customer Management", included: true },
    { key: "advanced_reports", label: "Advanced Reports", included: true },
    { key: "invoice_management", label: "Invoice Management", included: true },
    { key: "hr_management", label: "HR Management", included: false },
    { key: "hr_operations_payroll", label: "HR Operations (Payroll)", included: false },
    { key: "advanced_analytics", label: "Advanced Analytics", included: false },
  ];
  const platinumFeatures = [
    { key: "lead_management", label: "Lead Management", included: true },
    { key: "task_management", label: "Task Management", included: true },
    { key: "reminders_meetings", label: "Reminders & Meetings", included: true },
    { key: "notes_calendar", label: "Notes & Calendar", included: true },
    { key: "customer_management", label: "Customer Management", included: true },
    { key: "advanced_reports", label: "Advanced Reports", included: true },
    { key: "invoice_management", label: "Invoice Management", included: true },
    { key: "hr_management", label: "HR Management", included: true },
    { key: "hr_operations_payroll", label: "HR Operations (Payroll)", included: true },
    { key: "advanced_analytics", label: "Advanced Analytics", included: true },
  ];

  const packages = [
    ["gold", "Gold", "Annual Gold plan", 2750, 33, 3, "Year", JSON.stringify(goldFeatures), 10],
    ["diamond", "Diamond", "Annual Diamond plan", 4350, 52, 5, "Year", JSON.stringify(diamondFeatures), 20],
    ["platinum", "Platinum", "Annual Platinum plan", 7800, 94, 8, "Year", JSON.stringify(platinumFeatures), 30],
  ];

  for (const row of packages) {
    await mainPool.execute(
      `INSERT INTO subscription_packages
        (slug, name, description, price_inr, price_usd, staff_seats, billing_period, features_json, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 1)`,
      row
    );
  }

  const addons = [
    ["accounting", "Accounting", "Per Branch For 1 Month", 2500, 30, "fas fa-calculator", 20],
    ["indiamart", "India Mart", "For 1 Month", 1000, 12, "fas fa-store", 30],
    ["tradeindia", "Trade India", "For 1 Month", 1000, 12, "fas fa-handshake", 40],
    ["justdial", "Just Dial", "For 1 Month", 1000, 12, "fas fa-phone-alt", 50],
    ["whatsapp", "WhatsApp", "Per Number For 1 Month", 1500, 18, "fab fa-whatsapp", 60],
    ["sms", "SMS Gateway", "For 1 Month", 500, 6, "fas fa-sms", 70],
    ["email", "Email Campaign", "For 1 Month", 800, 10, "fas fa-envelope", 80],
  ];

  for (const row of addons) {
    await mainPool.execute(
      `INSERT INTO subscription_addons
        (slug, name, period_label, price_inr, price_usd, icon, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      row
    );
  }

  console.log("Seeded subscription_packages and subscription_addons defaults.");
}

async function fetchPackagesForAdmin() {
  const [rows] = await mainPool.execute(
    `SELECT id, slug, name, description, price_inr, price_usd, staff_seats, billing_period,
            features_json, sort_order, is_active, created_at, updated_at
     FROM subscription_packages
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map((r) => ({
    ...r,
    features: normalizeFeatures(r.features_json),
  }));
}

async function fetchAddonsForAdmin() {
  const [rows] = await mainPool.execute(
    `SELECT id, slug, name, period_label, price_inr, price_usd, icon, sort_order, is_active, created_at, updated_at
     FROM subscription_addons
     WHERE slug <> 'staff'
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function fetchActivePackages() {
  const [rows] = await mainPool.execute(
    `SELECT slug, name, description, price_inr, price_usd, staff_seats, billing_period, features_json, sort_order
     FROM subscription_packages
     WHERE is_active = 1
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function fetchActiveAddons() {
  const [rows] = await mainPool.execute(
    `SELECT slug, name, period_label, price_inr, price_usd, icon, sort_order
     FROM subscription_addons
     WHERE is_active = 1
       AND slug <> 'staff'
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

function formatPlanClient(row, currency) {
  const c = currency === "USD" ? "USD" : "INR";
  const priceRaw = c === "USD" ? Number(row.price_usd) : Number(row.price_inr);
  return {
    id: row.slug,
    name: row.name,
    priceRaw,
    price: formatMoney(priceRaw, c),
    period: row.billing_period || "Year",
    staff: Number(row.staff_seats) || 0,
    features: normalizeFeatures(row.features_json),
  };
}

function formatAddonClient(row, currency) {
  const c = currency === "USD" ? "USD" : "INR";
  const priceRaw = c === "USD" ? Number(row.price_usd) : Number(row.price_inr);
  return {
    id: row.slug,
    name: row.name,
    period: row.period_label || "",
    price: formatMoney(priceRaw, c),
    priceRaw,
    icon: row.icon || "fas fa-circle",
  };
}

async function buildPublicCatalog(currency) {
  const c = String(currency || "INR").toUpperCase() === "USD" ? "USD" : "INR";
  const [pRows, aRows] = await Promise.all([fetchActivePackages(), fetchActiveAddons()]);
  return {
    currency: c,
    plans: pRows.map((r) => formatPlanClient(r, c)),
    addons: aRows.map((r) => formatAddonClient(r, c)),
  };
}

/**
 * Resolve Stripe line item for a plan. Match by display name or slug (case-insensitive).
 */
async function getStripePlanLineItem(packageName, packagePriceFallback, currency) {
  const curr = String(currency || "INR").toUpperCase();
  const name = String(packageName || "").trim();
  if (!name) return null;

  const [rows] = await mainPool.execute(
    `SELECT name, slug, price_inr, price_usd
     FROM subscription_packages
     WHERE is_active = 1
       AND (LOWER(name) = LOWER(?) OR LOWER(slug) = LOWER(?))
     LIMIT 1`,
    [name, name]
  );

  if (rows.length > 0) {
    const r = rows[0];
    const major = curr === "USD" ? Number(r.price_usd) : Number(r.price_inr);
    const unit_amount = stripeUnitAmount(major, curr);
    const stripeCurrency = curr === "USD" ? "usd" : "inr";
    return {
      unit_amount,
      stripeCurrency,
      displayName: r.name,
    };
  }

  const cleaned = Math.round(
    parseFloat(String(packagePriceFallback || 0).replace(/[₹$,]/g, "")) * 100
  );
  if (cleaned > 0) {
    return {
      unit_amount: cleaned,
      stripeCurrency: curr === "USD" ? "usd" : "inr",
      displayName: name,
    };
  }
  return null;
}

async function resolveTrialPlanBySlug(planId) {
  const slug = String(planId || "").toLowerCase().trim();
  if (!slug) return null;
  const [rows] = await mainPool.execute(
    `SELECT slug, name FROM subscription_packages WHERE is_active = 1 AND LOWER(slug) = ? LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

module.exports = {
  seedSubscriptionCatalogIfEmpty,
  fetchPackagesForAdmin,
  fetchAddonsForAdmin,
  fetchActivePackages,
  fetchActiveAddons,
  buildPublicCatalog,
  getStripePlanLineItem,
  resolveTrialPlanBySlug,
  normalizeFeatures,
  sym,
  formatMoney,
};
