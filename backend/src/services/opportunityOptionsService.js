"use strict";

const OPPORTUNITY_OPTION_FIELDS = new Set([
  "product_category",
  "followup_type",
  "opportunity_type",
  "source",
]);

const DEFAULT_OPTIONS = {
  product_category: [
    "initial_consultation",
    "follow_up",
    "membership_or_program",
    "personal_training",
    "nutrition_or_supplements",
    "general_inquiry",
    "other",
  ],
  followup_type: ["call", "email", "meeting", "whatsapp", "demo", "other"],
  opportunity_type: ["new_business", "upsell", "renewal", "cross_sell", "other"],
  source: [
    "website",
    "referral",
    "social_media",
    "email_campaign",
    "cold_call",
    "walk_in",
    "partner",
    "other",
  ],
};

const DISTINCT_COLUMNS = {
  product_category: "product_category",
  followup_type: "followup_type",
  opportunity_type: "opportunity_type",
  source: "lead_source",
};

function emptyOptionsPayload() {
  return {
    product_category: [],
    followup_type: [],
    opportunity_type: [],
    source: [],
  };
}

function resolveFieldName(raw) {
  const field = String(raw || "").trim();
  if (field === "lead_source") return "source";
  return field;
}

function normalizeOpportunityOptionValue(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseOpportunityOptionValue(raw, { allowEmpty = true } = {}) {
  if (raw == null || String(raw).trim() === "") {
    if (allowEmpty) return null;
    const err = new Error("Value is required");
    err.status = 400;
    throw err;
  }
  return normalizeOpportunityOptionValue(raw);
}

function isDefaultOption(fieldName, value) {
  const field = resolveFieldName(fieldName);
  const val = normalizeOpportunityOptionValue(value);
  return (DEFAULT_OPTIONS[field] || []).includes(val);
}

function assertField(fieldName) {
  const field = resolveFieldName(fieldName);
  if (!OPPORTUNITY_OPTION_FIELDS.has(field) || !DISTINCT_COLUMNS[field]) {
    const err = new Error("Invalid custom field name");
    err.status = 400;
    throw err;
  }
  return field;
}

function pushUnique(list, value, label) {
  const val = String(value || "").trim();
  if (!val) return;
  const key = val.toLowerCase();
  if (list.some((opt) => String(opt.value).toLowerCase() === key)) return;
  list.push({ value: val, label: label || val });
}

function optionColumn(field) {
  return DISTINCT_COLUMNS[resolveFieldName(field)];
}

async function registerOpportunityOptionIfNeeded(prisma, fieldName, value) {
  if (!prisma) return;
  const parsed = parseOpportunityOptionValue(value, { allowEmpty: true });
  if (!parsed) return;
  const field = resolveFieldName(fieldName);
  if (!OPPORTUNITY_OPTION_FIELDS.has(field)) return;
  if (isDefaultOption(field, parsed)) return;
  try {
    await prisma.dropdown_options.upsert({
      where: {
        field_name_option_value: { field_name: field, option_value: parsed },
      },
      update: {},
      create: {
        field_name: field,
        option_value: parsed,
        option_label: parsed,
      },
    });
  } catch (err) {
    console.error(`Error registering opportunity option for ${field}:`, err.message);
  }
}

async function listOpportunityCustomOptions(prisma) {
  const data = emptyOptionsPayload();
  if (!prisma) return data;

  const rows = await prisma.dropdown_options.findMany({
    where: { field_name: { in: [...OPPORTUNITY_OPTION_FIELDS] } },
    orderBy: [{ field_name: "asc" }, { option_value: "asc" }],
    select: { field_name: true, option_value: true, option_label: true },
  });

  for (const row of rows) {
    if (!data[row.field_name]) continue;
    if (isDefaultOption(row.field_name, row.option_value)) continue;
    pushUnique(data[row.field_name], row.option_value, row.option_label);
  }

  for (const [field, column] of Object.entries(DISTINCT_COLUMNS)) {
    const used = await prisma.opportunities.findMany({
      where: {
        is_deleted: false,
        AND: [{ [column]: { not: null } }, { [column]: { not: "" } }],
      },
      distinct: [column],
      select: { [column]: true },
    });
    for (const row of used) {
      const val = String(row[column] || "").trim();
      if (!val || isDefaultOption(field, val)) continue;
      pushUnique(data[field], val, val);
      await registerOpportunityOptionIfNeeded(prisma, field, val);
    }
  }

  return data;
}

async function addOpportunityOption(prisma, fieldName, value, label) {
  if (!prisma) throw new Error("Prisma client is required");
  const field = assertField(fieldName);
  const val = parseOpportunityOptionValue(value, { allowEmpty: false });
  const lbl = String(label || value || val).trim() || val;

  if (isDefaultOption(field, val)) {
    const err = new Error("Option already exists");
    err.status = 409;
    throw err;
  }

  const existing = await prisma.dropdown_options.findFirst({
    where: { field_name: field, option_value: val },
  });
  if (existing) {
    const err = new Error("Option already exists");
    err.status = 409;
    throw err;
  }

  try {
    await prisma.dropdown_options.create({
      data: {
        field_name: field,
        option_value: val,
        option_label: lbl,
      },
    });
  } catch (err) {
    const duplicate = err.code === "P2002" || /duplicate/i.test(String(err.message || ""));
    if (duplicate) {
      const exists = new Error("Option already exists");
      exists.status = 409;
      throw exists;
    }
    throw err;
  }
  return { success: true };
}

async function getOpportunityOptionUsage(prisma, fieldName, optionValue) {
  if (!prisma) throw new Error("Prisma client is required");
  const field = assertField(fieldName);
  const optVal = String(optionValue || "").trim();
  if (!optVal) {
    const err = new Error("fieldName and optionValue are required");
    err.status = 400;
    throw err;
  }
  const column = optionColumn(field);
  const total = await prisma.opportunities.count({
    where: { is_deleted: false, [column]: optVal },
  });
  return {
    total,
    byTable: total > 0 ? { opportunities: total } : {},
    fieldName: field,
    optionValue: optVal,
  };
}

async function renameOpportunityOption(prisma, fieldName, oldValue, newValue) {
  if (!prisma) throw new Error("Prisma client is required");
  const field = assertField(fieldName);
  const oldVal = String(oldValue || "").trim();
  const newVal = parseOpportunityOptionValue(newValue, { allowEmpty: false });
  if (!oldVal) {
    const err = new Error("fieldName, oldValue, and newValue are required");
    err.status = 400;
    throw err;
  }
  if (oldVal === newVal) return { success: true, message: "No change detected" };

  const column = optionColumn(field);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.dropdown_options.findFirst({
      where: { field_name: field, option_value: oldVal },
    });
    if (!existing) {
      const err = new Error(`Custom option "${oldVal}" not found`);
      err.status = 404;
      throw err;
    }

    const duplicate = await tx.dropdown_options.findFirst({
      where: { field_name: field, option_value: newVal },
    });
    const mergesIntoDefault = isDefaultOption(field, newVal);

    if (duplicate || mergesIntoDefault) {
      await tx.dropdown_options.delete({ where: { id: existing.id } });
    } else {
      await tx.dropdown_options.update({
        where: { id: existing.id },
        data: { option_value: newVal, option_label: newVal },
      });
    }

    await tx.opportunities.updateMany({
      where: { is_deleted: false, [column]: oldVal },
      data: { [column]: newVal, updated_at: new Date() },
    });

    return { success: true, merged: Boolean(duplicate || mergesIntoDefault) };
  });
}

