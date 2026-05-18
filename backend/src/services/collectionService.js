const { pool } = require("../config/database");
const { emitFitnessChanged, emitCollectionsChanged } = require("../realtime/meetingsRealtime");
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

/** This MySQL build rejects LIMIT/OFFSET as prepared-statement placeholders. */
function sqlLimitOffset(limit, offset) {
  const lim = Math.min(200, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const off = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  return `LIMIT ${lim} OFFSET ${off}`;
}

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

/** Normalize Date / ISO string / YYYY-MM-DD for MySQL DATE columns. */
function toSqlDate(value, fallback) {
  const fb =
    fallback && /^\d{4}-\d{2}-\d{2}$/.test(String(fallback).slice(0, 10))
      ? String(fallback).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  if (value == null || value === "") return fb;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return fb;
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
    const [found] = await pool.execute(
      "SELECT id FROM fitness_external_buyers WHERE phone = ? LIMIT 1",
      [phone]
    );
    if (found.length) return found[0].id;
  }
  const [ins] = await pool.execute(
    `INSERT INTO fitness_external_buyers (full_name, phone, referred_by_client_id, notes)
     VALUES (?, ?, ?, ?)`,
    [
      name,
      phone,
      eb.referred_by_client_id || null,
      eb.notes != null ? String(eb.notes) : null,
    ]
  );
  return ins.insertId;
}

async function syncLinkedTransaction(conn, collection, payMode, transactionDate) {
  const hasClient = Boolean(collection.client_id);
  const hasExternal = Boolean(collection.external_buyer_id);
  if (hasClient && hasExternal) {
    throw new Error("Transaction cannot have both client_id and external_buyer_id");
  }
  if (!hasClient && !hasExternal) {
    throw new Error("Transaction requires client_id or external_buyer_id");
  }

  const txType = mapTxType(collection.collection_type);
  const today = new Date().toISOString().slice(0, 10);
  const date = toSqlDate(transactionDate, toSqlDate(collection.created_at, today));

  if (collection.linked_transaction_id) {
    await conn.execute(
      `UPDATE fitness_transactions
       SET received_inr = ?, pending_inr = ?, rate_inr = ?, mrp_inr = ?, product_plan = ?, type = ?, pay_mode = ?
       WHERE id = ?`,
      [
        collection.received_inr,
        collection.pending_inr,
        collection.total_inr,
        collection.total_inr,
        collection.title,
        txType,
        payMode || "GPay",
        collection.linked_transaction_id,
      ]
    );
    return collection.linked_transaction_id;
  }

  const [result] = await conn.execute(
    `INSERT INTO fitness_transactions
      (client_id, external_buyer_id, transaction_date, product_plan, type, mrp_inr, rate_inr, received_inr, pending_inr, cost_inr, pay_mode, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      collection.client_id,
      collection.external_buyer_id,
      date,
      collection.title,
      txType,
      collection.total_inr,
      collection.total_inr,
      collection.received_inr,
      collection.pending_inr,
      payMode || "GPay",
      collection.notes ? `Collection #${collection.id}: ${collection.notes}` : `Collection #${collection.id}`,
    ]
  );
  const txId = result.insertId;
  await conn.execute(
    "UPDATE fitness_collections SET linked_transaction_id = ? WHERE id = ?",
    [txId, collection.id]
  );
  return txId;
}

async function recalcCollection(conn, collectionId) {
  const [[col]] = await conn.execute(
    "SELECT * FROM fitness_collections WHERE id = ? FOR UPDATE",
    [collectionId]
  );
  if (!col) return null;

  const [payments] = await conn.execute(
    "SELECT COALESCE(SUM(amount_inr), 0) AS total FROM fitness_collection_payments WHERE collection_id = ?",
    [collectionId]
  );
  const received = roundMoney(payments[0]?.total || 0);
  const total = roundMoney(col.total_inr);
  const { status, pending_inr, received_inr } = computeStatus(total, received);

  await conn.execute(
    `UPDATE fitness_collections SET received_inr = ?, pending_inr = ?, status = ?, updated_at = NOW() WHERE id = ?`,
    [received_inr, pending_inr, status, collectionId]
  );

  const [[updated]] = await conn.execute("SELECT * FROM fitness_collections WHERE id = ?", [
    collectionId,
  ]);
  return updated;
}

