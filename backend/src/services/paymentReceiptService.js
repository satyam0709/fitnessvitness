const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const { emitInvoicesChanged } = require("../realtime/meetingsRealtime");
const { ensureInvoicesTable } = require("../config/ensureSchema");

const SOURCE_COLLECTION_PAYMENT = "collection_payment";
const SOURCE_FITNESS_TRANSACTION = "fitness_transaction";

function formatIsoDate(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dateStr = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dateStr}`;
}

function toDateOnly(isoYmd) {
  return new Date(`${isoYmd}T00:00:00.000Z`);
}

async function findExistingReceipt(sourceType, sourceId) {
  const row = await prisma.invoices.findFirst({
    where: {
      source_type: sourceType,
      source_id: Number(sourceId),
      is_deleted: false,
    },
    select: { id: true, invoice_number: true },
  });
  return row || null;
}

async function nextReceiptNumber() {
  const year = new Date().getFullYear();
  const cnt = await prisma.invoices.count({
    where: {
      invoice_number: { startsWith: `RCP-${year}-` },
    },
  });
  return `RCP-${year}-${String(cnt + 1).padStart(4, "0")}`;
}

async function insertReceiptInvoice({
  userId,
  customerName,
  customerEmail,
  customerPhone,
  invoiceDate,
  subtotal,
  tax,
  total,
  notes,
  lineItems,
  paymentMeta,
  sourceType,
  sourceId,
}) {
  await ensureInvoicesTable();
  const invoiceNumber = await nextReceiptNumber();
  const invoiceDateIso = formatIsoDate(invoiceDate);

  const created = await prisma.invoices.create({
    data: {
      invoice_number: invoiceNumber,
      type: "sales",
      customer_name: customerName || null,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      vendor_name: null,
      invoice_date: toDateOnly(invoiceDateIso),
      due_date: null,
      subtotal: new Prisma.Decimal(subtotal ?? 0),
      tax: new Prisma.Decimal(tax || 0),
      total: new Prisma.Decimal(total ?? 0),
      status: "paid",
      notes: notes || null,
      created_by: userId,
      gst_mode: "none",
      currency: "INR",
      line_items_json: lineItems || [],
      payment_meta_json: paymentMeta || null,
      source_type: sourceType || null,
      source_id: sourceId != null ? Number(sourceId) : null,
    },
    select: { id: true, invoice_number: true },
  });

  emitInvoicesChanged({ action: "receipt_created", id: created.id });
  return { id: created.id, invoice_number: created.invoice_number };
}

async function resolveCollectionParty(col) {
  let customerName = null;
  let customerPhone = null;
  let customerEmail = null;

  if (col.client_id) {
    const client = await prisma.fitness_clients.findFirst({
      where: { client_id: String(col.client_id) },
      select: { full_name: true, phone: true, email: true },
    });
    if (client) {
      customerName = client.full_name || col.client_id;
      customerPhone = client.phone || null;
      customerEmail = client.email || null;
    } else {
      customerName = col.client_name || col.client_id;
    }
  } else if (col.external_buyer_id) {
    const buyer = await prisma.fitness_external_buyers.findFirst({
      where: { id: Number(col.external_buyer_id) },
      select: { full_name: true, phone: true },
    });
    customerName = buyer?.full_name || col.external_buyer_name || "Walk-in customer";
    customerPhone = buyer?.phone || null;
  } else {
    customerName = col.client_name || col.external_buyer_name || "Customer";
  }

  return { customerName, customerPhone, customerEmail };
}

/**
 * Payment receipt for a single fitness_collection_payments row.
 */
async function createReceiptForCollectionPayment(paymentId, userId) {
  const pid = Number(paymentId);
  const uid = Number(userId);
  if (!Number.isFinite(pid) || pid < 1 || !Number.isFinite(uid) || uid < 1) return null;

  const existing = await findExistingReceipt(SOURCE_COLLECTION_PAYMENT, pid);
  if (existing) return existing;

  const payment = await prisma.fitness_collection_payments.findFirst({
    where: { id: pid },
    include: {
      fitness_collections: true,
    },
  });
  if (!payment?.fitness_collections) return null;

  const col = payment.fitness_collections;
  let clientName = null;
  let externalBuyerName = null;
  if (col.client_id) {
    const client = await prisma.fitness_clients.findFirst({
      where: { client_id: String(col.client_id) },
      select: { full_name: true },
    });
    clientName = client?.full_name || null;
  }
  if (col.external_buyer_id) {
    const buyer = await prisma.fitness_external_buyers.findFirst({
      where: { id: Number(col.external_buyer_id) },
      select: { full_name: true },
    });
    externalBuyerName = buyer?.full_name || null;
  }

  const amount = Number(payment.amount_inr) || 0;
  if (amount <= 0) return null;

  const party = await resolveCollectionParty({
    ...col,
    client_name: clientName,
    external_buyer_name: externalBuyerName,
  });
  const paidAt = formatIsoDate(payment.paid_at);

  const lineItems = [
    {
      product_name: col.title || "Payment",
      qty: 1,
      cost: amount,
      discount: 0,
      discount_type: "percent",
      subtotal: amount,
    },
  ];

  const paymentMeta = {
    receipt_kind: SOURCE_COLLECTION_PAYMENT,
    collection_id: col.id,
    payment_id: pid,
    pay_mode: payment.pay_mode,
    paid_at: paidAt,
    collection_type: col.collection_type,
    collection_status: col.status,
    client_id: col.client_id,
    collection_total_inr: Number(col.total_inr),
    collection_received_inr: Number(col.received_inr),
    collection_pending_inr: Number(col.pending_inr),
  };

  const notes = `Payment receipt — ${col.title || "Collection"} (#${col.id}). Paid via ${payment.pay_mode || "—"} on ${paidAt}.`;

  return insertReceiptInvoice({
    userId: uid,
    customerName: party.customerName,
    customerEmail: party.customerEmail,
    customerPhone: party.customerPhone,
    invoiceDate: paidAt,
    subtotal: amount,
    tax: 0,
    total: amount,
    notes,
    lineItems,
    paymentMeta,
    sourceType: SOURCE_COLLECTION_PAYMENT,
    sourceId: pid,
  });
}

