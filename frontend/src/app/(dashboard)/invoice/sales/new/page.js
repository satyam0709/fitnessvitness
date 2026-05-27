"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { searchClients } from "@/lib/fitnessApi";
import { createInvoice, fetchCompanySettings, fetchCustomers } from "@/lib/invoicesApi";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "../../invoicePages.module.css";

const emptyLine = () => ({
  uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  product_name: "",
  cost: "",
  qty: "1",
  discount: "0",
  discount_type: "percent",
});

function lineSubtotal(row) {
  const cost = Number(row.cost) || 0;
  const qty = Number(row.qty) || 0;
  const base = cost * qty;
  const disc = Number(row.discount) || 0;
  if (row.discount_type === "percent") {
    return Math.max(0, base - (base * disc) / 100);
  }
  return Math.max(0, base - disc);
}

function NewSalesInvoiceForm() {
  const { isLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const leadId = searchParams.get("lead_id");

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [invoiceSettingsComplete, setInvoiceSettingsComplete] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const searchTimer = useRef(null);

  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [gstMode, setGstMode] = useState("none");
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const loadAll = useCallback(async () => {
    if (!isLoaded) return;
    setSettingsLoading(true);
    try {
      const [settings, cust] = await Promise.all([
        fetchCompanySettings(),
        fetchCustomers(200).catch(() => []),
      ]);
      setCompanySettings(settings.company);
      setInvoiceSettingsComplete(settings.invoiceSettingsComplete);
      setCustomers(cust);
      if (settings.company?.invoice_currency) setCurrency(settings.company.invoice_currency);
      if (settings.company?.invoice_gst_mode) setGstMode(settings.company.invoice_gst_mode);
    } catch (e) {
      showToast(e.message || "Could not load settings", "error");
    } finally {
      setSettingsLoading(false);
    }
  }, [isLoaded, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!leadId || !customers.length) return;
    const leadCustomer = customers.find((c) => String(c.lead_id) === String(leadId));
    if (leadCustomer) {
      setCustomerId(String(leadCustomer.id));
      setCustomerName(leadCustomer.name || "");
      setCustomerEmail(leadCustomer.email || "");
      setCustomerPhone(leadCustomer.phone || "");
    }
  }, [leadId, customers]);

  useEffect(() => {
    if (!clientSearch.trim()) {
      setClientResults([]);
      return undefined;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const list = await searchClients(clientSearch.trim());
        setClientResults(Array.isArray(list) ? list.slice(0, 8) : []);
      } catch {
        setClientResults([]);
      }
    }, 280);
    return () => clearTimeout(searchTimer.current);
  }, [clientSearch]);

  const subtotal = useMemo(
    () => lines.reduce((s, row) => s + lineSubtotal(row), 0),
    [lines]
  );
  const tax = useMemo(() => {
    if (gstMode === "none") return 0;
    return Math.round(subtotal * 0.18 * 100) / 100;
  }, [subtotal, gstMode]);
  const total = useMemo(() => Math.round((subtotal + tax) * 100) / 100, [subtotal, tax]);

  function updateLine(uid, patch) {
    setLines((prev) => prev.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(uid) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.uid !== uid)));
  }

  function pickFitnessClient(c) {
    setCustomerId("");
    setCustomerName(c.full_name || c.client_id || "");
    setCustomerEmail(c.email || "");
    setCustomerPhone(c.phone || "");
    setClientSearch(`${c.full_name} (${c.client_id})`);
    setClientResults([]);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (!customerName.trim()) {
      setErr("Customer name is required.");
      return;
    }
    if (lines.every((l) => !String(l.product_name).trim())) {
      setErr("Add at least one line item.");
      return;
    }

    const payloadLines = lines
      .filter((l) => String(l.product_name).trim())
      .map((l) => ({
        product_name: l.product_name.trim(),
        cost: Number(l.cost) || 0,
        qty: Number(l.qty) || 0,
        discount: Number(l.discount) || 0,
        discount_type: l.discount_type,
        subtotal: lineSubtotal(l),
      }));

    setSaving(true);
    try {
      const json = await createInvoice({
        type: "sales",
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || null,
        customer_phone: customerPhone.trim() || null,
        customer_id: customerId ? Number(customerId) : null,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        subtotal,
        tax,
        total,
        gst_mode: gstMode,
        currency,
        line_items_json: payloadLines,
        notes: notes.trim() || null,
        status: "sent",
      });
      showToast("Invoice created", "success");
      const newId = json.id;
      if (newId) router.push(`/invoice/sales/${newId}`);
      else router.push("/invoice/sales");
    } catch (e) {
      setErr(e.message || "Could not create invoice");
    } finally {
      setSaving(false);
    }
  }

  if (settingsLoading) {
    return (
      <div className={styles.page}>
        <p className={styles.sub}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>New sales invoice</h1>
          <p className={styles.sub}>Create a manual invoice — payment receipts from Collections are generated automatically.</p>
        </div>
        <Link href="/invoice/sales" className={styles.btnGhost}>
          Back to list
        </Link>
      </div>

      {!invoiceSettingsComplete ? (
        <div className={styles.settingsBanner}>
          <div className={styles.settingsBannerBody}>
            <i className="fas fa-circle-info" aria-hidden="true" />
            <div>
              <strong>Company details recommended</strong>
              <p>
                Add your company name and bank details so printed invoices and WhatsApp receipts show
                your branding. You can still save this invoice now.
              </p>
            </div>
          </div>
          <Link href="/settings/invoice" className={styles.settingsBannerBtn}>
            Invoice settings
          </Link>
        </div>
      ) : null}

      <form className={styles.formGrid} onSubmit={onSubmit}>
        {err ? <p className={styles.err}>{err}</p> : null}

        <div className={styles.card}>
          <div className={styles.companyStrip}>
            <div>
              <span className={styles.detailLabel}>From</span>
              <p className={styles.companyName}>{companySettings?.company_name || "Your company"}</p>
              {companySettings?.gst_number ? (
                <p className={styles.companyMeta}>GSTIN {companySettings.gst_number}</p>
              ) : null}
            </div>
            {companySettings?.invoice_bank_name ? (
              <div className={styles.bankMini}>
                <span className={styles.detailLabel}>Bank</span>
                <p className={styles.companyMeta}>
                  {companySettings.invoice_bank_name} · {companySettings.invoice_account_no} ·{" "}
                  {companySettings.invoice_ifsc}
                </p>
              </div>
            ) : null}
          </div>
          <div className={styles.row2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>Invoice date</label>
              <input
                type="date"
                className={styles.input}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Due date</label>
              <input
                type="date"
                className={styles.input}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Bill to</h2>
          <div className={styles.field}>
            <label className={styles.label}>Search fitness client</label>
            <input
              className={styles.input}
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Name or client ID…"
              autoComplete="off"
            />
            {clientResults.length > 0 ? (
              <ul className={styles.clientDropdown}>
                {clientResults.map((c) => (
                  <li key={c.client_id}>
                    <button type="button" onClick={() => pickFitnessClient(c)}>
                      {c.full_name} <span className={styles.clientIdTag}>{c.client_id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className={styles.row2} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>CRM customer (optional)</label>
              <select
                className={styles.select}
                value={customerId}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomerId(v);
                  const c = customers.find((x) => String(x.id) === v);
                  if (c) {
                    setCustomerName(c.name || "");
                    setCustomerEmail(c.email || "");
                    setCustomerPhone(c.phone || "");
                  }
                }}
              >
                <option value="">— None —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` (${c.company})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>
                Name on invoice <span className={styles.req}>*</span>
              </label>
              <input
                className={styles.input}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className={styles.row2} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input
                type="email"
                className={styles.input}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Phone (for WhatsApp receipt)</label>
              <input
                className={styles.input}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+91…"
              />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle} style={{ margin: 0 }}>
              Line items
            </h2>
            <div className={styles.gstInline}>
              <label className={styles.label}>GST</label>
              <select
                className={styles.select}
                value={gstMode}
                onChange={(e) => setGstMode(e.target.value)}
              >
                <option value="none">Non GST</option>
                <option value="igst">IGST (18%)</option>
                <option value="sgst_cgst">SGST + CGST (18%)</option>
              </select>
            </div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.lineTable}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Rate</th>
                  <th>Qty</th>
                  <th>Disc.</th>
                  <th />
                  <th>Sub</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((row) => (
                  <tr key={row.uid}>
                    <td>
                      <input
                        value={row.product_name}
                        onChange={(e) => updateLine(row.uid, { product_name: e.target.value })}
                        placeholder="Description"
                      />
                    </td>
                    <td>
                      <input
                        className={styles.numIn}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cost}
                        onChange={(e) => updateLine(row.uid, { cost: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.numIn}
                        type="number"
                        min="0"
                        step="1"
                        value={row.qty}
                        onChange={(e) => updateLine(row.uid, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.numIn}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.discount}
                        onChange={(e) => updateLine(row.uid, { discount: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minWidth: 72 }}
                        value={row.discount_type}
                        onChange={(e) => updateLine(row.uid, { discount_type: e.target.value })}
                      >
                        <option value="percent">%</option>
                        <option value="amount">₹</option>
                      </select>
                    </td>
                    <td className={styles.subCell}>{lineSubtotal(row).toFixed(2)}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.iconBtnSmall}
                        onClick={() => removeLine(row.uid)}
                        aria-label="Remove line"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={styles.btnGhost} style={{ marginTop: 10 }} onClick={addLine}>
            + Add line
          </button>
          <div className={styles.totals}>
            Subtotal: {subtotal.toFixed(2)} {currency}
            <br />
            Tax: {tax.toFixed(2)} {currency}
            <br />
            <strong>
              Total: {total.toFixed(2)} {currency}
            </strong>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Notes</h2>
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Payment terms, reference…"
            rows={3}
          />
        </div>

        <div className={styles.formActions}>
          <button type="submit" className={styles.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : "Create invoice"}
          </button>
          <Link href="/collections" className={styles.btnGhost}>
            Record payment in Collections
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewSalesInvoicePage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <p className={styles.sub}>Loading…</p>
        </div>
      }
    >
      <NewSalesInvoiceForm />
    </Suspense>
  );
}
