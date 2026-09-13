const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const { getReceiptPayload } = require("../services/paymentReceiptService");
const { emitInvoicesChanged, emitRemindersChanged } = require("../realtime/meetingsRealtime");
const { ensureInvoicesTable } = require("../config/ensureSchema");
const { sendEmailWithRetry } = require("../services/emailService");
const { emailShell, detailsTable } = require("../services/emailTheme");
const {
  money,
  enrichInvoiceRowLive,
  findInvoice,
  listPayments,
  addPayment,
  updatePayment,
  markInvoicePaid,
  sumPaidForIds,
  parseLineItems,
} = require("../services/invoicePaymentService");
const { getWebSettings } = require("../services/webSettingsService");
const { buildInvoiceDocumentHtml } = require("../services/invoiceDocumentHtml");

/** Sales invoice CRUD — create, edit, payments, PDF. */

async function requireInvoicesTable(res) {
  try {
    await ensureInvoicesTable();
    return true;
  } catch (err) {
    console.error("requireInvoicesTable", err.message);
    res.status(503).json({
      success: false,
      message:
        "Invoices database table is not ready. Restart the API server or run: node scripts/ensure-invoices-table.js",
    });
    return false;
  }
}

/** Integers for LIMIT/OFFSET — NaN/Infinity breaks mysqld_stmt_execute on some MySQL builds. */
function safePageLimit(page, limit) {
  const lim = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const pg = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const off = (pg - 1) * lim;
  return { limit: lim, offset: off };
}

