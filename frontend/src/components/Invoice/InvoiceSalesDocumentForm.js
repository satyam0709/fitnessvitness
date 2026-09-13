"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { getAllClients, getClient, searchClients } from "@/lib/fitnessApi";
import { openHtmlFromApi } from "@/lib/openPrintableHtml";
import styles from "@/app/(dashboard)/invoice/invoicePages.module.css";
import {
  applyLeadToDocument,
  createDebounced,
  fetchAllCustomers,
  fetchCustomerById,
  fetchLeadById,
  fetchLookupContacts,
  fieldsFromCustomer,
  invoicePartyFromFitnessClient,
  leadChangedEventApplies,
  mergeInvoiceParties,
  partySnapshot,
} from "./invoiceCustomer";
import InvoiceCustomerPicker from "./InvoiceCustomerPicker";
import InvoiceProductPicker from "./InvoiceProductPicker";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toYmd(d) {
  if (!d) return "";
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function notesWithoutBrochure(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .filter((line) => !/^Brochure:\s*/i.test(line.trim()))
    .join("\n")
    .trim();
}

function defaultRates(gstMode, gstPercent) {
  if (gstMode === "igst") return { sgst: "0", cgst: "0", igst: String(gstPercent || 0) };
  if (gstMode === "sgst_cgst") {
    const half = money((gstPercent || 0) / 2);
    return { sgst: String(half), cgst: String(money((gstPercent || 0) - half)), igst: "0" };
  }
  return { sgst: "0", cgst: "0", igst: "0" };
}

function emptyLine(opts = {}) {
  const rates = defaultRates(opts.gstMode || "none", opts.gstPercent || 0);
  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    product_name: "",
    hsn: opts.hsn || "",
    cost: "",
    price_incl: "",
    qty: "1",
    discount: "0",
    discount_type: "percent",
    comment: "",
    ...rates,
  };
}

function flattenQuoteGroups(groups) {
  if (!Array.isArray(groups)) return { items: [], meta: {} };
  const items = [];
  const meta = {};
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    if (g.gst_mode) meta.gst_mode = g.gst_mode;
    if (g.customer_email) meta.customer_email = g.customer_email;
    if (g.customer_phone) meta.customer_phone = g.customer_phone;
    if (g.company_name) meta.company_name = g.company_name;
    if (g.customer_address) meta.customer_address = g.customer_address;
    if (g.inclusive) meta.inclusive = !!g.inclusive;
    if (g.brochure) meta.brochure = !!g.brochure;
    if (g.brochure_id) meta.brochure_id = g.brochure_id;
    if (g.auto_email) meta.auto_email = !!g.auto_email;
    for (const i of Array.isArray(g.items) ? g.items : []) items.push(i);
  }
  return { items, meta };
}

function inferGstMode(meta, items) {
  if (meta.gst_mode) return meta.gst_mode;
  if (items.some((i) => i.sgst != null || i.cgst != null)) return "sgst_cgst";
  if (items.some((i) => i.igst != null)) return "igst";
  if (items.some((i) => Number(i.tax) > 0 && i.sgst == null && i.igst == null)) return "igst";
  return "none";
}

function lineFromSaved(i, gstMode, gstPercent, defaultHsn) {
  const rates = defaultRates(gstMode, gstPercent);
  const taxPct = Number(i.tax) || 0;
  if (gstMode === "igst") {
    rates.igst = i.igst != null ? String(i.igst) : taxPct ? String(taxPct) : rates.igst;
  }
  if (gstMode === "sgst_cgst") {
    if (i.sgst != null) rates.sgst = String(i.sgst);
    else if (taxPct) rates.sgst = String(money(taxPct / 2));
    if (i.cgst != null) rates.cgst = String(i.cgst);
    else if (taxPct) rates.cgst = String(money(taxPct - (Number(rates.sgst) || 0)));
  }
  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    product_name: i.product_name || "",
    hsn: i.hsn || defaultHsn || "",
    cost: String(i.cost ?? i.price ?? ""),
    price_incl: i.price_incl != null ? String(i.price_incl) : "",
    qty: String(i.qty ?? i.quantity ?? "1"),
    discount: String(i.discount || "0"),
    discount_type: i.discount_type || "percent",
    comment: i.comment || "",
    ...rates,
  };
}

function lineRate(row, gstMode) {
  if (gstMode === "none") return 0;
  if (gstMode === "igst") return Number(row.igst) || 0;
  return (Number(row.sgst) || 0) + (Number(row.cgst) || 0);
}

function lineMath(row, gstMode, inclusive) {
  const qty = Number(row.qty) || 0;
  const rate = lineRate(row, gstMode);
  const disc = Number(row.discount) || 0;
  const useIncl = inclusive && gstMode !== "none";

  if (useIncl) {
    const unitIncl = Number(row.price_incl) || money((Number(row.cost) || 0) * (1 + rate / 100));
    const gross = money(unitIncl * qty);
    const discountAmt =
      row.discount_type === "percent"
        ? money(Math.min(gross, (gross * disc) / 100))
        : money(Math.min(gross, disc));
    const after = money(Math.max(0, gross - discountAmt));
    const taxable = money(rate > 0 ? after / (1 + rate / 100) : after);
    const tax = money(after - taxable);
    const unitExcl = money(rate > 0 ? unitIncl / (1 + rate / 100) : unitIncl);
    return { gross, discountAmt, taxable, tax, total: after, unitExcl, unitIncl: money(unitIncl), rate };
  }

  const unitExcl = Number(row.cost) || 0;
  const gross = money(unitExcl * qty);
  const discountAmt =
    row.discount_type === "percent"
      ? money(Math.min(gross, (gross * disc) / 100))
      : money(Math.min(gross, disc));
  const taxable = money(Math.max(0, gross - discountAmt));
  const tax = money((taxable * rate) / 100);
  const total = money(taxable + tax);
  return {
    gross,
    discountAmt,
    taxable,
    tax,
    total,
    unitExcl: money(unitExcl),
    unitIncl: money(unitExcl * (1 + rate / 100)),
    rate,
  };
}