/**
 * Receipt when recording payment on a fitness transaction directly.
 */
async function createReceiptForFitnessTransaction(transactionId, userId) {
  const txId = Number(transactionId);
  const uid = Number(userId);
  if (!Number.isFinite(txId) || txId < 1 || !Number.isFinite(uid) || uid < 1) return null;

  const existing = await findExistingReceipt(SOURCE_FITNESS_TRANSACTION, txId);
  if (existing) return existing;

  const tx = await prisma.fitness_transactions.findFirst({
    where: { id: txId },
    include: {
      fitness_external_buyers: {
        select: { full_name: true, phone: true },
      },
    },
  });
  if (!tx) return null;

  let clientName = null;
  let clientPhone = null;
  let clientEmail = null;
  if (tx.client_id) {
    const client = await prisma.fitness_clients.findFirst({
      where: { client_id: String(tx.client_id) },
      select: { full_name: true, phone: true, email: true },
    });
    clientName = client?.full_name || null;
    clientPhone = client?.phone || null;
    clientEmail = client?.email || null;
  }

  const amount = Number(tx.received_inr) || 0;
  if (amount <= 0) return null;

  const customerName =
    clientName || tx.fitness_external_buyers?.full_name || "Customer";
  const customerPhone =
    clientPhone || tx.fitness_external_buyers?.phone || null;
  const customerEmail = clientEmail || null;

  const txDate = formatIsoDate(tx.transaction_date);
  const lineItems = [
    {
      product_name: tx.product_plan || tx.type || "Payment",
      qty: 1,
      cost: amount,
      discount: 0,
      discount_type: "percent",
      subtotal: amount,
    },
  ];

  const paymentMeta = {
    receipt_kind: SOURCE_FITNESS_TRANSACTION,
    transaction_id: txId,
    pay_mode: tx.pay_mode,
    transaction_date: txDate,
    transaction_type: tx.type,
    client_id: tx.client_id,
    rate_inr: Number(tx.rate_inr),
    pending_inr: Number(tx.pending_inr),
  };

  const notes = `Payment receipt — ${tx.product_plan || tx.type} (${txDate}). Mode: ${tx.pay_mode || "—"}.`;

  return insertReceiptInvoice({
    userId: uid,
    customerName,
    customerEmail,
    customerPhone,
    invoiceDate: txDate,
    subtotal: amount,
    tax: 0,
    total: amount,
    notes,
    lineItems,
    paymentMeta,
    sourceType: SOURCE_FITNESS_TRANSACTION,
    sourceId: txId,
  });
}

/** Latest payment on a collection → receipt (used after mark-paid). */
async function createReceiptForLatestCollectionPayment(collectionId, userId) {
  const cid = Number(collectionId);
  if (!Number.isFinite(cid) || cid < 1) return null;
  const latest = await prisma.fitness_collection_payments.findFirst({
    where: { collection_id: cid },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (!latest) return null;
  return createReceiptForCollectionPayment(latest.id, userId);
}

function parseJsonField(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return null;
  }
}

async function getReceiptPayload(invoiceId, user) {
  const id = Number(invoiceId);
  if (!Number.isFinite(id) || id < 1) return null;

  const row = await prisma.invoices.findFirst({
    where: { id, is_deleted: false },
  });
  if (!row) return null;
  if (user?.role !== "admin" && row.created_by !== user?.id) return { forbidden: true };

  let creatorName = null;
  let creatorEmail = null;
  if (row.created_by) {
    const creator = await prisma.users.findUnique({
      where: { id: row.created_by },
      select: { first_name: true, last_name: true, email: true },
    });
    if (creator) {
      creatorName =
        [creator.first_name, creator.last_name].filter(Boolean).join(" ").trim() || null;
      creatorEmail = creator.email || null;
    }
  }

  const invoice = {
    ...row,
    subtotal: row.subtotal ? Number(row.subtotal).toFixed(2) : "0.00",
    tax: row.tax ? Number(row.tax).toFixed(2) : "0.00",
    total: row.total ? Number(row.total).toFixed(2) : "0.00",
    creator_name: creatorName,
    creator_email: creatorEmail,
    line_items: parseJsonField(row.line_items_json) || [],
    payment_meta: parseJsonField(row.payment_meta_json),
  };
  delete invoice.line_items_json;
  delete invoice.payment_meta_json;

  const company = await prisma.company_settings.findUnique({
    where: { id: 1 },
  });
  return { invoice, company };
}

module.exports = {
  SOURCE_COLLECTION_PAYMENT,
  SOURCE_FITNESS_TRANSACTION,
  createReceiptForCollectionPayment,
  createReceiptForFitnessTransaction,
  createReceiptForLatestCollectionPayment,
  getReceiptPayload,
};
