const { pool } = require("../config/database");

/** Integers for LIMIT/OFFSET — NaN/Infinity breaks mysqld_stmt_execute on some MySQL builds. */
function safePageLimit(page, limit) {
  const lim = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const pg = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const off = (pg - 1) * lim;
  return { limit: lim, offset: off };
}

/** Never bind `undefined` to a prepared statement (ER_WRONG_ARGUMENTS / stmt_execute). */
function n(v, fallback = null) {
  return v === undefined ? fallback : v;
}

/**
 * Express `req.query` values are usually strings, but duplicate keys (or some proxies)
 * produce arrays. Binding a non-scalar to `?` causes "Incorrect arguments to mysqld_stmt_execute".
 */
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

async function getInvoices(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

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

    const conditions = ["i.type = ?", "i.is_deleted = 0"];
    const params = [type];

    if (status) {
      conditions.push("i.status = ?");
      params.push(status);
    }

    if (qText) {
      const like = `%${qText}%`;
      conditions.push("(i.customer_name LIKE ? OR i.invoice_number LIKE ? OR i.notes LIKE ?)");
      params.push(like, like, like);
    }

    if (staffIdRaw && staffIdRaw !== "all") {
      const sid = Number.parseInt(String(staffIdRaw), 10);
      if (Number.isFinite(sid) && sid > 0) {
        conditions.push("i.created_by = ?");
        params.push(sid);
      }
    }

    if (dateFrom) {
      conditions.push("i.invoice_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("i.invoice_date <= ?");
      params.push(dateTo);
    }

    if (gstBucket === "gst") {
      conditions.push("i.gst_mode IN ('igst','sgst_cgst')");
    } else if (gstBucket === "non_gst") {
      conditions.push("(i.gst_mode IS NULL OR i.gst_mode = 'none')");
    }

    const whereSql = conditions.join(" AND ");

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM invoices i WHERE ${whereSql}`,
      params
    );
    const rawTotal = countRows?.[0]?.total;
    const total = rawTotal != null ? Number(rawTotal) : 0;

    const [rows] = await pool.query(
      `SELECT i.*,
              u.full_name AS creator_name,
              u.email AS creator_email
       FROM invoices i
       LEFT JOIN users u ON u.id = i.created_by
       WHERE ${whereSql}
       ORDER BY i.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    res.json({ success: true, total, invoices: rows });
  } catch (err) {
    console.error("getInvoices", err.code || "", err.sqlMessage || err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

function parseLineItemsJson(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return [];
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
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

    const [rows] = await pool.query(
      `SELECT i.*,
              u.full_name AS creator_name,
              u.email AS creator_email
       FROM invoices i
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.id = ? AND i.is_deleted = 0
       LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const invoice = { ...row, line_items: parseLineItemsJson(row.line_items_json) };
    delete invoice.line_items_json;

    res.json({ success: true, invoice });
  } catch (err) {
    console.error("getInvoiceById", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createInvoice(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

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
      line_items_json,
    } = req.body;

    const uid = req.user.id;
    if (!invoice_date || !String(invoice_date).trim()) {
      return res.status(400).json({ success: false, message: "invoice_date is required" });
    }

    const year = new Date().getFullYear();
    const [[{ cnt }]] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM invoices WHERE YEAR(created_at) = ?",
      [year]
    );
    const invoiceNumber = `${String(type).toUpperCase().slice(0, 3)}-${year}-${String(cnt + 1).padStart(4, "0")}`;

    let lineJson = null;
    if (line_items_json != null) {
      lineJson = typeof line_items_json === "string" ? line_items_json : JSON.stringify(line_items_json);
    }

    const [result] = await pool.execute(
      `INSERT INTO invoices
         (invoice_number, type, customer_name, customer_email, vendor_name,
          invoice_date, due_date, subtotal, tax, total, status, notes, created_by,
          gst_mode, currency, customer_id, line_items_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        n(type, "sales"),
        customer_name || null,
        customer_email || null,
        vendor_name || null,
        String(invoice_date).trim(),
        due_date || null,
        subtotal || 0,
        tax || 0,
        total || 0,
        n(status, "draft"),
        notes || null,
        uid,
        n(gst_mode, "none"),
        n(currency, "INR"),
        customer_id ? Number(customer_id) : null,
        lineJson,
      ]
    );
    res.json({ success: true, id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) {
    console.error("createInvoice", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateInvoiceStatus(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status } = req.body;
    const allowed = ["draft", "sent", "paid", "cancelled"];
    if (!status || !allowed.includes(String(status))) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const [[row]] = await pool.execute(
      "SELECT created_by FROM invoices WHERE id = ? AND is_deleted = 0",
      [id]
    );
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }
    await pool.execute("UPDATE invoices SET status = ? WHERE id = ?", [
      String(status),
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteInvoice(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const [[row]] = await pool.execute(
      "SELECT created_by FROM invoices WHERE id = ? AND is_deleted = 0",
      [id]
    );
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (req.user.role !== "admin" && row.created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }
    await pool.execute(
      `UPDATE invoices
       SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW()
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getInvoices, getInvoiceById, createInvoice, updateInvoiceStatus, deleteInvoice };
