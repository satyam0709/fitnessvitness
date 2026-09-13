"use strict";

const prisma = require("../config/prisma");

function money(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "bigint") {
    return Math.round(Number(v) * 100) / 100;
  }
  if (typeof v === "object") {
    if (typeof v.toNumber === "function") {
      const n = v.toNumber();
      if (Number.isFinite(n)) return Math.round(n * 100) / 100;
    }
    if (typeof v.toString === "function" && v.toString !== Object.prototype.toString) {
      const n = Number(String(v.toString()).replace(/,/g, ""));
      if (Number.isFinite(n)) return Math.round(n * 100) / 100;
    }
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isoDate(v) {
  if (v == null || v === "") return new Date().toISOString().slice(0, 10);
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function parseLineItems(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function invoiceTotal(row) {
  const stored = money(row?.total);
  if (stored > 0.001) return stored;
  const lines = parseLineItems(row?.line_items_json ?? row?.line_items);
  if (!lines.length) return stored;
  return money(
    lines.reduce((sum, l) => {
      if (l?.total != null && l.total !== "") return sum + money(l.total);
      if (l?.subtotal != null && l.subtotal !== "") return sum + money(l.subtotal) + money(l.tax);
      return sum + money((Number(l?.cost) || 0) * (Number(l?.qty) || 0));
    }, 0)
  );
}

function gstTypeLabel(mode) {
  const m = String(mode || "none").toLowerCase();
  if (m === "none" || !m) return "Non GST";
  if (m === "igst") return "IGST";
  if (m === "sgst_cgst") return "GST";
  return "GST";
}

function enrichInvoiceRow(row, paidOverride) {
  if (!row) return null;
  const total = invoiceTotal(row);
  const paid = paidOverride != null ? money(paidOverride) : money(row.amount_paid);
  const due = Math.max(0, money(total - paid));
  return {
    ...row,
    total,
    amount_paid: paid,
    due_amount: due,
    gst_type: gstTypeLabel(row.gst_mode),
    payment_status: due <= 0 && total > 0 ? "paid" : paid > 0 ? "partial" : row.status,
  };
}

async function findInvoice(invoiceId) {
  const id = Number(invoiceId);
  if (!Number.isFinite(id) || id < 1) return null;
  return prisma.invoices.findFirst({ where: { id, is_deleted: false } });
}

async function listPayments(invoiceId) {
  const id = Number(invoiceId);
  return prisma.invoice_payments.findMany({
    where: { invoice_id: id, is_deleted: false },
    orderBy: [{ payment_date: "desc" }, { id: "desc" }],
  });
}

async function sumPaid(invoiceId) {
  const id = Number(invoiceId);
  const agg = await prisma.invoice_payments.aggregate({
    where: { invoice_id: id, is_deleted: false },
    _sum: { amount: true },
  });
  return money(agg?._sum?.amount);
}

async function sumPaidForIds(ids) {
  const unique = [...new Set((ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!unique.length) return new Map();
  const rows = await prisma.invoice_payments.groupBy({
    by: ["invoice_id"],
    where: { invoice_id: { in: unique }, is_deleted: false },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.invoice_id, money(r._sum?.amount)]));
}

async function enrichInvoiceRowLive(row) {
  if (!row) return null;
  const paid = await sumPaid(row.id);
  return enrichInvoiceRow(row, paid);
}

async function recomputePaid(invoiceId) {
  const inv = await findInvoice(invoiceId);
  if (!inv) return null;
  const paid = await sumPaid(invoiceId);
  const total = invoiceTotal(inv);
  const due = Math.max(0, money(total - paid));
  let status = inv.status;
  if (String(status) !== "cancelled") {
    if (due <= 0 && total > 0) status = "paid";
    else if (paid > 0 && String(status) === "paid") status = "sent";
  }
  await prisma.invoices.update({
    where: { id: Number(invoiceId) },
    data: { amount_paid: paid, status: String(status), updated_at: new Date() },
  });
  return enrichInvoiceRow({ ...inv, amount_paid: paid, status, total }, paid);
}

async function addPayment(invoiceId, { payment_date, method, amount, note, created_by }) {
  const inv = await findInvoice(invoiceId);
  if (!inv) {
    const err = new Error("Invoice not found");
    err.status = 404;
    throw err;
  }
  const paid = await sumPaid(invoiceId);
  const due = Math.max(0, money(invoiceTotal(inv) - paid));
  const amt = money(amount);
  if (amt <= 0) {
    const err = new Error("Payment amount must be greater than 0");
    err.status = 400;
    throw err;
  }
  if (amt > due + 0.001) {
    const err = new Error(`Amount exceeds due (${due.toFixed(2)})`);
    err.status = 400;
    throw err;
  }
  const dateStr = isoDate(payment_date);
  const meth = String(method || "").trim().slice(0, 80);
  if (!meth) {
    const err = new Error("Payment method is required");
    err.status = 400;
    throw err;
  }
  await prisma.invoice_payments.create({
    data: {
      invoice_id: Number(invoiceId),
      payment_date: new Date(dateStr),
      method: meth,
      amount: amt,
      note: note ? String(note).slice(0, 2000) : null,
      created_by: created_by || null,
    },
  });
  const updated = await recomputePaid(invoiceId);
  const payments = await listPayments(invoiceId);
  return { invoice: updated, payments };
}

async function updatePayment(invoiceId, paymentId, patch) {
  const iid = Number(invoiceId);
  const pid = Number(paymentId);
  const existing = await prisma.invoice_payments.findFirst({
    where: { id: pid, invoice_id: iid, is_deleted: false },
  });
  if (!existing) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }
  const inv = await findInvoice(invoiceId);
  if (!inv) {
    const err = new Error("Invoice not found");
    err.status = 404;
    throw err;
  }
  const othersPaid = money((await sumPaid(invoiceId)) - money(existing.amount));
  const dueIfZero = Math.max(0, money(invoiceTotal(inv) - othersPaid));
  const amt = patch.amount !== undefined ? money(patch.amount) : money(existing.amount);
  if (amt <= 0) {
    const err = new Error("Payment amount must be greater than 0");
    err.status = 400;
    throw err;
  }
  if (amt > dueIfZero + 0.001) {
    const err = new Error(`Amount exceeds due (${dueIfZero.toFixed(2)})`);
    err.status = 400;
    throw err;
  }
  const meth =
    patch.method !== undefined ? String(patch.method || "").trim().slice(0, 80) : existing.method;
  const dateStr =
    patch.payment_date !== undefined ? isoDate(patch.payment_date) : isoDate(existing.payment_date);
  const note =
    patch.note !== undefined
      ? patch.note == null
        ? null
        : String(patch.note).slice(0, 2000)
      : existing.note;

  await prisma.invoice_payments.update({
    where: { id: pid },
    data: {
      payment_date: new Date(dateStr),
      method: meth,
      amount: amt,
      note,
      updated_at: new Date(),
    },
  });
  const updated = await recomputePaid(invoiceId);
  const payments = await listPayments(invoiceId);
  return { invoice: updated, payments };
}

async function markInvoicePaid(invoiceId, { payment_date, method, note, created_by } = {}) {
  const inv = await findInvoice(invoiceId);
  if (!inv) {
    const err = new Error("Invoice not found");
    err.status = 404;
    throw err;
  }
  if (String(inv.status) === "cancelled") {
    const err = new Error("Cancelled invoices cannot be marked paid");
    err.status = 400;
    throw err;
  }
  const paid = await sumPaid(invoiceId);
  const due = Math.max(0, money(invoiceTotal(inv) - paid));
  if (due > 0.001) {
    return addPayment(invoiceId, {
      payment_date,
      method: method || "Other",
      amount: due,
      note: note || "Converted to paid",
      created_by,
    });
  }
  const updated = await recomputePaid(invoiceId);
  const payments = await listPayments(invoiceId);
  return { invoice: updated, payments };
}

module.exports = {
  money,
  isoDate,
  gstTypeLabel,
  enrichInvoiceRow,
  enrichInvoiceRowLive,
  invoiceTotal,
  parseLineItems,
  findInvoice,
  listPayments,
  sumPaid,
  sumPaidForIds,
  recomputePaid,
  addPayment,
  updatePayment,
  markInvoicePaid,
};