async function getCollectionWithDetails(id) {
  const [rows] = await pool.execute(
    `SELECT c.*,
            fc.full_name AS client_name,
            eb.full_name AS external_buyer_name,
            TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS assignee_name
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE c.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const [payments] = await pool.execute(
    `SELECT p.*, TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS created_by_name
     FROM fitness_collection_payments p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.collection_id = ?
     ORDER BY p.paid_at DESC, p.id DESC`,
    [id]
  );
  return { ...rows[0], payments };
}

function buildListWhere(req, params) {
  const clauses = ["1=1"];
  const role = req.user?.role;
  const userId = Number(req.user?.id);

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

  return { where: clauses.join(" AND "), params };
}

async function listCollections(req) {
  const limit = Math.min(200, Math.max(1, bindInt(req.query?.limit, 50)));
  const offset = Math.max(0, bindInt(req.query?.offset, 0));
  const { where, params } = buildListWhere(req, []);
  const pageSql = sqlLimitOffset(limit, offset);

  const [rows] = await pool.execute(
    `SELECT c.*,
            fc.full_name AS client_name,
            eb.full_name AS external_buyer_name,
            TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS assignee_name
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE ${where}
     ORDER BY
       CASE WHEN c.status IN ('open','partial') AND c.next_followup_date IS NOT NULL AND c.next_followup_date < CURDATE() THEN 0
            WHEN c.status IN ('open','partial') AND c.next_followup_date = CURDATE() THEN 1
            ELSE 2 END,
       c.next_followup_date ASC,
       c.updated_at DESC
     ${pageSql}`,
    params
  );

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE ${where}`,
    params
  );

  return { rows, total: countRows[0]?.total || 0, limit, offset };
}

