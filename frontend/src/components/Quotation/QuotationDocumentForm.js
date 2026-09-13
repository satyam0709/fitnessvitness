"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { openHtmlFromApi, openJsonUrlFromApi } from "@/lib/openPrintableHtml";
import { useToast } from "@/components/Toast/ToastContext";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { getAllClients, getClient, searchClients } from "@/lib/fitnessApi";
import {
  createDebounced,
  fetchAllCustomers,
  fetchCustomerById,
  fetchLookupContacts,
  fieldsFromCustomer,
  invoicePartyFromFitnessClient,
  mergeInvoiceParties,
} from "@/components/Invoice/invoiceCustomer";
import InvoiceCustomerPicker from "@/components/Invoice/InvoiceCustomerPicker";
import styles from "@/app/(dashboard)/invoice/invoicePages.module.css";

const STAGES = ["Draft", "Submitted", "On Hold", "Approved", "Cancelled"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

const emptyLine = () => ({
  uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  product_name: "",
  cost: "",
  qty: "1",
  discount: "0",
  discount_type: "percent",
});

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function lineTotal(row) {
  const cost = Number(row.cost) || 0;
  const qty = Number(row.qty) || 0;
  const base = cost * qty;
  const disc = Number(row.discount) || 0;
  if (row.discount_type === "percent") return Math.max(0, base - (base * disc) / 100);
  return Math.max(0, base - disc);
}

function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export default function QuotationDocumentForm({ quotationId = null }) {
  const { isLoaded } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(Boolean(quotationId));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [quotationDate, setQuotationDate] = useState(ymd());
  const [validUntilDays, setValidUntilDays] = useState(30);
  const [stage, setStage] = useState("Draft");
  const [currency, setCurrency] = useState("INR");
  const [gstMode, setGstMode] = useState("none");
  const [comment, setComment] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [customStages, setCustomStages] = useState([]);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [shareBusy, setShareBusy] = useState("");
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [fitnessClients, setFitnessClients] = useState([]);
  const [liveFitness, setLiveFitness] = useState([]);
  const pickSeq = useRef(0);

  const totals = useMemo(() => {
    const line_total = money(lines.reduce((s, l) => s + lineTotal(l), 0));
    const qty = money(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0));
    return { line_total, qty };
  }, [lines]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const optRes = await apiFetch("/v2/quotations/custom-options");
      const opt = await optRes.json().catch(() => ({}));
      if (optRes.ok && opt.data?.quotation_stage) setCustomStages(opt.data.quotation_stage);
    } catch {
      /* ignore */
    }
    if (!quotationId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch(`/v2/quotations/${quotationId}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.quotation) throw new Error(d.message || "Quotation not found");
      const q = d.quotation;
      const group = Array.isArray(q.line_items_groups) ? q.line_items_groups[0] : {};
      const items = Array.isArray(group?.items) ? group.items : [];
      setName(q.name || "");
      setCompanyName(q.company_name || group?.company_name || "");
      setEmail(q.customer_email || group?.customer_email || "");
      setEmailTo(q.customer_email || group?.customer_email || "");
      setPhone(q.customer_phone || group?.customer_phone || "");
      setAddress(q.billing_address || group?.customer_address || "");
      if (q.quotation_date) setQuotationDate(String(q.quotation_date).slice(0, 10));
      setValidUntilDays(q.valid_until_days || 30);
      setStage(q.stage || "Draft");
      setCurrency(q.currency || "INR");
      setGstMode(group?.gst_mode || "none");
      setComment(q.comment || "");
      setTerms(q.terms_description || "");
      setLines(
        items.length
          ? items.map((i) => ({
              uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              product_name: i.product_name || "",
              cost: String(i.cost ?? ""),
              qty: String(i.qty ?? "1"),
              discount: String(i.discount ?? "0"),
              discount_type: i.discount_type || "percent",
            }))
          : [emptyLine()]
      );
    } catch (e) {
      setErr(e.message || "Failed to load quotation");
    } finally {
      setLoading(false);
    }
  }, [isLoaded, quotationId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadParties = useCallback(async () => {
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

  useEffect(() => {
    loadParties();
  }, [loadParties]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["contacts:changed", "fitness:changed"], () => loadParties());
  }, [isLoaded, loadParties]);

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

  function applyPartyFields(party) {
    setName(party?.name || "");
    setEmail(party?.email || "");
    setPhone(party?.phone || "");
    setCompanyName(party?.company || "");
    setAddress(party?.address || "");
  }

  async function onPickParty(item) {
    if (!item) return;
    applyPartyFields(item);
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
    if (!item.customerId) return;
    const fresh = await fetchCustomerById(apiFetch, item.customerId);
    if (seq !== pickSeq.current || !fresh) return;
    applyPartyFields(fieldsFromCustomer(fresh));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!name.trim()) {
      setErr("Customer name is required.");
      return;
    }
    const payloadLines = lines
      .filter((l) => l.product_name.trim())
      .map((l) => ({
        product_name: l.product_name.trim(),
        cost: Number(l.cost) || 0,
        qty: Number(l.qty) || 0,
        discount: Number(l.discount) || 0,
        discount_type: l.discount_type,
        subtotal: lineTotal(l),
        total: lineTotal(l),
      }));
    if (!payloadLines.length) {
      setErr("Add at least one line item.");
      return;
    }
    setSaving(true);
    try {
      const url = quotationId ? `/v2/quotations/${quotationId}` : "/v2/quotations";
      const res = await apiFetch(url, {
        method: quotationId ? "PUT" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          quotation_date: quotationDate,
          valid_until_days: Number(validUntilDays) || 30,
          stage,
          comment: comment.trim() || null,
          billing_address: address.trim() || null,
          currency,
          total_quantity: totals.qty,
          sub_total: totals.line_total,
          line_total: totals.line_total,
          grand_total: totals.line_total,
          show_grand_total: 1,
          terms_description: terms.trim() || null,
          line_items_groups: [
            {
              group_name: "Items",
              gst_mode: gstMode,
              customer_email: email.trim() || undefined,
              customer_phone: phone.trim() || undefined,
              company_name: companyName.trim() || undefined,
              customer_address: address.trim() || undefined,
              items: payloadLines,
            },
          ],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        setErr(json.message || "Could not save quotation");
        return;
      }
      showToast(quotationId ? "Quotation updated" : "Quotation created");
      router.push("/invoice/quotation");
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function viewPdf() {
    if (!quotationId) return;
    try {
      await openHtmlFromApi(`/v2/quotations/${quotationId}/pdf`);
    } catch (e) {
      setErr(e.message || "PDF failed");
    }
  }

  async function shareWhatsapp() {
    if (!quotationId) return;
    setShareBusy("wa");
    try {
      await openJsonUrlFromApi(`/v2/quotations/${quotationId}/whatsapp`);
    } catch (e) {
      setErr(e.message || "WhatsApp failed");
    } finally {
      setShareBusy("");
    }
  }

  async function sendEmail(e) {
    e.preventDefault();
    if (!quotationId) return;
    setShareBusy("email");
    try {
      const res = await apiFetch(`/v2/quotations/${quotationId}/email`, {
        method: "POST",
        body: JSON.stringify({ to: emailTo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Email failed");
      setEmailOpen(false);
      showToast("Quotation emailed");
    } catch (ex) {
      setErr(ex.message || "Email failed");
    } finally {
      setShareBusy("");
    }
  }

  async function copyQuotation() {
    if (!quotationId) return;
    setShareBusy("copy");
    try {
      const res = await apiFetch(`/v2/quotations/${quotationId}/duplicate`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Duplicate failed");
      showToast(`Duplicated as ${d.quotation_no || d.id}`);
      if (d.id) router.push(`/invoice/quotation/${d.id}`);
    } catch (e) {
      setErr(e.message || "Duplicate failed");
    } finally {
      setShareBusy("");
    }
  }

  if (loading) {
    return (
      <div className={styles.docPage}>
        <p className={styles.sub}>Loading quotation…</p>
      </div>
    );
  }

  return (
    <div className={styles.docPage}>
      <div className={styles.docToolbar}>
        <Link href="/invoice/quotation" className={styles.docBack}>
          ← Quotations
        </Link>
        {quotationId ? (
          <div className={styles.rowActions}>
            <Link href={`/invoice/sales/new?quotation_id=${quotationId}`} className={styles.btnGhost}>
              Convert to invoice
            </Link>
            <button type="button" className={styles.btnGhost} onClick={viewPdf}>
              PDF
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => { setEmailTo(email); setEmailOpen(true); }}>
              Email
            </button>
            <button type="button" className={styles.btnGhost} disabled={shareBusy === "wa"} onClick={shareWhatsapp}>
              WhatsApp
            </button>
            <button type="button" className={styles.btnGhost} disabled={shareBusy === "copy"} onClick={copyQuotation}>
              Duplicate
            </button>
          </div>
        ) : null}
      </div>
      <form className={styles.docCard} onSubmit={onSubmit}>
        <h1 className={styles.title}>{quotationId ? "Edit quotation" : "New quotation"}</h1>
        {err ? <p className={styles.err}>{err}</p> : null}
        <p className={styles.sub}>
          Pick a gym client, CRM customer, or contact. Details fill when they exist — you can still type or edit any field.
        </p>
        <div className={styles.field}>
          <label className={styles.label}>Select client</label>
          <InvoiceCustomerPicker
            items={parties}
            displayValue={name}
            onPick={onPickParty}
            onSearchChange={onPartySearch}
            onClear={() => {}}
          />
        </div>
        <div className={styles.docGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Customer name *</label>
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Company</label>
            <input className={styles.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Phone</label>
            <input className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Date</label>
            <input className={styles.input} type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Valid until (days)</label>
            <input
              className={styles.input}
              type="number"
              min="1"
              value={validUntilDays}
              onChange={(e) => setValidUntilDays(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Stage</label>
            <select className={styles.select} value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {customStages
                .filter((s) => s?.value && !STAGES.some((x) => x.toLowerCase() === String(s.value).toLowerCase()))
                .map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label || s.value}
                  </option>
                ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Currency</label>
            <select className={styles.select} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.field} style={{ marginTop: 12 }}>
          <label className={styles.label}>Address</label>
          <textarea className={styles.textarea} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className={styles.radioRow} style={{ marginTop: 12 }}>
          <label>
            <input type="radio" checked={gstMode === "none"} onChange={() => setGstMode("none")} /> Non GST
          </label>
          <label>
            <input type="radio" checked={gstMode === "igst"} onChange={() => setGstMode("igst")} /> IGST
          </label>
          <label>
            <input type="radio" checked={gstMode === "sgst_cgst"} onChange={() => setGstMode("sgst_cgst")} /> SGST/CGST
          </label>
        </div>
        <h2 className={styles.cardTitle} style={{ marginTop: 20 }}>
          Line items
        </h2>
        {lines.map((row, idx) => (
          <div key={row.uid} className={styles.docItemCard}>
            <div className={styles.docGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Item</label>
                <input
                  className={styles.input}
                  value={row.product_name}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x) => (x.uid === row.uid ? { ...x, product_name: e.target.value } : x)))
                  }
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Cost</label>
                <input
                  className={styles.input}
                  type="number"
                  value={row.cost}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x) => (x.uid === row.uid ? { ...x, cost: e.target.value } : x)))
                  }
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Qty</label>
                <input
                  className={styles.input}
                  type="number"
                  value={row.qty}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x) => (x.uid === row.uid ? { ...x, qty: e.target.value } : x)))
                  }
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Line total</label>
                <input className={styles.input} readOnly value={lineTotal(row).toFixed(2)} />
              </div>
            </div>
            {lines.length > 1 ? (
              <button
                type="button"
                className={styles.btnGhost}
                style={{ marginTop: 8 }}
                onClick={() => setLines((prev) => prev.filter((x) => x.uid !== row.uid))}
              >
                Remove line {idx + 1}
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className={styles.btnGhost} onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Add line
        </button>
        <p className={styles.totals}>Grand total: {totals.line_total.toFixed(2)} {currency}</p>
        <div className={styles.field}>
          <label className={styles.label}>Comment</label>
          <textarea className={styles.textarea} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Terms</label>
          <textarea className={styles.textarea} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
        </div>
        <div className={styles.formActions}>
          <button type="submit" className={styles.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : quotationId ? "Update quotation" : "Create quotation"}
          </button>
        </div>
      </form>
      {emailOpen ? (
        <div className={styles.modalOverlay} role="dialog">
          <div className={styles.payModal}>
            <div className={styles.payModalHead}>
              <h2>Email quotation</h2>
              <button type="button" className={styles.payClose} onClick={() => setEmailOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={sendEmail} className={styles.payModalBody}>
              <label className={styles.label}>To</label>
              <input
                type="email"
                className={styles.input}
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                required
              />
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={shareBusy === "email"}>
                  {shareBusy === "email" ? "Sending…" : "Send"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setEmailOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
