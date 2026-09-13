"use strict";

const prisma = require("../config/prisma");

const FIELD = "invoice_payment_method";

const DEFAULT_METHODS = [
  "Cash",
  "UPI",
  "Google Pay",
  "Bank Transfer",
  "Cheque",
  "Card",
  "Other",
];

function methodName(raw) {
  return String(raw || "").trim().slice(0, 100);
}

function toRow(r) {
  return {
    id: r.id,
    method: r.option_label || r.option_value,
    value: r.option_value,
  };
}

async function ensureDefaults() {
  const count = await prisma.dropdown_options.count({
    where: { field_name: FIELD },
  });
  if (count > 0) return;
  await prisma.dropdown_options.createMany({
    data: DEFAULT_METHODS.map((name) => ({
      field_name: FIELD,
      option_value: name,
      option_label: name,
    })),
    skipDuplicates: true,
  });
}

async function listPaymentMethods() {
  await ensureDefaults();
  const rows = await prisma.dropdown_options.findMany({
    where: { field_name: FIELD },
    orderBy: { id: "asc" },
    select: { id: true, option_value: true, option_label: true },
  });
  return rows.map(toRow);
}

async function createPaymentMethod(rawName) {
  const name = methodName(rawName);
  if (!name) {
    const err = new Error("Method name is required");
    err.status = 400;
    throw err;
  }
  const rows = await prisma.dropdown_options.findMany({
    where: { field_name: FIELD },
    select: { id: true, option_value: true, option_label: true },
  });
  const lower = name.toLowerCase();
  const dup = rows.find(
    (r) =>
      String(r.option_value || "").toLowerCase() === lower ||
      String(r.option_label || "").toLowerCase() === lower
  );
  if (dup) {
    const err = new Error("This payment method already exists");
    err.status = 400;
    throw err;
  }
  const created = await prisma.dropdown_options.create({
    data: {
      field_name: FIELD,
      option_value: name,
      option_label: name,
    },
  });
  return toRow(created);
}

async function updatePaymentMethod(id, rawName) {
  const name = methodName(rawName);
  if (!name) {
    const err = new Error("Method name is required");
    err.status = 400;
    throw err;
  }
  const existing = await prisma.dropdown_options.findFirst({
    where: { id, field_name: FIELD },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  const rows = await prisma.dropdown_options.findMany({
    where: { field_name: FIELD },
    select: { id: true, option_value: true, option_label: true },
  });
  const lower = name.toLowerCase();
  const dup = rows.find(
    (r) =>
      r.id !== id &&
      (String(r.option_value || "").toLowerCase() === lower ||
        String(r.option_label || "").toLowerCase() === lower)
  );
  if (dup) {
    const err = new Error("This payment method already exists");
    err.status = 400;
    throw err;
  }
  const updated = await prisma.dropdown_options.update({
    where: { id },
    data: { option_value: name, option_label: name },
  });
  return toRow(updated);
}

async function deletePaymentMethod(id) {
  const existing = await prisma.dropdown_options.findFirst({
    where: { id, field_name: FIELD },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  await prisma.dropdown_options.delete({ where: { id } });
  return { ok: true };
}

module.exports = {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
};
