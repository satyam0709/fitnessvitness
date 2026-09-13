"use strict";

const prisma = require("../config/prisma");
const { emitQuotationsChanged } = require("../realtime/meetingsRealtime");
const { sendEmailWithRetry } = require("../services/emailService");
const { emailShell, escapeHtml, detailsTable } = require("../services/emailTheme");
const { flattenQuoteGroups, buildQuotationDocumentHtml } = require("../services/quotationDocumentHtml");
const { getWebSettings } = require("../services/webSettingsService");

const QUOTE_FIELDS = new Set(["quotation_stage", "currency"]);
const BUILT_INS = {
  quotation_stage: ["draft", "submitted", "on hold", "approved", "cancelled"],
  currency: ["inr", "usd", "eur", "gbp"],
};

function safePageLimit(page, limit) {
  const lim = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const pg = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const off = (pg - 1) * lim;
  return { limit: lim, offset: off };
}

function queryScalar(val, fallback = null) {
  if (val === undefined || val === null) return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  if (v === undefined || v === null) return fallback;
  if (typeof v === "object") return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function gstTypeLabel(mode) {
  const m = String(mode || "none").toLowerCase();
  if (m === "none" || !m) return "Non GST";
  if (m === "igst") return "IGST";
  if (m === "sgst_cgst") return "GST";
  return "GST";
}

function parseGroupsJson(raw) {
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

function buildWaMeUrl(prefix, digits, msg) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}

function parseId(raw) {
  const id = Number.parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function dec(v) {
  return money(v);
}

function quotationPayload(body) {
  const {
    name,
    quotation_date,
    valid_until_days = 30,
    valid_until,
    opportunity_id,
    stage = "Draft",
    comment,
    account_id,
    customer_id,
    shipping_account_id,
    billing_contact_id,
    shipping_contact_id,
    billing_address,
    shipping_address,
    assigned_to,
    show_group_total = 0,
    show_grand_total = 0,
    discount_apply_on = "line_items",
    tax_apply_on = "line_items",
    currency = "INR",
    total_quantity = 0,
    sub_total = 0,
    total_discount = 0,
    total_tax = 0,
    line_total = 0,
    charges = 0,
    transport_charges = 0,
    extra_charges = 0,
    tax_on_charges = 0,
    adjustment = 0,
    grand_total = 0,
    line_items_groups,
    term_name,
    terms_description,
    payment_term_name,
    payment_terms_description,
    bank_name,
    bank_description,
  } = body || {};

  let lineItemsValue = null;
  if (line_items_groups != null) {
    if (typeof line_items_groups === "string") {
      try {
        lineItemsValue = JSON.parse(line_items_groups);
      } catch {
        lineItemsValue = null;
      }
    } else {
      lineItemsValue = line_items_groups;
    }
  }

  return {
    name,
    quotation_date,
    valid_until_days,
    valid_until,
    opportunity_id,
    stage,
    comment,
    account_id: numOrNull(account_id) || numOrNull(customer_id),
    shipping_account_id: numOrNull(shipping_account_id),
    billing_contact_id: numOrNull(billing_contact_id),
    shipping_contact_id: numOrNull(shipping_contact_id),
    billing_address,
    shipping_address,
    assigned_to: numOrNull(assigned_to),
    show_group_total: Boolean(show_group_total),
    show_grand_total: Boolean(show_grand_total),
    discount_apply_on,
    tax_apply_on,
    currency,
    total_quantity,
    sub_total,
    total_discount,
    total_tax,
    line_total,
    charges,
    transport_charges,
    extra_charges,
    tax_on_charges,
    adjustment,
    grand_total,
    lineItemsValue,
    term_name,
    terms_description,
    payment_term_name,
    payment_terms_description,
    bank_name,
    bank_description,
  };
}

function toWriteData(p, extra = {}) {
  return {
    name: String(p.name || "").trim(),
    quotation_date: new Date(p.quotation_date),
    valid_until_days: p.valid_until_days != null ? Number(p.valid_until_days) : 30,
    valid_until: p.valid_until ? new Date(p.valid_until) : null,
    opportunity_id: p.opportunity_id ? Number(p.opportunity_id) : null,
    stage: p.stage || "Draft",
    comment: p.comment || null,
    account_id: p.account_id,
    shipping_account_id: p.shipping_account_id,
    billing_contact_id: p.billing_contact_id,
    shipping_contact_id: p.shipping_contact_id,
    billing_address: p.billing_address || null,
    shipping_address: p.shipping_address || null,
    assigned_to: p.assigned_to,
    show_group_total: p.show_group_total,
    show_grand_total: p.show_grand_total,
    discount_apply_on: p.discount_apply_on || "line_items",
    tax_apply_on: p.tax_apply_on || "line_items",
    currency: p.currency || "INR",
    total_quantity: dec(p.total_quantity),
    sub_total: dec(p.sub_total),
    total_discount: dec(p.total_discount),
    total_tax: dec(p.total_tax),
    line_total: dec(p.line_total),
    charges: dec(p.charges),
    transport_charges: dec(p.transport_charges),
    extra_charges: dec(p.extra_charges),
    tax_on_charges: dec(p.tax_on_charges),
    adjustment: dec(p.adjustment),
    grand_total: dec(p.grand_total),
    line_items_groups_json: p.lineItemsValue,
    term_name: p.term_name || null,
    terms_description: p.terms_description || null,
    payment_term_name: p.payment_term_name || null,
    payment_terms_description: p.payment_terms_description || null,
    bank_name: p.bank_name || null,
    bank_description: p.bank_description || null,
    ...extra,
  };
}

function shapeQuotation(row, creator) {
  const groups = parseGroupsJson(row.line_items_groups_json);
  const { meta } = flattenQuoteGroups(groups);
  const out = {
    ...row,
    line_items_groups: groups,
    company_name: meta.company_name || "",
    customer_phone: meta.customer_phone || "",
    customer_email: meta.customer_email || "",
    gst_type: gstTypeLabel(meta.gst_mode || "none"),
    creator_name: creator
      ? `${creator.first_name || ""} ${creator.last_name || ""}`.trim()
      : null,
    creator_email: creator?.email || null,
  };
  delete out.line_items_groups_json;
  return out;
}

async function nextQuotationNo() {
  const year = new Date().getFullYear();
  const prefix = `QTN-${year}-`;
  const cnt = await prisma.quotations.count({
    where: { quotation_no: { startsWith: prefix } },
  });
  return `${prefix}${String(cnt + 1).padStart(4, "0")}`;
}

async function registerQuotationCustomOptionIfNeeded(fieldName, value) {
  if (!value || typeof value !== "string") return;
  const val = value.trim();
  if (!val) return;
  const list = BUILT_INS[fieldName];
  if (list && list.includes(val.toLowerCase())) return;
  try {
    await prisma.dropdown_options.upsert({
      where: {
        field_name_option_value: {
          field_name: fieldName,
          option_value: val,
        },
      },
      update: { option_label: val },
      create: {
        field_name: fieldName,
        option_value: val,
        option_label: val,
      },
    });
  } catch (err) {
    console.error(`Error registering quotation custom option for ${fieldName}:`, err.message);
  }
}

async function saveOrUpdateBankDetailsHelper(bankName, bankDescription) {
  const name = String(bankName || "").trim();
  if (!name) return;
  try {
    const existing = await prisma.bank_details.findFirst({
      where: { bank_name: name },
    });
    if (existing) {
      await prisma.bank_details.update({
        where: { id: existing.id },
        data: {
          bank_description: bankDescription || existing.bank_description,
          updated_at: new Date(),
        },
      });
    } else {
      await prisma.bank_details.create({
        data: {
          bank_name: name,
          bank_description: bankDescription || "",
        },
      });
    }
  } catch (err) {
    console.warn("Failed to auto-save bank details:", err.message);
  }
}

async function loadQuotation(rawId) {
  const id = parseId(rawId);
  if (!id) return { error: { status: 400, message: "Invalid id" } };
  const row = await prisma.quotations.findFirst({
    where: { id, is_deleted: false },
  });
  if (!row) return { error: { status: 404, message: "Not found" } };
  return { row, id };
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

async function sendQuotationCopyEmail({ row, groups, to }) {
  let company = {};
  try {
    const pack = await getWebSettings();
    company = pack?.data || {};
  } catch {
    /* ignore */
  }
  const htmlDoc = await buildQuotationDocumentHtml({
    row: { ...row, line_items_groups: groups },
    settings: company,
  });
  const cur = row.currency || "INR";
  const html = emailShell({
    headerTitle: `Quotation ${row.quotation_no}`,
    headerSubtitle: "Quotation",
    bodyHtml:
      detailsTable([
        { label: "Quotation", value: row.quotation_no },
        { label: "Customer", value: row.name || "—" },
        { label: "Total", value: `${cur} ${money(row.grand_total).toFixed(2)}` },
      ]) + `<div style="margin-top:16px;overflow:auto">${documentHtmlForEmail(htmlDoc)}</div>`,
  });
  return sendEmailWithRetry({ to, subject: `Quotation ${row.quotation_no}`, html });
}

async function getQuotations(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { limit: take, offset: skip } = safePageLimit(req.query.page, req.query.limit);
    const qText = queryScalar(req.query.q, null);
    const stage = queryScalar(req.query.stage, null);
    const opportunityId = queryScalar(req.query.opportunity_id, null);

    const where = { is_deleted: false };
    if (stage) where.stage = stage;
    if (opportunityId) {
      const oid = Number(opportunityId);
      if (Number.isFinite(oid)) where.opportunity_id = oid;
    }
    if (qText) {
      where.OR = [
        { name: { contains: qText } },
        { quotation_no: { contains: qText } },
        { comment: { contains: qText } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.quotations.count({ where }),
      prisma.quotations.findMany({
        where,
        orderBy: { created_at: "desc" },
        take,
        skip,
      }),
    ]);

    const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const creators = creatorIds.length
      ? await prisma.users.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, first_name: true, last_name: true, email: true },
        })
      : [];
    const creatorMap = new Map(creators.map((u) => [u.id, u]));
    const quotations = rows.map((r) => shapeQuotation(r, creatorMap.get(r.created_by)));
    res.json({ success: true, total, quotations });
  } catch (err) {
    console.error("getQuotations", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getQuotationById(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    let creator = null;
    if (loaded.row.created_by) {
      creator = await prisma.users.findUnique({
        where: { id: loaded.row.created_by },
        select: { first_name: true, last_name: true, email: true },
      });
    }
    res.json({ success: true, quotation: shapeQuotation(loaded.row, creator) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getQuotationPdf(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    let company = {};
    try {
      const pack = await getWebSettings();
      company = pack?.data || {};
    } catch {
      /* ignore */
    }
    const groups = parseGroupsJson(loaded.row.line_items_groups_json);
    const html = await buildQuotationDocumentHtml({
      row: { ...loaded.row, line_items_groups: groups },
      settings: company,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="quotation-${String(loaded.row.quotation_no || loaded.id).replace(/[^a-zA-Z0-9_-]/g, "_")}.html"`
    );
    res.send(html);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getQuotationWhatsapp(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    const groups = parseGroupsJson(loaded.row.line_items_groups_json);
    const { meta } = flattenQuoteGroups(groups);
    const phone = meta.customer_phone || "";
    const digits = digitsPhone(phone);
    if (!digits) {
      return res.status(400).json({ success: false, message: "Customer phone is missing on this quotation" });
    }
    const cur = loaded.row.currency || "INR";
    const msg =
      `Quotation ${loaded.row.quotation_no}\n` +
      `Customer: ${loaded.row.name || "-"}\n` +
      `Total: ${cur} ${money(loaded.row.grand_total).toFixed(2)}`;
    const wa_url = buildWaMeUrl("", digits, msg);
    res.json({ success: true, wa_url, phone: digits });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function emailQuotation(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    const groups = parseGroupsJson(loaded.row.line_items_groups_json);
    const { meta } = flattenQuoteGroups(groups);
    const to = validEmail(req.body?.to) || validEmail(meta.customer_email);
    if (!to) {
      return res.status(400).json({ success: false, message: "Customer email is missing on this quotation" });
    }
    const sent = await sendQuotationCopyEmail({ row: loaded.row, groups, to });
    if (!sent?.ok) {
      return res.status(502).json({ success: false, message: sent?.detail || sent?.reason || "Email failed" });
    }
    res.json({ success: true, message: "Email sent", to });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function createQuotation(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const p = quotationPayload(req.body);
    if (!p.name || !String(p.name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (!p.quotation_date) {
      return res.status(400).json({ success: false, message: "Quotation date is required" });
    }
    const quotationNo = await nextQuotationNo();
    const created = await prisma.quotations.create({
      data: toWriteData(p, {
        quotation_no: quotationNo,
        created_by: req.user.id,
      }),
    });
    await saveOrUpdateBankDetailsHelper(p.bank_name, p.bank_description);
    if (p.stage) await registerQuotationCustomOptionIfNeeded("quotation_stage", p.stage);
    if (p.currency) await registerQuotationCustomOptionIfNeeded("currency", p.currency);
    emitQuotationsChanged({ action: "create", id: created.id });
    res.json({ success: true, id: created.id, quotation_no: quotationNo });
  } catch (err) {
    console.error("createQuotation", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateQuotation(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    const p = quotationPayload(req.body);
    if (!p.name || !String(p.name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (!p.quotation_date) {
      return res.status(400).json({ success: false, message: "Quotation date is required" });
    }
    await prisma.quotations.update({
      where: { id: loaded.id },
      data: { ...toWriteData(p), updated_at: new Date() },
    });
    await saveOrUpdateBankDetailsHelper(p.bank_name, p.bank_description);
    if (p.stage) await registerQuotationCustomOptionIfNeeded("quotation_stage", p.stage);
    if (p.currency) await registerQuotationCustomOptionIfNeeded("currency", p.currency);
    emitQuotationsChanged({ action: "update", id: loaded.id });
    res.json({ success: true, id: loaded.id });
  } catch (err) {
    console.error("updateQuotation", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function duplicateQuotation(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    const quotationNo = await nextQuotationNo();
    const groups = parseGroupsJson(loaded.row.line_items_groups_json);
    const created = await prisma.quotations.create({
      data: {
        quotation_no: quotationNo,
        name: loaded.row.name,
        quotation_date: new Date(),
        valid_until_days: loaded.row.valid_until_days,
        valid_until: null,
        opportunity_id: loaded.row.opportunity_id,
        stage: "Draft",
        comment: loaded.row.comment,
        account_id: loaded.row.account_id,
        shipping_account_id: loaded.row.shipping_account_id,
        billing_contact_id: loaded.row.billing_contact_id,
        shipping_contact_id: loaded.row.shipping_contact_id,
        billing_address: loaded.row.billing_address,
        shipping_address: loaded.row.shipping_address,
        assigned_to: loaded.row.assigned_to,
        show_group_total: loaded.row.show_group_total,
        show_grand_total: loaded.row.show_grand_total,
        discount_apply_on: loaded.row.discount_apply_on,
        tax_apply_on: loaded.row.tax_apply_on,
        currency: loaded.row.currency,
        total_quantity: loaded.row.total_quantity,
        sub_total: loaded.row.sub_total,
        total_discount: loaded.row.total_discount,
        total_tax: loaded.row.total_tax,
        line_total: loaded.row.line_total,
        charges: loaded.row.charges,
        transport_charges: loaded.row.transport_charges,
        extra_charges: loaded.row.extra_charges,
        tax_on_charges: loaded.row.tax_on_charges,
        adjustment: loaded.row.adjustment,
        grand_total: loaded.row.grand_total,
        line_items_groups_json: groups,
        term_name: loaded.row.term_name,
        terms_description: loaded.row.terms_description,
        payment_term_name: loaded.row.payment_term_name,
        payment_terms_description: loaded.row.payment_terms_description,
        bank_name: loaded.row.bank_name,
        bank_description: loaded.row.bank_description,
        created_by: req.user.id,
      },
    });
    emitQuotationsChanged({ action: "duplicate", id: created.id, from: loaded.id });
    res.json({ success: true, id: created.id, quotation_no: quotationNo });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function deleteQuotation(req, res) {
  try {
    const loaded = await loadQuotation(req.params.id);
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message });
    await prisma.quotations.update({
      where: { id: loaded.id },
      data: { is_deleted: true, deleted_at: new Date(), updated_at: new Date() },
    });
    emitQuotationsChanged({ action: "delete", id: loaded.id });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function getBankDetails(_req, res) {
  try {
    const rows = await prisma.bank_details.findMany({ orderBy: { id: "desc" } });
    res.json({ success: true, banks: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createOrUpdateBankDetail(req, res) {
  try {
    const bank_name = String(req.body?.bank_name || "").trim();
    if (!bank_name) {
      return res.status(400).json({ success: false, message: "bank_name is required" });
    }
    const bank_description = req.body?.bank_description || "";
    const existing = await prisma.bank_details.findFirst({ where: { bank_name } });
    let row;
    if (existing) {
      row = await prisma.bank_details.update({
        where: { id: existing.id },
        data: { bank_description, updated_at: new Date() },
      });
    } else {
      row = await prisma.bank_details.create({
        data: { bank_name, bank_description },
      });
    }
    emitQuotationsChanged({ action: "bank_details", id: row.id });
    res.json({ success: true, bank: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getQuotationCustomOptions(_req, res) {
  try {
    const rows = await prisma.dropdown_options.findMany({
      where: { field_name: { in: ["quotation_stage", "currency"] } },
      select: { field_name: true, option_value: true, option_label: true },
    });
    const data = { quotation_stage: [], currency: [] };
    for (const r of rows) {
      if (data[r.field_name]) {
        data[r.field_name].push({ value: r.option_value, label: r.option_label });
      }
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function renameQuotationCustomOption(req, res) {
  try {
    const { fieldName, oldValue, newValue } = req.body || {};
    if (!fieldName || !oldValue || !newValue) {
      return res.status(400).json({ success: false, message: "fieldName, oldValue, and newValue are required" });
    }
    const field = String(fieldName).trim();
    if (!QUOTE_FIELDS.has(field)) {
      return res.status(400).json({ success: false, message: "Invalid field" });
    }
    const oldVal = String(oldValue).trim();
    const newVal = String(newValue).trim();
    const existing = await prisma.dropdown_options.findFirst({
      where: { field_name: field, option_value: oldVal },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Option not found" });
    const dup = await prisma.dropdown_options.findFirst({
      where: { field_name: field, option_value: newVal },
    });
    if (dup && dup.id !== existing.id) {
      await prisma.dropdown_options.delete({ where: { id: existing.id } });
    } else {
      await prisma.dropdown_options.update({
        where: { id: existing.id },
        data: { option_value: newVal, option_label: newVal },
      });
    }
    if (field === "quotation_stage") {
      await prisma.quotations.updateMany({
        where: { stage: oldVal, is_deleted: false },
        data: { stage: newVal },
      });
    }
    emitQuotationsChanged({ action: "options_changed" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteQuotationCustomOption(req, res) {
  try {
    const { fieldName, optionValue, transferTo } = req.body || {};
    if (!fieldName || !optionValue) {
      return res.status(400).json({ success: false, message: "fieldName and optionValue are required" });
    }
    const field = String(fieldName).trim();
    if (!QUOTE_FIELDS.has(field)) {
      return res.status(400).json({ success: false, message: "Invalid field" });
    }
    const val = String(optionValue).trim();
    const existing = await prisma.dropdown_options.findFirst({
      where: { field_name: field, option_value: val },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Option not found" });
    if (field === "quotation_stage" && transferTo) {
      await prisma.quotations.updateMany({
        where: { stage: val, is_deleted: false },
        data: { stage: String(transferTo) },
      });
    }
    await prisma.dropdown_options.delete({ where: { id: existing.id } });
    emitQuotationsChanged({ action: "options_changed" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getQuotations,
  getQuotationById,
  getQuotationPdf,
  getQuotationWhatsapp,
  emailQuotation,
  duplicateQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  getBankDetails,
  createOrUpdateBankDetail,
  getQuotationCustomOptions,
  renameQuotationCustomOption,
  deleteQuotationCustomOption,
};