async function deleteOpportunityOption(prisma, fieldName, optionValue, options = {}) {
  if (!prisma) throw new Error("Prisma client is required");
  const field = assertField(fieldName);
  const optVal = String(optionValue || "").trim();
  const transferVal = options.transferTo != null ? String(options.transferTo).trim() : "";
  if (!optVal) {
    const err = new Error("fieldName and optionValue are required");
    err.status = 400;
    throw err;
  }

  const column = optionColumn(field);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.dropdown_options.findFirst({
      where: { field_name: field, option_value: optVal },
    });
    if (!existing) {
      const err = new Error(`Custom option "${optVal}" not found`);
      err.status = 404;
      throw err;
    }

    const usageCount = await tx.opportunities.count({
      where: { is_deleted: false, [column]: optVal },
    });

    if (usageCount > 0) {
      if (!transferVal) {
        const err = new Error("transferTo is required when records use this option");
        err.status = 400;
        err.code = "TRANSFER_REQUIRED";
        err.usage = {
          total: usageCount,
          byTable: { opportunities: usageCount },
          fieldName: field,
          optionValue: optVal,
        };
        throw err;
      }
      if (transferVal === optVal) {
        const err = new Error("transferTo must differ from the option being removed");
        err.status = 400;
        throw err;
      }
      await tx.opportunities.updateMany({
        where: { is_deleted: false, [column]: optVal },
        data: { [column]: transferVal, updated_at: new Date() },
      });
    }

    await tx.dropdown_options.delete({ where: { id: existing.id } });

    return {
      success: true,
      transferred: usageCount > 0,
      transferTo: usageCount > 0 ? transferVal : null,
      usage: {
        total: usageCount,
        byTable: usageCount > 0 ? { opportunities: usageCount } : {},
      },
      message:
        usageCount > 0
          ? `Option "${optVal}" removed; ${usageCount} record(s) transferred to "${transferVal}".`
          : `Option "${optVal}" removed successfully.`,
    };
  });
}

module.exports = {
  OPPORTUNITY_OPTION_FIELDS,
  DEFAULT_OPTIONS,
  parseOpportunityOptionValue,
  registerOpportunityOptionIfNeeded,
  listOpportunityCustomOptions,
  addOpportunityOption,
  getOpportunityOptionUsage,
  renameOpportunityOption,
  deleteOpportunityOption,
};
