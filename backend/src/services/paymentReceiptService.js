const { pool } = require("../config/database");
const { emitInvoicesChanged } = require("../realtime/meetingsRealtime");
const { ensureInvoicesTable } = require("../config/ensureSchema");

const SOURCE_COLLECTION_PAYMENT = "collection_payment";
const SOURCE_FITNESS_TRANSACTION = "fitness_transaction";

async function hasInvoiceColumn(column) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = ? LIMIT 1`,
    [column]
  );
  return rows.length > 0;
}

async function canLinkSource() {
  return (await hasInvoiceColumn("source_type")) && (await hasInvoiceColumn("source_id"));
}

async function findExistingReceipt(sourceType, sourceId) {
  if (!(await canLinkSource())) return null;
  const [rows] = await pool.execute(
    `SELECT id, invoice_number FROM invoices
     WHERE source_type = ? AND source_id = ? AND is_deleted = 0
     LIMIT 1`,
    [sourceType, sourceId]
  );
  return rows[0] || null;
}

async function nextReceiptNumber() {
  const year = new Date().getFullYear();
  const [[{ cnt }]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM invoices WHERE invoice_number LIKE ?`,
    [`RCP-${year}-%`]
  );
  return `RCP-${year}-${String(Number(cnt || 0) + 1).padStart(4, "0")}`;
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
  const lineJson = JSON.stringify(lineItems || []);
  const metaJson = paymentMeta ? JSON.stringify(paymentMeta) : null;

  const cols = [
    "invoice_number",
    "type",
    "customer_name",
    "customer_email",
    "vendor_name",
    "invoice_date",
    "due_date",
    "subtotal",
    "tax",
    "total",
    "status",
    "notes",
    "created_by",
    "gst_mode",
    "currency",
    "line_items_json",
  ];
  const vals = [
    invoiceNumber,
    "sales",
    customerName || null,
    customerEmail || null,
    null,
    invoiceDate,
    null,
    subtotal,
    tax || 0,
    total,
    "paid",
    notes || null,
    userId,
    "none",
    "INR",
    lineJson,
  ];

  if (await hasInvoiceColumn("customer_phone")) {
    cols.push("customer_phone");
    vals.push(customerPhone || null);
  }
  if (await hasInvoiceColumn("payment_meta_json")) {
    cols.push("payment_meta_json");
    vals.push(metaJson);
  }
  if (sourceType && sourceId != null && (await canLinkSource())) {
    cols.push("source_type", "source_id");
    vals.push(sourceType, sourceId);
  }

  const placeholders = cols.map(() => "?").join(", ");
  const [result] = await pool.execute(
    `INSERT INTO invoices (${cols.join(", ")}) VALUES (${placeholders})`,
    vals
  );

  emitInvoicesChanged({ action: "receipt_created", id: result.insertId });
  return { id: result.insertId, invoice_number: invoiceNumber };
}

async function resolveCollectionParty(col) {
  let customerName = null;
  let customerPhone = null;
  let customerEmail = null;

  if (col.client_id) {
    const [rows] = await pool.execute(
      `SELECT full_name, phone, email FROM fitness_clients WHERE client_id = ? LIMIT 1`,
      [col.client_id]
    );
    if (rows[0]) {
      customerName = rows[0].full_name || col.client_id;
      customerPhone = rows[0].phone || null;
      customerEmail = rows[0].email || null;
    } else {
      customerName = col.client_name || col.client_id;
    }
  } else if (col.external_buyer_id) {
    const [rows] = await pool.execute(
      `SELECT full_name, phone FROM fitness_external_buyers WHERE id = ? LIMIT 1`,
      [col.external_buyer_id]
    );
    customerName = rows[0]?.full_name || col.external_buyer_name || "Walk-in customer";
    customerPhone = rows[0]?.phone || null;
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

  const [payRows] = await pool.execute(
    `SELECT p.*, c.id AS collection_id, c.title, c.collection_type, c.client_id, c.external_buyer_id,
            c.total_inr, c.received_inr, c.pending_inr, c.status AS collection_status,
            fc.full_name AS client_name, eb.full_name AS external_buyer_name
     FROM fitness_collection_payments p
     JOIN fitness_collections c ON c.id = p.collection_id
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE p.id = ?`,
    [pid]
  );
  const payment = payRows[0];
  if (!payment) return null;

  const amount = Number(payment.amount_inr) || 0;
  if (amount <= 0) return null;

  const party = await resolveCollectionParty(payment);
  const paidAt = String(payment.paid_at || new Date().toISOString()).slice(0, 10);

  const lineItems = [
    {
      product_name: payment.title || "Payment",
      qty: 1,
      cost: amount,
      discount: 0,
      discount_type: "percent",
      subtotal: amount,
    },
  ];

  const paymentMeta = {
    receipt_kind: SOURCE_COLLECTION_PAYMENT,
    collection_id: payment.collection_id,
    payment_id: pid,
    pay_mode: payment.pay_mode,
    paid_at: paidAt,
    collection_type: payment.collection_type,
    collection_status: payment.collection_status,
    client_id: payment.client_id,
    collection_total_inr: Number(payment.total_inr),
    collection_received_inr: Number(payment.received_inr),
    collection_pending_inr: Number(payment.pending_inr),
  };

  const notes = `Payment receipt — ${payment.title || "Collection"} (#${payment.collection_id}). Paid via ${payment.pay_mode || "—"} on ${paidAt}.`;

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

  const [rows] = await pool.execute(
    `SELECT ft.*, fc.full_name AS client_name, fc.phone AS client_phone, fc.email AS client_email,
            eb.full_name AS external_buyer_name, eb.phone AS external_phone
     FROM fitness_transactions ft
     LEFT JOIN fitness_clients fc ON fc.client_id = ft.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = ft.external_buyer_id
     WHERE ft.id = ?`,
    [txId]
  );
  const tx = rows[0];
  if (!tx) return null;

  const amount = Number(tx.received_inr) || 0;
  if (amount <= 0) return null;

  let customerName = tx.client_name || tx.external_buyer_name || "Customer";
  let customerPhone = tx.client_phone || tx.external_phone || null;
  let customerEmail = tx.client_email || null;

  const txDate = String(tx.transaction_date || new Date().toISOString()).slice(0, 10);
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
  const [rows] = await pool.execute(
    `SELECT id FROM fitness_collection_payments WHERE collection_id = ? ORDER BY id DESC LIMIT 1`,
    [cid]
  );
  if (!rows[0]) return null;
  return createReceiptForCollectionPayment(rows[0].id, userId);
}

async function getCompanySettingsRow() {
  const [rows] = await pool.execute("SELECT * FROM company_settings WHERE id = 1 LIMIT 1");
  return rows[0] || null;
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

  const [rows] = await pool.execute(
    `SELECT i.*, u.full_name AS creator_name, u.email AS creator_email
     FROM invoices i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.id = ? AND i.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (user?.role !== "admin" && row.created_by !== user?.id) return { forbidden: true };

  const invoice = {
    ...row,
    line_items: parseJsonField(row.line_items_json) || [],
    payment_meta: parseJsonField(row.payment_meta_json),
  };
  delete invoice.line_items_json;
  delete invoice.payment_meta_json;

  const company = await getCompanySettingsRow();
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
