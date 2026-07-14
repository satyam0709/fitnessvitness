const prisma = require("../config/prisma");
const { Prisma } = require("../generated/prisma");
const { emitFitnessChanged, emitCollectionsChanged } = require("../realtime/meetingsRealtime");
const {
  createReceiptForCollectionPayment,
  createReceiptForLatestCollectionPayment,
} = require("./paymentReceiptService");
const {
  notifyCollectionCreated,
  notifyCollectionPaid,
  sweepCollectionFollowupNotifications,
} = require("./collectionNotificationService");

const VALID_TYPES = new Set(["diet_plan", "supplement", "bundle", "other"]);
const VALID_PAY_MODES = new Set([
  "GPay",
  "Cash",
  "Online Transfer",
  "Cheque",
  "UPI",
  "NEFT",
]);
const VALID_STATUS = new Set(["open", "partial", "paid", "cancelled"]);

function queryScalar(val, fallback = null) {
  if (val === undefined || val === null) return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  if (v === undefined || v === null || typeof v === "object") return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

function bindInt(val, fallback = 0) {
  const n = Number.parseInt(String(val), 10);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function toSqlDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dateStr = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dateStr}`;
}

function toPrismaDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeStatus(total, received) {
  const t = roundMoney(total);
  const r = roundMoney(received);
  const pending = Math.max(0, roundMoney(t - r));
  if (pending <= 0) return { status: "paid", pending_inr: 0, received_inr: t };
  if (r <= 0) return { status: "open", pending_inr: pending, received_inr: 0 };
  return { status: "partial", pending_inr: pending, received_inr: r };
}

function mapTxType(collectionType) {
  if (collectionType === "supplement") return "Supplement";
  if (collectionType === "diet_plan" || collectionType === "bundle") return "Membership";
  return "Other";
}

function canViewAll(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "manager" || r === "owner";
}

async function resolveExternalBuyer(eb) {
  if (!eb || !eb.full_name) return null;
  const name = String(eb.full_name).trim();
  const phone = eb.phone ? String(eb.phone).replace(/\D/g, "") : null;
  if (phone) {
    const found = await prisma.fitness_external_buyers.findUnique({
      where: { phone }
    });
    if (found) return found.id;
  }
  const ins = await prisma.fitness_external_buyers.create({
    data: {
      full_name: name,
      phone: phone || null,
      referred_by_client_id: eb.referred_by_client_id || null,
      notes: eb.notes != null ? String(eb.notes) : null
    }
  });
  return ins.id;
}

function collectionPaymentDueDate(collection) {
  const pending = roundMoney(collection.pending_inr);
  if (pending <= 0) return null;
  return collection.next_followup_date
    ? toPrismaDate(collection.next_followup_date)
    : null;
}

function formatCollection(col) {
  if (!col) return col;
  const res = { ...col };
  if (res.total_inr !== undefined && res.total_inr !== null) {
    res.total_inr = Number(res.total_inr).toFixed(2);
  }
  if (res.received_inr !== undefined && res.received_inr !== null) {
    res.received_inr = Number(res.received_inr).toFixed(2);
  }
  if (res.pending_inr !== undefined && res.pending_inr !== null) {
    res.pending_inr = Number(res.pending_inr).toFixed(2);
  }
  if (res.payments && Array.isArray(res.payments)) {
    res.payments = res.payments.map(formatPayment);
  }
  return res;
}

function formatPayment(pay) {
  if (!pay) return pay;
  const res = { ...pay };
  if (res.amount_inr !== undefined && res.amount_inr !== null) {
    res.amount_inr = Number(res.amount_inr).toFixed(2);
  }
  return res;
}

async function syncLinkedTransaction(tx, collection, payMode, transactionDate) {
  const hasClient = Boolean(collection.client_id);
  const hasExternal = Boolean(collection.external_buyer_id);
  if (hasClient && hasExternal) {
    throw new Error("Transaction cannot have both client_id and external_buyer_id");
  }
  if (!hasClient && !hasExternal) {
    throw new Error("Transaction requires client_id or external_buyer_id");
  }

  const txType = mapTxType(collection.collection_type);
  const today = new Date();
  const date = toPrismaDate(transactionDate) || toPrismaDate(collection.created_at) || today;
  const paymentDue = collectionPaymentDueDate(collection);

  if (collection.linked_transaction_id) {
    await tx.fitness_transactions.update({
      where: { id: collection.linked_transaction_id },
      data: {
        received_inr: new Prisma.Decimal(collection.received_inr),
        pending_inr: new Prisma.Decimal(collection.pending_inr),
        rate_inr: new Prisma.Decimal(collection.total_inr),
        mrp_inr: new Prisma.Decimal(collection.total_inr),
        product_plan: collection.title,
        type: txType,
        pay_mode: payMode || "GPay",
        payment_due_date: paymentDue
      }
    });
    return collection.linked_transaction_id;
  }

  const newTx = await tx.fitness_transactions.create({
    data: {
      client_id: collection.client_id,
      external_buyer_id: collection.external_buyer_id,
      transaction_date: date,
      product_plan: collection.title,
      type: txType,
      mrp_inr: new Prisma.Decimal(collection.total_inr),
      rate_inr: new Prisma.Decimal(collection.total_inr),
      received_inr: new Prisma.Decimal(collection.received_inr),
      pending_inr: new Prisma.Decimal(collection.pending_inr),
      cost_inr: 0,
      pay_mode: payMode || "GPay",
      notes: collection.notes ? `Collection #${collection.id}: ${collection.notes}` : `Collection #${collection.id}`,
      payment_due_date: paymentDue
    }
  });

  await tx.fitness_collections.update({
    where: { id: collection.id },
    data: { linked_transaction_id: newTx.id }
  });

  return newTx.id;
}