async function getSummary(req) {
  const userId = Number(req.user?.id);
  const role = req.user?.role;
  const scope =
    canViewAll(role) ? "" : "AND (c.assigned_to = ? OR c.created_by = ?)";
  const scopeParams = canViewAll(role) ? [] : [userId, userId];
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `SELECT
       SUM(CASE WHEN c.status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date = ? THEN 1 ELSE 0 END) AS due_today,
       SUM(CASE WHEN c.status IN ('open','partial') AND c.next_followup_date < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN c.status IN ('open','partial') THEN c.pending_inr ELSE 0 END) AS total_pending_inr
     FROM fitness_collections c
     WHERE 1=1 ${scope}`,
    [today, today, ...scopeParams]
  );

  const r = rows[0] || {};
  return {
    open_count: Number(r.open_count) || 0,
    due_today: Number(r.due_today) || 0,
    overdue: Number(r.overdue) || 0,
    total_pending_inr: Number(r.total_pending_inr) || 0,
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
    const [c] = await pool.execute(
      "SELECT client_id FROM fitness_clients WHERE client_id = ?",
      [finalClientId]
    );
    if (!c.length) throw new Error("Client not found");
  } else if (external_buyer) {
    finalExtId = await resolveExternalBuyer(external_buyer);
    if (!finalExtId) throw new Error("external_buyer.full_name is required for walk-in");
  } else {
    throw new Error("client_id or external_buyer is required");
  }

  const assignee = Number(assigned_to) || userId;
  const payMode = VALID_PAY_MODES.has(pay_mode) ? pay_mode : "GPay";
  const txDate = toSqlDate(transaction_date);

  const createdIds = [];
  const notifyQueue = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const line of lines) {
      const collectionType = VALID_TYPES.has(line.collection_type)
        ? line.collection_type
        : "other";
      const title = String(line.title || line.product_name || "Collection").trim();
      if (!title) throw new Error("Each line requires a title");

      const total = roundMoney(line.total_inr ?? line.rate_inr ?? 0);
      const paidNow = roundMoney(line.paid_now_inr ?? line.received_inr ?? 0);
      if (paidNow > total) throw new Error(`Paid amount cannot exceed total for "${title}"`);
      if (total < 0) throw new Error("total_inr must be >= 0");

      const { status, pending_inr, received_inr } = computeStatus(total, paidNow);
      let followup = next_followup_date || line.next_followup_date || null;
      if (followup) followup = toSqlDate(followup);
      if (pending_inr > 0 && !followup) {
        throw new Error("next_followup_date is required when balance remains");
      }
      if (pending_inr <= 0) followup = null;

      const [ins] = await conn.execute(
        `INSERT INTO fitness_collections
          (client_id, external_buyer_id, collection_type, title, total_inr, received_inr, pending_inr,
           next_followup_date, assigned_to, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalClientId,
          finalExtId,
          collectionType,
          title,
          total,
          received_inr,
          pending_inr,
          followup,
          assignee,
          status,
          notes || line.notes || null,
          userId,
        ]
      );
      const collectionId = ins.insertId;

      if (paidNow > 0) {
        await conn.execute(
          `INSERT INTO fitness_collection_payments (collection_id, amount_inr, pay_mode, paid_at, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [collectionId, paidNow, payMode, txDate, "Initial payment", userId]
        );
      }

      let linkedSupplementId = null;
      if (collectionType === "supplement" && finalClientId) {
        const [sup] = await conn.execute(
          `INSERT INTO fitness_supplements (client_id, product_name, prescribed_date, quantity, mrp_inr, rate_inr, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            finalClientId,
            title,
            txDate,
            line.quantity || 1,
            line.mrp_inr ?? total,
            line.rate_inr ?? total,
            line.notes || notes || null,
          ]
        );
        linkedSupplementId = sup.insertId;
        await conn.execute(
          "UPDATE fitness_collections SET linked_supplement_id = ? WHERE id = ?",
          [linkedSupplementId, collectionId]
        );
      }

      const [[colRow]] = await conn.execute(
        "SELECT * FROM fitness_collections WHERE id = ?",
        [collectionId]
      );
      await syncLinkedTransaction(conn, colRow, payMode, txDate);
      createdIds.push(collectionId);
      notifyQueue.push({ collectionId, pending_inr });
    }

    await conn.commit();

    const created = [];
    for (const item of notifyQueue) {
      const full = await getCollectionWithDetails(item.collectionId);
      if (!full) continue;
      created.push(full);
      if (item.pending_inr > 0) {
        await notifyCollectionCreated({ collection: full, actorUserId: userId });
      } else {
        await notifyCollectionPaid({ collection: full, actorUserId: userId });
      }
    }

    emitFitnessChanged();
    emitCollectionsChanged({ action: "create", count: created.length });
    return created;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function addPayment(req, collectionId, body) {
  const userId = Number(req.user?.id);
  const amount = roundMoney(body.amount_inr);
  if (amount <= 0) throw new Error("amount_inr must be > 0");

  const payMode = VALID_PAY_MODES.has(body.pay_mode) ? body.pay_mode : "GPay";
  const paidAt = toSqlDate(body.paid_at);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[col]] = await conn.execute(
      "SELECT * FROM fitness_collections WHERE id = ? FOR UPDATE",
      [collectionId]
    );
    if (!col) throw new Error("Collection not found");
    if (col.status === "cancelled") throw new Error("Collection is cancelled");
    if (col.status === "paid") throw new Error("Collection is already fully paid");

    const remaining = roundMoney(col.total_inr - col.received_inr);
    if (amount > remaining + 0.01) {
      throw new Error(`Payment exceeds remaining balance (₹${remaining})`);
    }

    await conn.execute(
      `INSERT INTO fitness_collection_payments (collection_id, amount_inr, pay_mode, paid_at, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [collectionId, amount, payMode, paidAt, body.notes || null, userId]
    );

    const updated = await recalcCollection(conn, collectionId);
    await syncLinkedTransaction(conn, updated, payMode, paidAt);

    if (updated.status === "paid") {
      updated.next_followup_date = null;
      await conn.execute(
        "UPDATE fitness_collections SET next_followup_date = NULL WHERE id = ?",
        [collectionId]
      );
      await notifyCollectionPaid({ collection: updated, actorUserId: userId });
    }

    await conn.commit();
    emitFitnessChanged();
    emitCollectionsChanged({ action: "payment", id: collectionId });
    return getCollectionWithDetails(collectionId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function updateCollection(req, id, body) {
  const userId = Number(req.user?.id);
  const [[existing]] = await pool.execute(
    "SELECT * FROM fitness_collections WHERE id = ?",
    [id]
  );
  if (!existing) return null;

  const fields = [];
  const params = [];

  if (body.next_followup_date !== undefined) {
    fields.push("next_followup_date = ?");
    params.push(
      body.next_followup_date ? toSqlDate(body.next_followup_date) : null
    );
  }
  if (body.assigned_to !== undefined) {
    fields.push("assigned_to = ?");
    params.push(Number(body.assigned_to) || userId);
  }
  if (body.notes !== undefined) {
    fields.push("notes = ?");
    params.push(body.notes);
  }
  if (body.status === "cancelled") {
    fields.push("status = 'cancelled'");
  }

  if (!fields.length) return getCollectionWithDetails(id);

  params.push(id);
  await pool.execute(
    `UPDATE fitness_collections SET ${fields.join(", ")}, updated_at = NOW() WHERE id = ?`,
    params
  );

  emitCollectionsChanged({ action: "update", id });
  return getCollectionWithDetails(id);
}

async function markPaid(req, id, body) {
  const userId = Number(req.user?.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[col]] = await conn.execute(
      "SELECT * FROM fitness_collections WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!col) throw new Error("Collection not found");

    const remaining = roundMoney(col.pending_inr);
    if (remaining > 0) {
      const payMode = VALID_PAY_MODES.has(body?.pay_mode) ? body.pay_mode : "GPay";
      const paidAt = new Date().toISOString().slice(0, 10);
      await conn.execute(
        `INSERT INTO fitness_collection_payments (collection_id, amount_inr, pay_mode, paid_at, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, remaining, payMode, paidAt, body?.notes || "Marked paid", userId]
      );
    }

    await conn.execute(
      `UPDATE fitness_collections SET status = 'paid', pending_inr = 0, received_inr = total_inr, next_followup_date = NULL WHERE id = ?`,
      [id]
    );
    const [[updated]] = await conn.execute("SELECT * FROM fitness_collections WHERE id = ?", [id]);
    await syncLinkedTransaction(conn, updated, body?.pay_mode || "GPay", toSqlDate());
    await conn.commit();

    await notifyCollectionPaid({ collection: updated, actorUserId: userId });
    emitFitnessChanged();
    emitCollectionsChanged({ action: "mark_paid", id });
    return getCollectionWithDetails(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function fetchCollectionFollowups(date, userId, role) {
  const scope = canViewAll(role)
    ? ""
    : "AND (c.assigned_to = ? OR c.created_by = ?)";
  const scopeParams = canViewAll(role) ? [] : [userId, userId];

  const [rows] = await pool.execute(
    `SELECT c.id, c.title, c.next_followup_date AS due_date, c.pending_inr, c.collection_type,
            c.client_id, c.status, c.id AS source_id, 'collection_followup' AS source_type,
            'high' AS priority,
            COALESCE(fc.full_name, eb.full_name) AS client_name,
            CASE WHEN c.next_followup_date < ? THEN 1 ELSE 0 END AS is_overdue
     FROM fitness_collections c
     LEFT JOIN fitness_clients fc ON fc.client_id = c.client_id
     LEFT JOIN fitness_external_buyers eb ON eb.id = c.external_buyer_id
     WHERE c.status IN ('open','partial')
       AND c.next_followup_date IS NOT NULL
       AND c.next_followup_date <= ?
       ${scope}
     ORDER BY c.next_followup_date ASC
     LIMIT 200`,
    [date, date, ...scopeParams]
  );
  return rows.map((r) => ({ ...r, status: "pending" }));
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

  const [result] = await pool.execute(
    `UPDATE fitness_collections SET next_followup_date = ?, updated_at = NOW()
     WHERE id = ? AND status IN ('open','partial')`,
    [newDate, id]
  );
  return result.affectedRows > 0;
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