function packForGst(settings, gstMode) {
  if (!settings) return null;
  return gstMode === "none" ? settings.invoice_nongst : settings.invoice_gst;
}

function companyAddress(s) {
  if (!s) return "";
  return [s.address, s.city, s.state, s.country].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}

function AuthImg({ path, alt, className, style }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    let obj = null;
    (async () => {
      if (!path) {
        setSrc(null);
        return;
      }
      try {
        const res = await apiFetch(String(path).replace(/^\/api/, ""));
        if (!res.ok) return;
        const blob = await res.blob();
        obj = URL.createObjectURL(blob);
        if (alive) setSrc(obj);
      } catch {
        if (alive) setSrc(null);
      }
    })();
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path]);
  if (!src) return null;
  return <img src={src} alt={alt || ""} className={className} style={style} />;
}

function InnerForm() {
  const { isLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = searchParams.get("lead_id");
  const quotationId = searchParams.get("quotation_id");
  const invoiceId = searchParams.get("id");
  const isEdit = Boolean(invoiceId);

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [invoiceSettingsComplete, setInvoiceSettingsComplete] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [fitnessClients, setFitnessClients] = useState([]);
  const [liveFitness, setLiveFitness] = useState([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [existingAmountPaid, setExistingAmountPaid] = useState(0);
  const [existingStatus, setExistingStatus] = useState("draft");
  const [editBlocked, setEditBlocked] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [gstMode, setGstMode] = useState("none");
  const [inclusiveGst, setInclusiveGst] = useState(false);
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);
  const [comments, setComments] = useState("");
  const [terms, setTerms] = useState("");
  const [paidType, setPaidType] = useState("unpaid");
  const [brochureId, setBrochureId] = useState("");
  const [brochureHint, setBrochureHint] = useState("");
  const [brochures, setBrochures] = useState([]);
  const [emailAuto, setEmailAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [quotationApplied, setQuotationApplied] = useState(false);
  const [invoiceApplied, setInvoiceApplied] = useState(false);
  const [leadRecord, setLeadRecord] = useState(null);
  const pickSeq = useRef(0);
  const skipRateSync = useRef(false);
  const partyLiveRef = useRef({});
  const commentsLiveRef = useRef("");
  const lastLeadPartyRef = useRef("");
  const lastLeadCommentRef = useRef("");
  const leadPrefillDoneRef = useRef(false);

  useEffect(() => {
    setInvoiceApplied(false);
    setEditBlocked(false);
    setBrochureHint("");
  }, [invoiceId]);

  useEffect(() => {
    setQuotationApplied(false);
  }, [quotationId]);

  partyLiveRef.current = {
    name: customerName,
    email: customerEmail,
    phone: customerPhone,
    company: companyName,
    address: customerAddress,
  };
  commentsLiveRef.current = comments;

  function applyPartyFields(party) {
    setCustomerName(party?.name || "");
    setCustomerEmail(party?.email || "");
    setCustomerPhone(party?.phone || "");
    setCompanyName(party?.company || "");
    setCustomerAddress(party?.address || "");
  }

  function applyCustomerFields(row) {
    applyPartyFields(fieldsFromCustomer(row));
  }

  const loadSettings = useCallback(async () => {
    if (!isLoaded) return;
    setSettingsLoading(true);
    try {
      const res = await apiFetch("/v2/settings/company");
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const row = d.data || null;
        setCompanySettings(row);
        setInvoiceSettingsComplete(!!d.invoiceSettingsComplete);
        if (!quotationId && !invoiceId) {
          if (row?.invoice_currency) setCurrency(row.invoice_currency);
          if (row?.invoice_gst_mode) setGstMode(row.invoice_gst_mode);
        }
        setEmailAuto(!!row?.invoice_email_automation);
      }
    } finally {
      setSettingsLoading(false);
    }
  }, [isLoaded, quotationId, invoiceId]);

  const loadCustomers = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const [cust, cons, fitness] = await Promise.all([
        fetchAllCustomers(apiFetch),
        fetchLookupContacts(apiFetch),
        getAllClients().catch(() => []),
      ]);
      setCustomers(cust);
      setContacts(cons);
      setFitnessClients(Array.isArray(fitness) ? fitness.slice(0, 400) : []);
    } catch {
      setCustomers([]);
      setContacts([]);
      setFitnessClients([]);
    }
  }, [isLoaded]);

  const loadProducts = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/v2/invoices/products");
      const d = await res.json().catch(() => ({}));
      setProducts(res.ok && Array.isArray(d.products) ? d.products : []);
    } catch {
      setProducts([]);
    }
  }, [isLoaded]);

  const loadBrochures = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/v2/brochures?type=paid_invoice");
      const d = await res.json().catch(() => ({}));
      setBrochures(res.ok && Array.isArray(d.brochures) ? d.brochures : []);
    } catch {
      setBrochures([]);
    }
  }, [isLoaded]);

  const loadLead = useCallback(async () => {
    if (!isLoaded || quotationId || invoiceId || !leadId) return;
    try {
      const lead = await fetchLeadById(apiFetch, leadId);
      setLeadRecord(lead);
    } catch (e) {
      setLeadRecord(null);
      setErr(e.message || "Lead not found");
    }
  }, [isLoaded, quotationId, invoiceId, leadId]);

  useEffect(() => {
    loadSettings();
    loadCustomers();
    loadProducts();
    loadBrochures();
  }, [loadSettings, loadCustomers, loadProducts, loadBrochures]);

  useEffect(() => {
    leadPrefillDoneRef.current = false;
    lastLeadPartyRef.current = "";
    lastLeadCommentRef.current = "";
    setLeadRecord(null);
    if (!isLoaded || quotationId || invoiceId || !leadId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const lead = await fetchLeadById(apiFetch, leadId);
        if (!cancelled) setLeadRecord(lead);
      } catch (e) {
        if (!cancelled) {
          setLeadRecord(null);
          setErr(e.message || "Lead not found");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, quotationId, invoiceId, leadId]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    const refreshLead = createDebounced(loadLead, 300);
    const unsub = subscribeCrmLive(
      [
        "invoices:changed",
        "brochures:changed",
        "leads:changed",
        "contacts:changed",
        "fitness:changed",
      ],
      (event, payload) => {
        if (event === "invoices:changed") loadProducts();
        else if (event === "brochures:changed") loadBrochures();
        else if (event === "contacts:changed" || event === "fitness:changed") loadCustomers();
        else if (event === "leads:changed" && leadChangedEventApplies(payload, leadId)) refreshLead();
      }
    );
    return () => {
      refreshLead.cancel();
      unsub();
    };
  }, [isLoaded, loadCustomers, loadProducts, loadBrochures, loadLead, leadId]);

  const parties = useMemo(
    () => mergeInvoiceParties(customers, contacts, [...fitnessClients, ...liveFitness]),
    [customers, contacts, fitnessClients, liveFitness]
  );

  const onPartySearch = useMemo(
    () =>
      createDebounced(async (q) => {
        if (!String(q || "").trim()) {
          setLiveFitness([]);
          return;
        }
        try {
          const rows = await searchClients(q);
          setLiveFitness(Array.isArray(rows) ? rows : []);
        } catch {
          setLiveFitness([]);
        }
      }, 250),
    []
  );

  useEffect(() => () => onPartySearch.cancel?.(), [onPartySearch]);

  useEffect(() => {
    if (brochureId !== "pending" || !brochures.length) return;
    setBrochureId(String(brochures[0].id));
  }, [brochureId, brochures]);

  useEffect(() => {
    if (!brochureHint || !brochures.length) return;
    const hit = brochures.find((b) => String(b.name).trim() === brochureHint);
    if (hit) setBrochureId(String(hit.id));
  }, [brochureHint, brochures]);

  useEffect(() => {
    if (quotationId || invoiceId || !leadRecord) return;
    const applied = applyLeadToDocument({ lead: leadRecord, customers });
    const dirty =
      leadPrefillDoneRef.current &&
      partySnapshot(partyLiveRef.current) !== lastLeadPartyRef.current;
    if (dirty) return;
    setCustomerId(applied.customerId);
    applyPartyFields(applied.fields);
    if (applied.currency) setCurrency(applied.currency);
    if (
      applied.comment &&
      (!commentsLiveRef.current || commentsLiveRef.current === lastLeadCommentRef.current)
    ) {
      setComments(applied.comment);
      lastLeadCommentRef.current = applied.comment;
    }
    lastLeadPartyRef.current = partySnapshot(applied.fields);
    leadPrefillDoneRef.current = true;
  }, [quotationId, invoiceId, leadRecord, customers]);

  const pack = useMemo(() => packForGst(companySettings, gstMode), [companySettings, gstMode]);

  useEffect(() => {
    if (quotationApplied) return;
    setTerms(pack?.terms || "");
  }, [pack, quotationApplied]);

  const gstPercent = gstMode === "none" ? 0 : Number(pack?.gst_percent ?? companySettings?.invoice_gst?.gst_percent) || 0;
  const defaultHsn = String(companySettings?.invoice_hsn || "");
  const taxOn = gstMode !== "none";
  const useInclusive = inclusiveGst && taxOn;

  useEffect(() => {
    if (skipRateSync.current) return;
    const rates = defaultRates(gstMode, gstPercent);
    setLines((prev) => prev.map((row) => ({ ...row, ...rates })));
  }, [gstMode, gstPercent]);

  useEffect(() => {
    if (!defaultHsn) return;
    setLines((prev) => prev.map((row) => (row.hsn ? row : { ...row, hsn: defaultHsn })));
  }, [defaultHsn]);

  useEffect(() => {
    if (!quotationId || invoiceId || !isLoaded || settingsLoading || quotationApplied) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/v2/quotations/${encodeURIComponent(quotationId)}`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.quotation) throw new Error(d.message || "Quotation not found");
        if (cancelled) return;
        const q = d.quotation;
        const { items, meta } = flattenQuoteGroups(q.line_items_groups);
        const mode = inferGstMode(meta, items);
        skipRateSync.current = true;

        let name = String(q.name || "").trim();
        let email = String(meta.customer_email || "").trim();
        let phone = String(meta.customer_phone || "").trim();
        let company = String(meta.company_name || q.company_name || "").trim();
        let address = String(meta.customer_address || q.billing_address || "").trim();
        let cid = q.account_id || q.customer_id || null;

        if (cid) {
          const fresh = await fetchCustomerById(apiFetch, cid);
          if (cancelled) return;
          if (fresh) {
            const f = fieldsFromCustomer(fresh);
            if (!name) name = f.name;
            if (!email) email = f.email;
            if (!phone) phone = f.phone;
            if (!company) company = f.company;
            if (!address) address = f.address;
          }
        }

        setCustomerName(name);
        setCustomerEmail(email);
        setCustomerPhone(phone);
        setCompanyName(company);
        setCustomerAddress(address);
        setCustomerId(cid ? String(cid) : "");
        setCurrency(q.currency || "INR");
        setGstMode(mode);
        setInclusiveGst(!!meta.inclusive);
        setBrochureId(meta.brochure_id ? String(meta.brochure_id) : meta.brochure ? "pending" : "");
        if (meta.auto_email) setEmailAuto(true);
        const comment = String(q.comment || "")
          .split(/\r?\n/)
          .filter((line) => !/^Brochure:\s*/i.test(line.trim()))
          .join("\n")
          .trim();
        setComments(comment);
        if (q.terms_description) setTerms(q.terms_description);
        const mapped = items.length
          ? items.map((i) => lineFromSaved(i, mode, gstPercent, defaultHsn))
          : [emptyLine({ gstMode: mode, gstPercent, hsn: defaultHsn })];
        setLines(mapped);
        setPaidType("unpaid");
        setQuotationApplied(true);
        queueMicrotask(() => {
          skipRateSync.current = false;
        });
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load quotation");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quotationId, invoiceId, isLoaded, settingsLoading, quotationApplied, gstPercent, defaultHsn]);

  useEffect(() => {
    if (!invoiceId || !isLoaded || settingsLoading || invoiceApplied) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/v2/invoices/${encodeURIComponent(invoiceId)}`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.invoice) throw new Error(d.message || "Invoice not found");
        if (cancelled) return;
        const inv = d.invoice;
        if (
          inv.is_payment_receipt ||
          inv.source_type === "collection_payment" ||
          inv.source_type === "fitness_transaction"
        ) {
          setEditBlocked(true);
          setErr("Payment receipts cannot be edited as invoices.");
          setInvoiceApplied(true);
          return;
        }
        const items = Array.isArray(inv.line_items) ? inv.line_items : [];
        const mode = inferGstMode({ gst_mode: inv.gst_mode }, items);
        skipRateSync.current = true;
        setInvoiceNumber(inv.invoice_number || "");
        setCustomerName(inv.customer_name || "");
        setCustomerEmail(inv.customer_email || "");
        setCustomerPhone(inv.customer_phone || "");
        setCompanyName(inv.company_name || "");
        setCustomerAddress(inv.billing_address || "");
        setCustomerId(inv.customer_id ? String(inv.customer_id) : "");
        setInvoiceDate(toYmd(inv.invoice_date) || new Date().toISOString().slice(0, 10));
        setDueDate(toYmd(inv.due_date));
        setCurrency(inv.currency || "INR");
        setGstMode(mode);
        setInclusiveGst(items.some((i) => i.inclusive));
        setComments(notesWithoutBrochure(inv.notes));
        const mapped = items.length
          ? items.map((i) => lineFromSaved(i, mode, gstPercent, defaultHsn))
          : [emptyLine({ gstMode: mode, gstPercent, hsn: defaultHsn })];
        setLines(mapped);
        const paid = Number(inv.amount_paid || 0);
        const tot = Number(inv.total || 0);
        setExistingAmountPaid(paid);
        setExistingStatus(inv.status || "draft");
        if (tot > 0 && paid >= tot) setPaidType("paid");
        else if (paid > 0) setPaidType("half");
        else setPaidType("unpaid");
        const brochureLine = String(inv.notes || "")
          .split(/\r?\n/)
          .find((line) => /^Brochure:\s*/i.test(line.trim()));
        if (brochureLine) {
          setBrochureHint(brochureLine.replace(/^Brochure:\s*/i, "").trim());
        }
        setInvoiceApplied(true);
        queueMicrotask(() => {
          skipRateSync.current = false;
        });
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load invoice");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, isLoaded, settingsLoading, invoiceApplied, gstPercent, defaultHsn]);

  useEffect(() => {
    if (!quotationApplied || !customers.length) return;
    const nameKey = String(customerName || "").trim().toLowerCase();
    if (!nameKey && !customerId) return;

    let hit = null;
    if (customerId) {
      hit = customers.find((c) => String(c.id) === String(customerId)) || null;
    }
    if (!hit && nameKey) {
      hit = customers.find((c) => String(c.name || "").trim().toLowerCase() === nameKey) || null;
    }
    if (!hit) return;

    const f = fieldsFromCustomer(hit);
    if (!customerId && hit.id) setCustomerId(String(hit.id));
    if (!companyName.trim() && f.company) setCompanyName(f.company);
    if (!customerEmail.trim() && f.email) setCustomerEmail(f.email);
    if (!customerPhone.trim() && f.phone) setCustomerPhone(f.phone);
    if (!customerAddress.trim() && f.address) setCustomerAddress(f.address);
  }, [quotationApplied, customers, customerId, customerName, companyName, customerEmail, customerPhone, customerAddress]);

  const lineCalcs = useMemo(
    () => lines.map((row) => lineMath(row, gstMode, useInclusive)),
    [lines, gstMode, useInclusive]
  );
  const gross = useMemo(() => money(lineCalcs.reduce((s, m) => s + m.gross, 0)), [lineCalcs]);
  const discountTotal = useMemo(() => money(lineCalcs.reduce((s, m) => s + m.discountAmt, 0)), [lineCalcs]);
  const taxable = useMemo(() => money(lineCalcs.reduce((s, m) => s + m.taxable, 0)), [lineCalcs]);
  const tax = useMemo(() => money(lineCalcs.reduce((s, m) => s + m.tax, 0)), [lineCalcs]);
  const total = useMemo(() => money(lineCalcs.reduce((s, m) => s + m.total, 0)), [lineCalcs]);
  const amountPaid = useMemo(() => {
    if (isEdit) return money(existingAmountPaid);
    if (paidType === "paid") return total;
    if (paidType === "half") return money(total / 2);
    return 0;
  }, [isEdit, existingAmountPaid, paidType, total]);
  const totalDue = useMemo(() => money(Math.max(0, total - amountPaid)), [total, amountPaid]);

  const currencyOptions = useMemo(() => {
    const set = new Set(CURRENCIES);
    if (currency) set.add(currency);
    return Array.from(set);
  }, [currency]);

  function updateLine(uid, patch) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.uid !== uid) return row;
        const next = { ...row, ...patch };
        if (useInclusive && ("sgst" in patch || "cgst" in patch || "igst" in patch)) {
          const rate = lineRate(next, gstMode);
          const incl = Number(next.price_incl) || 0;
          if (incl) next.cost = String(money(rate > 0 ? incl / (1 + rate / 100) : incl));
        }
        return next;
      })
    );
  }

  function updateCost(uid, cost) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.uid !== uid) return row;
        const next = { ...row, cost };
        if (useInclusive) {
          const rate = lineRate(next, gstMode);
          next.price_incl = String(money((Number(cost) || 0) * (1 + rate / 100)));
        }
        return next;
      })
    );
  }

  function updatePriceIncl(uid, price_incl) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.uid !== uid) return row;
        const next = { ...row, price_incl };
        const rate = lineRate(next, gstMode);
        next.cost = String(money(rate > 0 ? (Number(price_incl) || 0) / (1 + rate / 100) : Number(price_incl) || 0));
        return next;
      })
    );
  }

  function toggleInclusive() {
    const next = !inclusiveGst;
    setInclusiveGst(next);
    if (next && gstMode !== "none") {
      setLines((prev) =>
        prev.map((row) => {
          const m = lineMath(row, gstMode, false);
          return { ...row, price_incl: String(m.unitIncl || "") };
        })
      );
    }
  }

  function onPickProduct(uid, product) {
    if (!product) return;
    const rates = {};
    if (gstMode === "igst" && product.igst != null && Number.isFinite(Number(product.igst))) {
      rates.igst = String(product.igst);
    }
    if (gstMode === "sgst_cgst") {
      if (product.sgst != null && Number.isFinite(Number(product.sgst))) rates.sgst = String(product.sgst);
      if (product.cgst != null && Number.isFinite(Number(product.cgst))) rates.cgst = String(product.cgst);
    }
    const cost = product.cost != null ? String(product.cost) : "";
    const nextRates = { ...defaultRates(gstMode, gstPercent), ...rates };
    const rate = lineRate({ ...nextRates }, gstMode);
    updateLine(uid, {
      product_name: product.product_name || "",
      hsn: product.hsn || defaultHsn,
      cost,
      price_incl: useInclusive ? String(money((Number(cost) || 0) * (1 + rate / 100))) : "",
      ...nextRates,
    });
  }

  function lineDefaults() {
    return emptyLine({ gstMode, gstPercent, hsn: defaultHsn });
  }

  function bumpQty(uid, delta) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.uid !== uid) return row;
        const q = Math.max(1, (Number(row.qty) || 0) + delta);
        return { ...row, qty: String(q) };
      })
    );
  }

  async function onPickParty(item) {
    if (!item) return;
    applyPartyFields(item);
    let cid = item.customerId;
    if (!cid && item.email) {
      const hit = customers.find((c) => String(c.email || "").toLowerCase() === item.email.toLowerCase());
      if (hit) cid = hit.id;
    }
    if (!cid && item.name) {
      const hit = customers.find((c) => String(c.name || "").toLowerCase() === item.name.toLowerCase());
      if (hit) cid = hit.id;
    }
    setCustomerId(cid ? String(cid) : "");
    const seq = ++pickSeq.current;
    if (item.fitnessClientId) {
      try {
        const fresh = await getClient(item.fitnessClientId);
        if (seq !== pickSeq.current || !fresh) return;
        applyPartyFields(invoicePartyFromFitnessClient(fresh));
      } catch {
        /* keep picker values */
      }
      return;
    }
    if (!cid) return;
    const fresh = await fetchCustomerById(apiFetch, cid);
    if (seq !== pickSeq.current || !fresh) return;
    applyCustomerFields(fresh);
  }

  function paidStatus() {
    if (paidType === "paid") return "paid";
    if (paidType === "half") return "sent";
    return "draft";
  }

  async function openPdf(id, asDownload) {
    if (asDownload) {
      const res = await apiFetch(`/v2/invoices/${id}/pdf`);
      if (!res.ok) throw new Error("PDF failed");
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${id}.html`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    await openHtmlFromApi(`/v2/invoices/${id}/pdf`);
  }

  async function saveInvoice(asDownload) {
    setErr(null);
    if (editBlocked) {
      setErr("Payment receipts cannot be edited as invoices.");
      return;
    }
    if (!customerName.trim()) {
      setErr("Customer name is required.");
      return;
    }
    if (emailAuto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customerEmail || "").trim())) {
      setErr("Customer email is missing on this invoice");
      return;
    }
    const payloadLines = lines
      .filter((l) => String(l.product_name).trim())
      .map((l) => {
        const m = lineMath(l, gstMode, useInclusive);
        return {
          product_name: l.product_name.trim(),
          cost: m.unitExcl,
          qty: Number(l.qty) || 0,
          discount: Number(l.discount) || 0,
          discount_type: l.discount_type,
          subtotal: m.taxable,
          tax: m.tax,
          total: m.total,
          hsn: String(l.hsn || "").trim() || undefined,
          sgst: gstMode === "sgst_cgst" ? Number(l.sgst) || 0 : undefined,
          cgst: gstMode === "sgst_cgst" ? Number(l.cgst) || 0 : undefined,
          igst: gstMode === "igst" ? Number(l.igst) || 0 : undefined,
          comment: String(l.comment || "").trim() || undefined,
          inclusive: useInclusive || undefined,
          price_incl: useInclusive ? m.unitIncl : undefined,
        };
      });
    if (!payloadLines.length) {
      setErr("Add at least one line item.");
      return;
    }

    const noteParts = [];
    if (comments.trim()) noteParts.push(comments.trim());
    const pickedBrochure = brochures.find((b) => String(b.id) === String(brochureId));
    if (pickedBrochure) noteParts.push(`Brochure: ${pickedBrochure.name}`);
    if (terms.trim() && terms.trim() !== String(pack?.terms || "").trim()) noteParts.push(terms.trim());
    if (!isEdit && quotationId) noteParts.push(`Converted from quotation #${quotationId}`);

    const payload = {
      type: "sales",
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim() || null,
      customer_phone: customerPhone.trim() || null,
      company_name: companyName.trim() || null,
      billing_address: customerAddress.trim() || null,
      customer_id: customerId ? Number(customerId) : null,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      subtotal: taxable,
      tax,
      total,
      gst_mode: gstMode,
      currency,
      line_items_json: payloadLines,
      notes: noteParts.join("\n\n") || null,
      send_email_copy: emailAuto,
    };
    if (!isEdit) {
      payload.amount_paid = amountPaid;
      payload.status = paidStatus();
    }

    setSaving(true);
    try {
      const res = isEdit
        ? await apiFetch(`/v2/invoices/${encodeURIComponent(invoiceId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : await apiFetch("/v2/invoices", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || (isEdit ? "Could not update invoice" : "Could not create invoice"));
        return;
      }
      const id = json.id || invoiceId;
      if (emailAuto && json.email_error) {
        setErr(json.email_error);
      }
      try {
        await openPdf(id, asDownload);
      } catch {
        /* invoice is saved */
      }
      router.push(`/invoice/sales/${id}`);
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  const showSettingsBanner = !settingsLoading && !invoiceSettingsComplete;
  return (
    <div className={styles.docPage}>
      <div className={styles.docToolbar}>
        <Link href="/invoice/sales" className={styles.docBack}>
          Back to list
        </Link>
        {isEdit && invoiceNumber ? (
          <span className={styles.docMuted}>{invoiceNumber}</span>
        ) : quotationId ? (
          <span className={styles.docMuted}>Convert quotation</span>
        ) : null}
      </div>

      {showSettingsBanner ? (
        <div className={styles.settingsBanner}>
          <div className={styles.settingsBannerBody}>
            <i className="fas fa-info-circle" aria-hidden />
            <div>
              <strong>Invoice settings are incomplete</strong>
              <p>You can still create an invoice. Add company, bank, and GST details for a complete document.</p>
            </div>
          </div>
          <Link href="/settings/invoice" className={styles.settingsBannerBtn}>
            Invoice settings
          </Link>
        </div>
      ) : null}

      {err ? <p className={styles.err}>{err}</p> : null}

      <div className={styles.docCard}>
          <div className={styles.docHeader}>
            <div className={styles.docBrand}>
              <AuthImg path={companySettings?.logo_url} alt="Logo" className={styles.docLogo} />
              <div className={styles.docBrandText}>
                <p className={styles.docCompany}>{companySettings?.company_name || "—"}</p>
                {companySettings?.phone ? <p className={styles.docMuted}>{companySettings.phone}</p> : null}
                {companySettings?.email ? <p className={styles.docMuted}>{companySettings.email}</p> : null}
                {companyAddress(companySettings) ? (
                  <p className={styles.docMuted}>{companyAddress(companySettings)}</p>
                ) : null}
              </div>
            </div>
            <div className={styles.docDate}>
              <label className={styles.docLabel}>Date</label>
              <input
                type="date"
                className={styles.input}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
              <label className={styles.docLabel}>Due date</label>
              <input
                type="date"
                className={styles.input}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.docCols}>
            <div className={styles.docStack}>
              <h2 className={styles.docSection}>Invoice to</h2>
              <p className={styles.docMuted}>
                Pick a gym client, CRM customer, or contact. Fields fill when details exist — you can still type or change anything.
              </p>
              <div className={styles.field}>
                <label className={styles.docLabel}>Customer</label>
                <InvoiceCustomerPicker
                  items={parties}
                  displayValue={customerName}
                  onPick={onPickParty}
                  onSearchChange={onPartySearch}
                  onClear={() => setCustomerId("")}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Name</label>
                <input className={styles.input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Email</label>
                <input type="email" className={styles.input} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Phone</label>
                <input className={styles.input} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Address</label>
                <input className={styles.input} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Company</label>
                <input className={styles.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
            </div>
            <div className={styles.docStack}>
              <h2 className={styles.docSection}>Payment</h2>
              <div className={styles.field}>
                <label className={styles.docLabel}>Bank name</label>
                <input className={styles.input} value={pack?.bank_name || ""} readOnly />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>Account no</label>
                <input className={styles.input} value={pack?.account_no || ""} readOnly />
              </div>
              <div className={styles.field}>
                <label className={styles.docLabel}>IFSC</label>
                <input className={styles.input} value={pack?.ifsc || ""} readOnly />
              </div>
            </div>
          </div>

          <div className={styles.docGstBar}>
            <div>
              <p className={styles.docSection}>GST type</p>
              <div className={styles.radioRow}>
                <label>
                  <input type="radio" name="gst" checked={gstMode === "none"} onChange={() => setGstMode("none")} />
                  Non GST
                </label>
                <label>
                  <input type="radio" name="gst" checked={gstMode === "igst"} onChange={() => setGstMode("igst")} />
                  IGST
                </label>
                <label>
                  <input type="radio" name="gst" checked={gstMode === "sgst_cgst"} onChange={() => setGstMode("sgst_cgst")} />
                  SGST+CGST
                </label>
              </div>
            </div>
            {taxOn ? (
              <div className={styles.docSwitchRow}>
                <span>Inclusive GST</span>
                <button
                  type="button"
                  className={`${styles.docSwitch} ${useInclusive ? styles.docSwitchOn : ""}`}
                  onClick={toggleInclusive}
                  aria-pressed={useInclusive}
                  aria-label="Inclusive GST"
                >
                  <span className={styles.docSwitchKnob} />
                </button>
              </div>
            ) : null}
            <div className={styles.field}>
              <label className={styles.docLabel}>Currency</label>
              <select className={styles.select} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.docItems}>
            {lines.map((row, idx) => {
              const m = lineCalcs[idx] || lineMath(row, gstMode, useInclusive);
              return (
                <div key={row.uid} className={styles.docItemCard}>
                  <button
                    type="button"
                    className={styles.docTrash}
                    onClick={() => setLines((p) => (p.length <= 1 ? p : p.filter((r) => r.uid !== row.uid)))}
                    aria-label="Remove item"
                  >
                    ×
                  </button>
                  <div className={styles.docItemGrid}>
                    <div className={`${styles.field} ${styles.docItemName}`}>
                      <label className={styles.docLabel}>Item</label>
                      <InvoiceProductPicker
                        items={products}
                        value={row.product_name}
                        onChange={(v) => updateLine(row.uid, { product_name: v })}
                        onPick={(p) => onPickProduct(row.uid, p)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.docLabel}>HSN</label>
                      <input
                        className={styles.input}
                        value={row.hsn}
                        onChange={(e) => updateLine(row.uid, { hsn: e.target.value })}
                      />
                    </div>
                    {useInclusive ? (
                      <div className={styles.field}>
                        <label className={styles.docLabel}>Price including tax</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={styles.input}
                          value={row.price_incl}
                          onChange={(e) => updatePriceIncl(row.uid, e.target.value)}
                        />
                      </div>
                    ) : null}
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Cost</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={styles.input}
                        value={row.cost}
                        onChange={(e) => updateCost(row.uid, e.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Qty</label>
                      <div className={styles.docQty}>
                        <button type="button" onClick={() => bumpQty(row.uid, -1)} aria-label="Decrease qty">
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          className={styles.numIn}
                          value={row.qty}
                          onChange={(e) => updateLine(row.uid, { qty: e.target.value })}
                        />
                        <button type="button" onClick={() => bumpQty(row.uid, 1)} aria-label="Increase qty">
                          +
                        </button>
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Discount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={styles.input}
                        value={row.discount}
                        onChange={(e) => updateLine(row.uid, { discount: e.target.value })}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Discount type</label>
                      <select
                        className={styles.select}
                        value={row.discount_type}
                        onChange={(e) => updateLine(row.uid, { discount_type: e.target.value })}
                      >
                        <option value="percent">%</option>
                        <option value="amount">Amt</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Subtotal</label>
                      <input className={styles.input} value={m.taxable.toFixed(2)} readOnly />
                    </div>
                    {gstMode === "sgst_cgst" ? (
                      <>
                        <div className={styles.field}>
                          <label className={styles.docLabel}>SGST %</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={styles.input}
                            value={row.sgst}
                            onChange={(e) => updateLine(row.uid, { sgst: e.target.value })}
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.docLabel}>CGST %</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={styles.input}
                            value={row.cgst}
                            onChange={(e) => updateLine(row.uid, { cgst: e.target.value })}
                          />
                        </div>
                      </>
                    ) : null}
                    {gstMode === "igst" ? (
                      <div className={styles.field}>
                        <label className={styles.docLabel}>IGST %</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={styles.input}
                          value={row.igst}
                          onChange={(e) => updateLine(row.uid, { igst: e.target.value })}
                        />
                      </div>
                    ) : null}
                    {taxOn ? (
                      <div className={styles.field}>
                        <label className={styles.docLabel}>Tax amount</label>
                        <input className={styles.input} value={m.tax.toFixed(2)} readOnly />
                      </div>
                    ) : null}
                    <div className={styles.field}>
                      <label className={styles.docLabel}>Total</label>
                      <input className={styles.input} value={m.total.toFixed(2)} readOnly />
                    </div>
                    <div className={`${styles.field} ${styles.docItemComment}`}>
                      <label className={styles.docLabel}>Comments</label>
                      <input
                        className={styles.input}
                        value={row.comment}
                        onChange={(e) => updateLine(row.uid, { comment: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" className={styles.docAddItem} onClick={() => setLines((p) => [...p, lineDefaults()])}>
              + Add Item
            </button>
          </div>

          <div className={styles.docCols}>
            <div className={styles.docStack}>
              <div className={styles.field}>
                <label className={styles.docLabel}>Comments</label>
                <textarea
                  className={styles.docArea}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                />
              </div>
              <p className={styles.docSection}>Invoice type</p>
              {isEdit ? (
                <p className={styles.docMuted}>
                  Payments stay on the invoice page. Current status: {existingStatus || "draft"}.
                </p>
              ) : (
                <div className={styles.radioRow}>
                  <label>
                    <input type="radio" name="paid" checked={paidType === "unpaid"} onChange={() => setPaidType("unpaid")} />
                    Unpaid
                  </label>
                  <label>
                    <input type="radio" name="paid" checked={paidType === "paid"} onChange={() => setPaidType("paid")} />
                    Paid
                  </label>
                  <label>
                    <input type="radio" name="paid" checked={paidType === "half"} onChange={() => setPaidType("half")} />
                    Half paid
                  </label>
                </div>
              )}
              <div className={styles.field}>
                <label className={styles.docLabel}>Brochure</label>
                <select
                  className={styles.select}
                  value={brochureId === "pending" ? "" : brochureId}
                  onChange={(e) => setBrochureId(e.target.value)}
                >
                  <option value="">None</option>
                  {brochures.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.docSummary}>
              <p>
                <span>Subtotal</span>
                <strong>
                  {currency} {gross.toFixed(2)}
                </strong>
              </p>
              <p>
                <span>Discount</span>
                <strong>
                  {currency} {discountTotal.toFixed(2)}
                </strong>
              </p>
              <p>
                <span>Tax{gstPercent ? ` (${gstPercent}%)` : ""}</span>
                <strong>
                  {currency} {tax.toFixed(2)}
                </strong>
              </p>
              <p className={styles.docTotal}>
                <span>Total</span>
                <strong>
                  {currency} {total.toFixed(2)}
                </strong>
              </p>
              <p>
                <span>Total due</span>
                <strong>
                  {currency} {totalDue.toFixed(2)}
                </strong>
              </p>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.docLabel}>Terms</label>
            <textarea className={styles.docArea} value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} />
          </div>

          <div className={styles.docSignBlock}>
            <p className={styles.docSection}>Signature</p>
            <AuthImg path={pack?.signature_url} alt="Signature" className={styles.docSign} />
            {!pack?.signature_url ? <p className={styles.docMuted}>No signature in Web settings.</p> : null}
          </div>

          <div className={styles.docToggles}>
            <div className={styles.docSwitchRow}>
              <span>Email automation</span>
              <button
                type="button"
                className={`${styles.docSwitch} ${emailAuto ? styles.docSwitchOn : ""}`}
                onClick={() => setEmailAuto((v) => !v)}
                aria-pressed={emailAuto}
                aria-label="Email automation"
              >
                <span className={styles.docSwitchKnob} />
              </button>
            </div>
          </div>

          <div className={styles.docActions}>
            <button type="button" className={styles.btnPrimary} disabled={saving || editBlocked} onClick={() => saveInvoice(false)}>
              {saving ? "Saving…" : isEdit ? "Save" : "Generate"}
            </button>
            <button type="button" className={styles.btnGhost} disabled={saving || editBlocked} onClick={() => saveInvoice(true)}>
              Download
            </button>
          </div>
        </div>
    </div>
  );
}

export default function InvoiceSalesDocumentForm() {
  return (
    <Suspense fallback={<div className={styles.docPage}><p className={styles.sub}>Loading…</p></div>}>
      <InnerForm />
    </Suspense>
  );
}