async function recalcCollection(tx, collectionId) {
  const col = await tx.fitness_collections.findUnique({
    where: { id: collectionId }
  });
  if (!col) return null;

  const payments = await tx.fitness_collection_payments.aggregate({
    where: { collection_id: collectionId },
    _sum: { amount_inr: true }
  });
  const received = roundMoney(payments._sum.amount_inr || 0);
  const total = roundMoney(col.total_inr);
  const { status, pending_inr, received_inr } = computeStatus(total, received);

  const updated = await tx.fitness_collections.update({
    where: { id: collectionId },
    data: {
      received_inr: new Prisma.Decimal(received_inr),
      pending_inr: new Prisma.Decimal(pending_inr),
      status,
      updated_at: new Date()
    }
  });

  return updated;
}

async function getCollectionWithDetails(id) {
  const col = await prisma.fitness_collections.findUnique({
    where: { id },
  });
  if (!col) return null;

  let client_name = null;
  if (col.client_id) {
    const client = await prisma.fitness_clients.findFirst({
      where: { client_id: col.client_id },
      select: { full_name: true }
    });
    client_name = client?.full_name || null;
  }

  let external_buyer_name = null;
  if (col.external_buyer_id) {
    const ext = await prisma.fitness_external_buyers.findUnique({
      where: { id: col.external_buyer_id },
      select: { full_name: true }
    });
    external_buyer_name = ext?.full_name || null;
  }

  let assignee_name = null;
  if (col.assigned_to) {
    const user = await prisma.users.findUnique({
      where: { id: col.assigned_to },
      select: { first_name: true, last_name: true }
    });
    if (user) {
      assignee_name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null;
    }
  }

  const payments = await prisma.fitness_collection_payments.findMany({
    where: { collection_id: id },
    orderBy: [
      { paid_at: "desc" },
      { id: "desc" }
    ]
  });

  const paymentCreatorIds = [...new Set(payments.map(p => p.created_by).filter(Boolean))];
  const paymentCreators = await prisma.users.findMany({
    where: { id: { in: paymentCreatorIds } },
    select: { id: true, first_name: true, last_name: true }
  });
  const creatorNameMap = {};
  for (const u of paymentCreators) {
    creatorNameMap[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null;
  }

  const paymentsWithCreator = payments.map(p => ({
    ...p,
    created_by_name: creatorNameMap[p.created_by] || null
  }));

  let latest_receipt_invoice_id = null;
  if (payments.length > 0) {
    const latestInvoice = await prisma.invoices.findFirst({
      where: {
        source_type: "collection_payment",
        source_id: { in: payments.map(p => p.id) },
        is_deleted: false
      },
      orderBy: { id: "desc" },
      select: { id: true }
    });
    latest_receipt_invoice_id = latestInvoice?.id || null;
  }

  const result = {
    ...col,
    client_name,
    external_buyer_name,
    assignee_name,
    latest_receipt_invoice_id,
    payments: paymentsWithCreator
  };
  return formatCollection(result);
}

async function listCollections(req) {
  const userId = Number(req.user?.id);
  const role = req.user?.role;
  const limit = Math.min(200, Math.max(1, bindInt(req.query?.limit, 50)));
  const offset = Math.max(0, bindInt(req.query?.offset, 0));

  const clauses = ["1=1"];
  const params = [];

  if (!canViewAll(role)) {
    const uid = bindInt(userId, 0);
    if (uid > 0) {
      clauses.push("(c.assigned_to = ? OR c.created_by = ?)");
      params.push(uid, uid);
    }
  }

  const status = queryScalar(req.query?.status);
  if (status && VALID_STATUS.has(status)) {
    clauses.push("c.status = ?");
    params.push(status);
  }

  const type = queryScalar(req.query?.type);
  if (type && VALID_TYPES.has(type)) {
    clauses.push("c.collection_type = ?");
    params.push(type);
  }

  const clientId = queryScalar(req.query?.client_id);
  if (clientId) {
    clauses.push("c.client_id = ?");
    params.push(clientId);
  }

  const due = String(queryScalar(req.query?.due, "all") || "all").toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (due === "today") {
    clauses.push("c.next_followup_date = ? AND c.status IN ('open','partial')");
    params.push(today);
  } else if (due === "overdue") {
    clauses.push("c.next_followup_date < ? AND c.status IN ('open','partial')");
    params.push(today);
  } else if (due === "upcoming") {
    clauses.push("c.next_followup_date > ? AND c.status IN ('open','partial')");
    params.push(today);
  } else if (due === "open") {
    clauses.push("c.status IN ('open','partial')");
  }

  const q = queryScalar(req.query?.q, "");
  if (q) {
    clauses.push(
      "(c.title LIKE ? OR fc.full_name LIKE ? OR fc.client_id LIKE ? OR eb.full_name LIKE ?)"
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const whereSql = clauses.join(" AND ");
  const receiptSubquery = `(SELECT i.id FROM invoices i
     INNER JOIN fitness_collection_payments p ON p.id = i.source_id
     WHERE i.source_type = 'collection_payment' AND p.collection_id = c.id AND i.is_deleted = 0
     ORDER BY i.id DESC LIMIT 1)`;

  const querySql = `
     SELECT c.*,
            fc.full_name AS client_name,
            eb.full_name AS external_buyer_name,
            TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS assignee_name,
            ${receiptSubquery} AS latest_receipt_invoice_id
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE ${whereSql}
     ORDER BY
       CASE WHEN c.status IN ('open','partial') AND c.next_followup_date IS NOT NULL AND c.next_followup_date < CURDATE() THEN 0
            WHEN c.status IN ('open','partial') AND c.next_followup_date = CURDATE() THEN 1
            ELSE 2 END,
       c.next_followup_date ASC,
       c.updated_at DESC
     LIMIT ? OFFSET ?
  `;

  const rows = await prisma.$queryRawUnsafe(querySql, ...params, limit, offset);

  const countSql = `
     SELECT COUNT(*) AS total FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE ${whereSql}
  `;
  const countRows = await prisma.$queryRawUnsafe(countSql, ...params);
  const total = Number(countRows[0]?.total || 0);

  const formattedRows = rows.map(formatCollection);

  return { rows: formattedRows, total, limit, offset };
}

async function getSummary(req) {
  const userId = Number(req.user?.id);
  const role = req.user?.role;
  const scope = canViewAll(role) ? "" : "AND (c.assigned_to = ? OR c.created_by = ?)";
  const scopeParams = canViewAll(role) ? [] : [userId, userId];
  const today = new Date().toISOString().slice(0, 10);

  let rows;
  if (canViewAll(role)) {
    rows = await prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN c.status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date = ${today} THEN 1 ELSE 0 END) AS due_today,
        SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date < ${today} THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN c.status IN ('open','partial') THEN c.pending_inr ELSE 0 END) AS total_pending_inr
      FROM fitness_collections c
      WHERE 1=1
    `;
  } else {
    rows = await prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN c.status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date = ${today} THEN 1 ELSE 0 END) AS due_today,
        SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date < ${today} THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN c.status IN ('open','partial') THEN c.pending_inr ELSE 0 END) AS total_pending_inr
      FROM fitness_collections c
      WHERE (c.assigned_to = ${userId} OR c.created_by = ${userId})
    `;
  }
  const r = rows[0] || {};

  let booked = {
    booked_closed_won_mtd: 0,
    booked_closed_won_lifetime: 0,
    closed_lost_count_mtd: 0,
    closed_lost_count_lifetime: 0,
    closed_lost_value_mtd: 0,
    closed_lost_value_lifetime: 0,
  };
  try {
    const { getRevenueSummary } = require("./opportunityRevenueStats");
    const summary = await getRevenueSummary(req);
    booked = {
      booked_closed_won_mtd: summary.mtd.closed_won_value,
      booked_closed_won_lifetime: summary.lifetime.closed_won_value,
      closed_lost_count_mtd: summary.mtd.closed_lost_count,
      closed_lost_count_lifetime: summary.lifetime.closed_lost_count,
      closed_lost_value_mtd: summary.mtd.closed_lost_value,
      closed_lost_value_lifetime: summary.lifetime.closed_lost_value,
    };
  } catch (e) {
    console.warn("collections summary booked append:", e.message);
  }

  return {
    open_count: Number(r.open_count) || 0,
    due_today: Number(r.due_today) || 0,
    overdue: Number(r.overdue) || 0,
    total_pending_inr: Number(r.total_pending_inr) || 0,
    ...booked,
  };
}

async function createCollectionsFromVisit(req) {
  const userId = Number(req.user?.id);
  const {
    client_id,
    external_buyer,
    lines,
    next_followup_date,
    assigned_to,
    pay_mode,
    notes,
    transaction_date,
  } = req.body || {};

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  let finalClientId = client_id ? String(client_id).trim() : null;
  let finalExtId = null;

  if (finalClientId) {
    const c = await prisma.fitness_clients.findFirst({
      where: { client_id: finalClientId },
      select: { client_id: true }
    });
    if (!c) throw new Error("Client not found");
  } else if (external_buyer) {
    finalExtId = await resolveExternalBuyer(external_buyer);
    if (!finalExtId) throw new Error("external_buyer.full_name is required for walk-in");
  } else {
    throw new Error("client_id or external_buyer is required");
  }

  const assignee = Number(assigned_to) || userId;
  const payMode = VALID_PAY_MODES.has(pay_mode) ? pay_mode : "GPay";
  const txDate = toPrismaDate(transaction_date) || new Date();

  const notifyQueue = [];

  const createdIds = await prisma.$transaction(async (tx) => {
    const ids = [];
    for (const line of lines) {
      const collectionType = VALID_TYPES.has(line.collection_type) ? line.collection_type : "other";
      const title = String(line.title || line.product_name || "Collection").trim();
      if (!title) throw new Error("Each line requires a title");

      const total = roundMoney(line.total_inr ?? line.rate_inr ?? 0);
      const paidNow = roundMoney(line.paid_now_inr ?? line.received_inr ?? 0);
      if (paidNow > total) throw new Error(`Paid amount cannot exceed total for "${title}"`);
      if (total < 0) throw new Error("total_inr must be >= 0");

      const { status, pending_inr, received_inr } = computeStatus(total, paidNow);
      let followup = next_followup_date || line.next_followup_date || null;
      if (followup) followup = toPrismaDate(followup);
      if (pending_inr > 0 && !followup) {
        throw new Error("next_followup_date is required when balance remains");
      }
      if (pending_inr <= 0) followup = null;

      const collection = await tx.fitness_collections.create({
        data: {
          client_id: finalClientId,
          external_buyer_id: finalExtId,
          collection_type: collectionType,
          title,
          total_inr: new Prisma.Decimal(total),
          received_inr: new Prisma.Decimal(received_inr),
          pending_inr: new Prisma.Decimal(pending_inr),
          next_followup_date: followup,
          assigned_to: assignee,
          status,
          notes: notes || line.notes || null,
          created_by: userId,
        }
      });
      const collectionId = collection.id;

      if (paidNow > 0) {
        await tx.fitness_collection_payments.create({
          data: {
            collection_id: collectionId,
            amount_inr: new Prisma.Decimal(paidNow),
            pay_mode: payMode,
            paid_at: txDate,
            notes: "Initial payment",
            created_by: userId
          }
        });
      }

      let linkedSupplementId = null;
      if (collectionType === "supplement" && finalClientId) {
        const sup = await tx.fitness_supplements.create({
          data: {
            client_id: finalClientId,
            product_name: title,
            prescribed_date: txDate,
            quantity: line.quantity || 1,
            mrp_inr: new Prisma.Decimal(line.mrp_inr ?? total),
            rate_inr: new Prisma.Decimal(line.rate_inr ?? total),
            notes: line.notes || notes || null
          }
        });
        linkedSupplementId = sup.id;
        await tx.fitness_collections.update({
          where: { id: collectionId },
          data: { linked_supplement_id: linkedSupplementId }
        });
      }

      const colRow = await tx.fitness_collections.findUnique({
        where: { id: collectionId }
      });
      await syncLinkedTransaction(tx, colRow, payMode, txDate);
      ids.push(collectionId);
      notifyQueue.push({ collectionId, pending_inr });
    }
    return ids;
  });

  const createdDetails = [];
  for (const item of notifyQueue) {
    const full = await getCollectionWithDetails(item.collectionId);
    if (!full) continue;
    createdDetails.push(full);
    if (item.pending_inr > 0) {
      await notifyCollectionCreated({ collection: full, actorUserId: userId });
    } else {
      await notifyCollectionPaid({ collection: full, actorUserId: userId });
    }
  }

  emitFitnessChanged();
  emitCollectionsChanged({ action: "create", count: createdDetails.length });

  for (const full of createdDetails) {
    const payments = Array.isArray(full.payments) ? full.payments : [];
    let receiptInvoiceId = null;
    for (const p of payments) {
      try {
        const receipt = await createReceiptForCollectionPayment(p.id, userId);
        if (receipt?.id) receiptInvoiceId = receipt.id;
      } catch (receiptErr) {
        console.warn("payment receipt (create visit):", receiptErr.message);
      }
    }
    full.receipt_invoice_id = receiptInvoiceId;
  }

  return createdDetails;
}

async function addPayment(req, collectionId, body) {
  const userId = Number(req.user?.id);
  const amount = roundMoney(body.amount_inr);
  if (amount <= 0) throw new Error("amount_inr must be > 0");

  const payMode = VALID_PAY_MODES.has(body.pay_mode) ? body.pay_mode : "GPay";
  const paidAt = toPrismaDate(body.paid_at) || new Date();

  let newPaymentId = null;
  const updated = await prisma.$transaction(async (tx) => {
    const col = await tx.fitness_collections.findUnique({
      where: { id: collectionId }
    });
    if (!col) throw new Error("Collection not found");
    if (col.status === "cancelled") throw new Error("Collection is cancelled");
    if (col.status === "paid") throw new Error("Collection is already fully paid");

    const remaining = roundMoney(col.total_inr - col.received_inr);
    if (amount > remaining + 0.01) {
      throw new Error(`Payment exceeds remaining balance (₹${remaining})`);
    }

    const payIns = await tx.fitness_collection_payments.create({
      data: {
        collection_id: collectionId,
        amount_inr: new Prisma.Decimal(amount),
        pay_mode: payMode,
        paid_at: paidAt,
        notes: body.notes || null,
        created_by: userId
      }
    });
    newPaymentId = payIns.id;

    const upCol = await recalcCollection(tx, collectionId);
    await syncLinkedTransaction(tx, upCol, payMode, paidAt);

    if (upCol.status === "paid") {
      await tx.fitness_collections.update({
        where: { id: collectionId },
        data: { next_followup_date: null }
      });
      upCol.next_followup_date = null;
      await notifyCollectionPaid({ collection: upCol, actorUserId: userId });
    }

    return upCol;
  });

  emitFitnessChanged();
  emitCollectionsChanged({ action: "payment", id: collectionId });

  let receipt_invoice_id = null;
  try {
    const receipt = await createReceiptForCollectionPayment(newPaymentId, userId);
    receipt_invoice_id = receipt?.id || null;
  } catch (receiptErr) {
    console.warn("payment receipt (add payment):", receiptErr.message);
  }

  const details = await getCollectionWithDetails(collectionId);
  return { ...details, receipt_invoice_id };
}

async function updateCollection(req, id, body) {
  const userId = Number(req.user?.id);
  const existing = await prisma.fitness_collections.findUnique({
    where: { id }
  });
  if (!existing) return null;

  const data = {};
  if (body.next_followup_date !== undefined) {
    data.next_followup_date = body.next_followup_date ? toPrismaDate(body.next_followup_date) : null;
  }
  if (body.assigned_to !== undefined) {
    data.assigned_to = Number(body.assigned_to) || userId;
  }
  if (body.notes !== undefined) {
    data.notes = body.notes;
  }
  if (body.status === "cancelled") {
    data.status = "cancelled";
  }

  if (Object.keys(data).length > 0) {
    data.updated_at = new Date();
    await prisma.fitness_collections.update({
      where: { id },
      data
    });

    if (body.next_followup_date !== undefined) {
      const col = await prisma.fitness_collections.findUnique({
        where: { id }
      });
      if (col?.linked_transaction_id) {
        const due = col.pending_inr > 0 && col.next_followup_date ? toPrismaDate(col.next_followup_date) : null;
        await prisma.fitness_transactions.update({
          where: { id: col.linked_transaction_id },
          data: { payment_due_date: due }
        });
        emitFitnessChanged();
      }
    }
  }

  emitCollectionsChanged({ action: "update", id });
  return getCollectionWithDetails(id);
}

async function markPaid(req, id, body) {
  const userId = Number(req.user?.id);
  const updated = await prisma.$transaction(async (tx) => {
    const col = await tx.fitness_collections.findUnique({
      where: { id }
    });
    if (!col) throw new Error("Collection not found");

    const remaining = roundMoney(col.pending_inr);
    if (remaining > 0) {
      const payMode = VALID_PAY_MODES.has(body?.pay_mode) ? body.pay_mode : "GPay";
      const paidAt = new Date();
      await tx.fitness_collection_payments.create({
        data: {
          collection_id: id,
          amount_inr: new Prisma.Decimal(remaining),
          pay_mode: payMode,
          paid_at: paidAt,
          notes: body?.notes || "Marked paid",
          created_by: userId
        }
      });
    }

    const up = await tx.fitness_collections.update({
      where: { id },
      data: {
        status: "paid",
        pending_inr: 0,
        received_inr: col.total_inr,
        next_followup_date: null,
        updated_at: new Date()
      }
    });

    await syncLinkedTransaction(tx, up, body?.pay_mode || "GPay", new Date());
    await notifyCollectionPaid({ collection: up, actorUserId: userId });

    return up;
  });

  emitFitnessChanged();
  emitCollectionsChanged({ action: "mark_paid", id });

  let receipt_invoice_id = null;
  try {
    const receipt = await createReceiptForLatestCollectionPayment(id, userId);
    receipt_invoice_id = receipt?.id || null;
  } catch (receiptErr) {
    console.warn("payment receipt (mark paid):", receiptErr.message);
  }

  const details = await getCollectionWithDetails(id);
  return { ...details, receipt_invoice_id };
}

async function fetchCollectionFollowups(date, userId, role) {
  const scope = canViewAll(role) ? "" : "AND (c.assigned_to = ? OR c.created_by = ?)";
  const scopeParams = canViewAll(role) ? [] : [userId, userId];
  const formattedDate = toSqlDate(date);

  let rows;
  if (canViewAll(role)) {
    rows = await prisma.$queryRaw`
       SELECT c.id, c.title, c.next_followup_date AS due_date, c.pending_inr, c.collection_type,
              c.client_id, c.status, c.id AS source_id, 'collection_followup' AS source_type,
              'high' AS priority,
              COALESCE(fc.full_name, eb.full_name) AS client_name,
              CASE WHEN c.next_followup_date < ${formattedDate} THEN 1 ELSE 0 END AS is_overdue
       FROM fitness_collections c
       LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
       LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
       WHERE c.status IN ('open','partial')
         AND c.pending_inr > 0
         AND c.next_followup_date IS NOT NULL
         AND c.next_followup_date <= ${formattedDate}
       ORDER BY c.next_followup_date ASC
       LIMIT 200
    `;
  } else {
    rows = await prisma.$queryRaw`
       SELECT c.id, c.title, c.next_followup_date AS due_date, c.pending_inr, c.collection_type,
              c.client_id, c.status, c.id AS source_id, 'collection_followup' AS source_type,
              'high' AS priority,
              COALESCE(fc.full_name, eb.full_name) AS client_name,
              CASE WHEN c.next_followup_date < ${formattedDate} THEN 1 ELSE 0 END AS is_overdue
       FROM fitness_collections c
       LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
       LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
       WHERE c.status IN ('open','partial')
         AND c.pending_inr > 0
         AND c.next_followup_date IS NOT NULL
         AND c.next_followup_date <= ${formattedDate}
         AND (c.assigned_to = ${userId} OR c.created_by = ${userId})
       ORDER BY c.next_followup_date ASC
       LIMIT 200
    `;
  }
  return rows.map((r) => ({
    ...r,
    pending_inr: r.pending_inr ? r.pending_inr.toString() : "0.00",
    status: "pending"
  }));
}

async function markCollectionFollowupDone(id, userId, body) {
  const followup =
    body?.followup_date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.followup_date).slice(0, 10))
      ? String(body.followup_date).slice(0, 10)
      : null;

  let newDate = followup;
  if (!newDate) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    newDate = d.toISOString().slice(0, 10);
  }

  const result = await prisma.fitness_collections.updateMany({
    where: {
      id,
      status: { in: ["open", "partial"] }
    },
    data: {
      next_followup_date: toPrismaDate(newDate),
      updated_at: new Date()
    }
  });

  if (result.count > 0) {
    const col = await prisma.fitness_collections.findUnique({
      where: { id },
      select: { linked_transaction_id: true, pending_inr: true }
    });
    if (col?.linked_transaction_id) {
      const due = col.pending_inr > 0 ? toPrismaDate(newDate) : null;
      await prisma.fitness_transactions.update({
        where: { id: col.linked_transaction_id },
        data: { payment_due_date: due }
      });
    }
  }
  return result.count > 0;
}

module.exports = {
  listCollections,
  getSummary,
  getCollectionWithDetails,
  createCollectionsFromVisit,
  addPayment,
  updateCollection,
  markPaid,
  fetchCollectionFollowups,
  markCollectionFollowupDone,
  canViewAll,
  sweepCollectionFollowupNotifications,
};