/** Express req.query values parsing */
function queryScalar(val, fallback = null) {
  if (val === undefined || val === null) return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  if (v === undefined || v === null) return fallback;
  if (typeof v === "object") return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function queryDate(val) {
  const s = queryScalar(val, null);
  if (!s) return null;
  const slice = s.slice(0, 10);
  return ISO_DATE_RE.test(slice) ? slice : null;
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

function parseLineItemsInput(raw) {
  if (raw == null) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return raw;
  }
}

function isPaymentReceiptSource(sourceType) {
  return sourceType === "collection_payment" || sourceType === "fitness_transaction";
}

function formatInvoice(inv) {
  if (!inv) return null;
  const res = { ...inv };
  if (res.subtotal !== undefined && res.subtotal !== null) {
    res.subtotal = Number(res.subtotal).toFixed(2);
  }
  if (res.tax !== undefined && res.tax !== null) {
    res.tax = Number(res.tax).toFixed(2);
  }
  if (res.total !== undefined && res.total !== null) {
    res.total = Number(res.total).toFixed(2);
  }

  if (res.line_items_json !== undefined) {
    res.line_items = parseJsonField(res.line_items_json) || [];
    delete res.line_items_json;
  }
  if (res.payment_meta_json !== undefined) {
    res.payment_meta = parseJsonField(res.payment_meta_json);
    delete res.payment_meta_json;
  }

  res.is_payment_receipt = Boolean(
    res.source_type === "collection_payment" || res.source_type === "fitness_transaction"
  );

  const paid = Number(res.amount_paid || 0);
  const totalNum = Number(res.total || 0);
  res.due_amount = Math.max(0, Math.round((totalNum - paid) * 100) / 100);
  res.gst_type =
    !res.gst_mode || res.gst_mode === "none" ? "Non GST" : res.gst_mode === "igst" ? "IGST" : "GST";
  res.payment_status =
    res.due_amount <= 0 && totalNum > 0 ? "paid" : paid > 0 ? "partial" : res.status;

  return res;
}

async function getInvoices(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!(await requireInvoicesTable(res))) return;

    const typeRaw = (queryScalar(req.query.type, "sales") || "sales").toLowerCase();
    const type = ["sales", "purchase", "proforma"].includes(typeRaw) ? typeRaw : "sales";

    const statusRaw = queryScalar(req.query.status, null);
    const status =
      statusRaw && ["draft", "sent", "paid", "cancelled"].includes(statusRaw) ? statusRaw : null;

    const page = queryScalar(req.query.page, "1");
    const limit = queryScalar(req.query.limit, "50");
    const { limit: safeLimit, offset: safeOffset } = safePageLimit(page, limit);

    const qText = queryScalar(req.query.q, null);
    const staffIdRaw = queryScalar(req.query.staff_id, null);
    const dateFrom = queryDate(req.query.date_from);
    const dateTo = queryDate(req.query.date_to);
    const gstBucket = (queryScalar(req.query.gst_bucket, "all") || "all").toLowerCase();
    const kind = (queryScalar(req.query.kind, "all") || "all").toLowerCase();

    const andClauses = [
      { type },
      { is_deleted: false }
    ];

    if (status) {
      andClauses.push({ status });
    }

    if (kind === "receipt") {
      andClauses.push({ source_type: { in: ["collection_payment", "fitness_transaction"] } });
    } else if (kind === "manual") {
      andClauses.push({
        OR: [
          { source_type: null },
          { source_type: { notIn: ["collection_payment", "fitness_transaction"] } }
        ]
      });
    }

    if (qText) {
      andClauses.push({
        OR: [
          { customer_name: { contains: qText } },
          { invoice_number: { contains: qText } },
          { notes: { contains: qText } }
        ]
      });
    }

    if (staffIdRaw && staffIdRaw !== "all") {
      const sid = Number.parseInt(String(staffIdRaw), 10);
      if (Number.isFinite(sid) && sid > 0) {
        andClauses.push({ created_by: sid });
      }
    }

    if (dateFrom || dateTo) {
      const dateRange = {};
      if (dateFrom) {
        dateRange.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dateRange.lte = new Date(dateTo);
      }
      andClauses.push({ invoice_date: dateRange });
    }

    if (gstBucket === "gst") {
      andClauses.push({ gst_mode: { in: ["igst", "sgst_cgst"] } });
    } else if (gstBucket === "non_gst") {
      andClauses.push({
        OR: [
          { gst_mode: null },
          { gst_mode: "none" }
        ]
      });
    }

    const where = { AND: andClauses };

    const total = await prisma.invoices.count({ where });

    const rows = await prisma.invoices.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: safeLimit,
      skip: safeOffset,
    });

    const creatorIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
    const creators = await prisma.users.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, first_name: true, last_name: true, email: true }
    });

    const creatorMap = {};
    for (const c of creators) {
      const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      creatorMap[c.id] = {
        creator_name: fullName || null,
        creator_email: c.email || null,
      };
    }

    const paidMap = await sumPaidForIds(rows.map((r) => r.id));
    const formattedInvoices = rows.map((r) => {
      const creatorInfo = creatorMap[r.created_by] || { creator_name: null, creator_email: null };
      const paid = paidMap.has(r.id) ? paidMap.get(r.id) : r.amount_paid;
      const formatted = formatInvoice({ ...r, amount_paid: paid });
      return {
        ...formatted,
        ...creatorInfo,
      };
    });

    res.json({ success: true, total, invoices: formattedInvoices });
  } catch (err) {
    console.error("getInvoices", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getInvoiceById(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    if (!(await requireInvoicesTable(res))) return;

    const row = await prisma.invoices.findFirst({
      where: { id, is_deleted: false }
    });
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    let creatorInfo = { creator_name: null, creator_email: null };
    if (row.created_by) {
      const creator = await prisma.users.findUnique({
        where: { id: row.created_by },
        select: { first_name: true, last_name: true, email: true }
      });
      if (creator) {
        const fullName = [creator.first_name, creator.last_name].filter(Boolean).join(" ").trim();
        creatorInfo = {
          creator_name: fullName || null,
          creator_email: creator.email || null
        };
      }
    }

    const formatted = formatInvoice(await enrichInvoiceRowLive(row));
    const payments = await listPayments(id);
    const invoice = {
      ...formatted,
      ...creatorInfo,
      payments,
    };

    res.json({ success: true, invoice });
  } catch (err) {
    console.error("getInvoiceById", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getInvoiceReceipt(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    if (!(await requireInvoicesTable(res))) return;
    const payload = await getReceiptPayload(id, req.user);
    if (!payload) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    if (payload.forbidden) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }
    res.json({
      success: true,
      invoice: payload.invoice,
      company: payload.company,
    });
  } catch (err) {
    console.error("getInvoiceReceipt", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createInvoice(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!(await requireInvoicesTable(res))) return;

    const {
      type = "sales",
      customer_name,
      customer_email,
      vendor_name,
      invoice_date,
      due_date,
      subtotal,
      tax,
      total,
      status = "draft",
      notes,
      gst_mode = "none",
      currency = "INR",
      customer_id,
      customer_phone,
      company_name,
      billing_address,
      line_items_json,
      amount_paid,
    } = req.body;

    const uid = req.user.id;
    if (!invoice_date || !String(invoice_date).trim()) {
      return res.status(400).json({ success: false, message: "invoice_date is required" });
    }

    const invoiceNumber = await nextInvoiceNumber(type);

    const lineJson = line_items_json != null ? parseLineItemsInput(line_items_json) : null;

    const totalNum = money(total || 0);
    let paidAmt = money(amount_paid);
    if (!Number.isFinite(paidAmt) || paidAmt < 0) paidAmt = 0;
    if (paidAmt > totalNum) paidAmt = totalNum;

    const result = await prisma.invoices.create({
      data: {
        invoice_number: invoiceNumber,
        type: type || "sales",
        customer_name: customer_name || null,
        customer_email: customer_email || null,
        customer_phone: customer_phone ? String(customer_phone).trim() : null,
        company_name: company_name || null,
        billing_address: billing_address ? String(billing_address).trim() || null : null,
        vendor_name: vendor_name || null,
        invoice_date: new Date(String(invoice_date).trim()),
        due_date: due_date ? new Date(due_date) : null,
        subtotal: subtotal ? new Prisma.Decimal(subtotal) : 0,
        tax: tax ? new Prisma.Decimal(tax) : 0,
        total: total ? new Prisma.Decimal(total) : 0,
        amount_paid: paidAmt,
        status: status || "draft",
        notes: notes || null,
        created_by: uid,
        gst_mode: gst_mode || "none",
        currency: currency || "INR",
        customer_id: customer_id ? Number(customer_id) : null,
        line_items_json: lineJson
      }
    });

    if (paidAmt > 0) {
      try {
        await addPayment(result.id, {
          payment_date: invoice_date,
          method: "Other",
          amount: paidAmt,
          note: "Initial amount paid",
          created_by: uid,
        });
      } catch (payErr) {
        console.warn("createInvoice initial payment", payErr.message);
      }
    }

    emitInvoicesChanged({ action: "created", id: result.id });

    let email_error = null;
    if (req.body?.send_email_copy) {
      const to = validEmail(customer_email);
      if (!to) {
        email_error = "Customer email is missing on this invoice";
      } else {
        const sent = await sendInvoiceCopyEmail({
          row: await enrichInvoiceRowLive(result),
          to,
        });
        if (!sent?.ok) email_error = sent?.detail || sent?.reason || "Email failed";
      }
    }

    res.json({
      success: true,
      id: result.id,
      invoice_number: invoiceNumber,
      ...(email_error ? { email_error } : {}),
    });
  } catch (err) {
    console.error("createInvoice", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateInvoice(req, res) {
  try {
    if (!(await requireInvoicesTable(res))) return;
    const { id, row } = await loadOwnedInvoice(req, req.params.id);
    if (isPaymentReceiptSource(row.source_type)) {
      return res.status(400).json({
        success: false,
        message: "Payment receipts cannot be edited as invoices.",
      });
    }

    const {
      customer_name,
      customer_email,
      customer_phone,
      company_name,
      billing_address,
      customer_id,
      invoice_date,
      due_date,
      subtotal,
      tax,
      total,
      gst_mode,
      currency,
      line_items_json,
      notes,
      status,
    } = req.body;

    if (!invoice_date || !String(invoice_date).trim()) {
      return res.status(400).json({ success: false, message: "invoice_date is required" });
    }

    const allowed = ["draft", "sent", "paid", "cancelled"];
    const nextStatus =
      status != null && allowed.includes(String(status)) ? String(status) : undefined;

    const data = {
      customer_name: customer_name || null,
      customer_email: customer_email || null,
      customer_phone: customer_phone ? String(customer_phone).trim() : null,
      company_name: company_name || null,
      billing_address: billing_address ? String(billing_address).trim() || null : null,
      customer_id: Number.isFinite(Number(customer_id)) && Number(customer_id) > 0 ? Number(customer_id) : null,
      invoice_date: new Date(String(invoice_date).trim()),
      due_date: due_date ? new Date(due_date) : null,
      subtotal: subtotal != null ? new Prisma.Decimal(subtotal) : 0,
      tax: tax != null ? new Prisma.Decimal(tax) : 0,
      total: total != null ? new Prisma.Decimal(total) : 0,
      gst_mode: gst_mode || "none",
      currency: currency || "INR",
      notes: notes || null,
      line_items_json: line_items_json != null ? parseLineItemsInput(line_items_json) : null,
      updated_at: new Date(),
    };
    if (nextStatus) data.status = nextStatus;

    await prisma.invoices.update({ where: { id }, data });

    emitInvoicesChanged({ action: "update", id });

    let email_error = null;
    if (req.body?.send_email_copy) {
      const to = validEmail(customer_email || row.customer_email);
      if (!to) {
        email_error = "Customer email is missing on this invoice";
      } else {
        const sent = await sendInvoiceCopyEmail({
          row: await enrichInvoiceRowLive(await findInvoice(id)),
          to,
        });
        if (!sent?.ok) email_error = sent?.detail || sent?.reason || "Email failed";
      }
    }

    res.json({
      success: true,
      id,
      invoice_number: row.invoice_number,
      ...(email_error ? { email_error } : {}),
    });
  } catch (err) {
    console.error("updateInvoice", err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function updateInvoiceStatus(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!(await requireInvoicesTable(res))) return;
    const { status } = req.body;
    const allowed = ["draft", "sent", "paid", "cancelled"];
    if (!status || !allowed.includes(String(status))) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await prisma.invoices.findFirst({
      where: { id, is_deleted: false },
      select: { created_by: true }
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }
    await prisma.invoices.update({
      where: { id },
      data: { status: String(status) }
    });
    emitInvoicesChanged({ action: "status", id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteInvoice(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!(await requireInvoicesTable(res))) return;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await prisma.invoices.findFirst({
      where: { id, is_deleted: false },
      select: { created_by: true }
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }
    await prisma.invoices.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date()
      }
    });
    emitInvoicesChanged({ action: "delete", id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

function parseInvoiceId(raw) {
  const id = Number.parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function validEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function digitsPhone(phone, defaultDial = "91") {
  let raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);
  if (raw.length === 11 && raw.startsWith("0")) raw = raw.slice(1);
  if (raw.length === 10) return `${defaultDial}${raw}`;
  return raw;
}

async function nextInvoiceNumber(type) {
  const year = new Date().getFullYear();
  const settings = await prisma.company_settings.findUnique({ where: { id: 1 } });
  const start = Math.max(1, Number(settings?.invoice_start_no) || 1);
  const prefix = `${String(type || "sales").toUpperCase().slice(0, 3)}-${year}-`;
  const cnt = await prisma.invoices.count({
    where: { invoice_number: { startsWith: prefix } },
  });
  return `${prefix}${String(start + cnt).padStart(4, "0")}`;
}

async function loadOwnedInvoice(req, invoiceId) {
  if (!req.user?.id) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  const id = parseInvoiceId(invoiceId);
  if (!id) {
    const err = new Error("Invalid id");
    err.status = 400;
    throw err;
  }
  const row = await findInvoice(id);
  if (!row) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  if (req.user.role !== "admin" && row.created_by !== req.user.id) {
    const err = new Error("Not allowed");
    err.status = 403;
    throw err;
  }
  return { id, row: await enrichInvoiceRowLive(row) };
}

function documentHtmlForEmail(fullHtml) {
  const s = String(fullHtml || "");
  const noToolbar = s.replace(/<div class="toolbar">[\s\S]*?<\/div>/i, "");
  const styleMatch = noToolbar.match(/<style>([\s\S]*?)<\/style>/i);
  const bodyMatch = noToolbar.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let inner = bodyMatch ? bodyMatch[1] : noToolbar;
  inner = inner.replace(/<div class="toolbar">[\s\S]*?<\/div>/i, "");
  const styles = styleMatch ? `<style>${styleMatch[1]}</style>` : "";
  return `${styles}${inner}`;
}

async function sendInvoiceCopyEmail({ row, to }) {
  let company = {};
  try {
    const pack = await getWebSettings();
    company = pack?.data || {};
  } catch {
    /* ignore */
  }
  const htmlDoc = await buildInvoiceDocumentHtml({
    row: { ...row, line_items: parseLineItems(row.line_items_json || row.line_items) },
    settings: company,
  });
  const cur = row.currency || "INR";
  const html = emailShell({
    headerTitle: `Invoice ${row.invoice_number}`,
    headerSubtitle: "Invoice",
    bodyHtml:
      detailsTable([
        { label: "Invoice", value: row.invoice_number },
        { label: "Customer", value: row.customer_name || "—" },
        { label: "Total", value: `${cur} ${money(row.total).toFixed(2)}` },
        { label: "Due", value: `${cur} ${money(row.due_amount).toFixed(2)}` },
      ]) + `<div style="margin-top:16px;overflow:auto">${documentHtmlForEmail(htmlDoc)}</div>`,
  });
  return sendEmailWithRetry({ to, subject: `Invoice ${row.invoice_number}`, html });
}

async function getInvoiceProducts(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const typeRaw = (queryScalar(req.query.type, "sales") || "sales").toLowerCase();
    const type = ["sales", "purchase", "proforma"].includes(typeRaw) ? typeRaw : "sales";
    const rows = await prisma.invoices.findMany({
      where: { type, is_deleted: false },
      orderBy: { created_at: "desc" },
      take: 500,
      select: { line_items_json: true },
    });
    const byKey = new Map();
    for (const row of rows) {
      for (const item of parseLineItems(row.line_items_json)) {
        const name = String(item?.product_name || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (byKey.has(key)) continue;
        byKey.set(key, {
          product_name: name,
          hsn: String(item.hsn || "").trim(),
          cost: item.cost != null ? Number(item.cost) : null,
        });
      }
    }
    res.json({ success: true, products: Array.from(byKey.values()) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getInvoicePayments(req, res) {
  try {
    const { id, row } = await loadOwnedInvoice(req, req.params.id);
    const payments = await listPayments(id);
    res.json({ success: true, invoice: formatInvoice(row), payments });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function markInvoiceAsPaid(req, res) {
  try {
    const { id } = await loadOwnedInvoice(req, req.params.id);
    const result = await markInvoicePaid(id, {
      payment_date: req.body?.payment_date,
      method: req.body?.method || "Other",
      note: req.body?.note || "Converted to paid",
      created_by: req.user.id,
    });
    emitInvoicesChanged({ action: "payment", id });
    res.json({ success: true, invoice: formatInvoice(result.invoice), payments: result.payments });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function createInvoicePayment(req, res) {
  try {
    const { id, row } = await loadOwnedInvoice(req, req.params.id);
    if (req.body?.settle === true || req.body?.mark_paid === true) {
      const result = await markInvoicePaid(id, {
        payment_date: req.body?.payment_date,
        method: req.body?.method || "Other",
        note: req.body?.note || "Converted to paid",
        created_by: req.user.id,
      });
      emitInvoicesChanged({ action: "payment", id });
      return res.json({ success: true, invoice: formatInvoice(result.invoice), payments: result.payments });
    }
    const result = await addPayment(id, {
      payment_date: req.body?.payment_date,
      method: req.body?.method,
      amount: req.body?.amount,
      note: req.body?.note,
      created_by: req.user.id,
    });
    emitInvoicesChanged({ action: "payment", id });
    res.json({
      success: true,
      invoice: formatInvoice(result.invoice || row),
      payments: result.payments,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function patchInvoicePayment(req, res) {
  try {
    const { id } = await loadOwnedInvoice(req, req.params.id);
    const paymentId = parseInvoiceId(req.params.paymentId);
    if (!paymentId) return res.status(400).json({ success: false, message: "Invalid payment id" });
    const result = await updatePayment(id, paymentId, req.body || {});
    emitInvoicesChanged({ action: "payment_edit", id });
    res.json({ success: true, invoice: formatInvoice(result.invoice), payments: result.payments });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function duplicateInvoice(req, res) {
  try {
    const { row } = await loadOwnedInvoice(req, req.params.id);
    const invoiceNumber = await nextInvoiceNumber(row.type || "sales");
    const lineItems = parseLineItems(row.line_items_json);
    const created = await prisma.invoices.create({
      data: {
        invoice_number: invoiceNumber,
        type: row.type || "sales",
        customer_name: row.customer_name || null,
        customer_email: row.customer_email || null,
        customer_phone: row.customer_phone || null,
        company_name: row.company_name || null,
        billing_address: row.billing_address || null,
        vendor_name: row.vendor_name || null,
        invoice_date: new Date(),
        due_date: null,
        subtotal: row.subtotal || 0,
        tax: row.tax || 0,
        total: row.total || 0,
        amount_paid: 0,
        status: "draft",
        notes: row.notes || null,
        created_by: req.user.id,
        gst_mode: row.gst_mode || "none",
        currency: row.currency || "INR",
        customer_id: row.customer_id || null,
        line_items_json: lineItems.length ? lineItems : null,
      },
    });
    emitInvoicesChanged({ action: "duplicate", id: created.id, from: row.id });
    res.json({ success: true, id: created.id, invoice_number: invoiceNumber });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getInvoiceWhatsapp(req, res) {
  try {
    const { row } = await loadOwnedInvoice(req, req.params.id);
    const digits = digitsPhone(row.customer_phone);
    if (!digits) {
      return res.status(400).json({ success: false, message: "Customer phone is missing on this invoice" });
    }
    const cur = row.currency || "INR";
    const msg =
      `Invoice ${row.invoice_number}\n` +
      `Customer: ${row.customer_name || "-"}\n` +
      `Total: ${cur} ${money(row.total).toFixed(2)}\n` +
      `Due: ${cur} ${money(row.due_amount).toFixed(2)}`;
    const wa_url = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    res.json({ success: true, wa_url, phone: digits });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function emailInvoice(req, res) {
  try {
    const { row } = await loadOwnedInvoice(req, req.params.id);
    const to = validEmail(req.body?.to) || validEmail(row.customer_email);
    if (!to) {
      return res.status(400).json({ success: false, message: "Customer email is missing on this invoice" });
    }
    const sent = await sendInvoiceCopyEmail({ row, to });
    if (!sent?.ok) {
      return res.status(502).json({ success: false, message: sent?.detail || sent?.reason || "Email failed" });
    }
    res.json({ success: true, message: "Email sent", to });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getInvoicePdf(req, res) {
  try {
    const { row } = await loadOwnedInvoice(req, req.params.id);
    let company = {};
    try {
      const pack = await getWebSettings();
      company = pack?.data || {};
    } catch {
      /* ignore */
    }
    const html = await buildInvoiceDocumentHtml({
      row: { ...row, line_items: parseLineItems(row.line_items_json || row.line_items) },
      settings: company,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${String(row.invoice_number || row.id).replace(/[^a-zA-Z0-9_-]/g, "_")}.html"`
    );
    res.send(html);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function createPaymentReminder(req, res) {
  try {
    const { id, row } = await loadOwnedInvoice(req, req.params.id);
    const remindAtRaw = req.body?.remind_at || req.body?.remindAt;
    const remindAt = remindAtRaw ? new Date(remindAtRaw) : row.due_date ? new Date(row.due_date) : new Date();
    if (Number.isNaN(remindAt.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid remind_at" });
    }
    const title = String(req.body?.title || `Payment reminder · ${row.invoice_number}`).slice(0, 200);
    const note = String(
      req.body?.note ||
        `Due ${money(row.due_amount).toFixed(2)} ${row.currency || "INR"} for invoice ${row.invoice_number}`
    ).slice(0, 2000);
    const created = await prisma.reminders.create({
      data: {
        user_id: req.user.id,
        title,
        note,
        remind_at: remindAt,
        reminder_type: "payment",
        assigned_to_user_id: req.user.id,
      },
    });
    emitInvoicesChanged({ action: "payment_reminder", id });
    emitRemindersChanged({ reason: "invoice_payment_reminder", invoice_id: id });
    res.json({ success: true, reminder_id: created.id, message: "Payment reminder set" });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getInvoices,
  getInvoiceById,
  getInvoiceReceipt,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  getInvoiceProducts,
  getInvoicePayments,
  createInvoicePayment,
  markInvoiceAsPaid,
  patchInvoicePayment,
  duplicateInvoice,
  getInvoiceWhatsapp,
  emailInvoice,
  getInvoicePdf,
  createPaymentReminder,
};
