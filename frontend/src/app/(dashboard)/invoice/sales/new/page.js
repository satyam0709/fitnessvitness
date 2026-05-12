"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
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
  const leadId = searchParams.get("lead_id");

  const [settingsLoading, setSettingsLoading] = useState(true);
  const [invoiceSettingsComplete, setInvoiceSettingsComplete] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [gstMode, setGstMode] = useState("none");
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const loadSettings = useCallback(async () => {
    if (!isLoaded) return;
    setSettingsLoading(true);
    try {
      const res = await apiFetch("/v2/settings/company");
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCompanySettings(d.data || null);
        setInvoiceSettingsComplete(!!d.invoiceSettingsComplete);
        if (d.data?.invoice_currency) setCurrency(d.data.invoice_currency);
        if (d.data?.invoice_gst_mode) setGstMode(d.data.invoice_gst_mode);
      }
    } finally {
      setSettingsLoading(false);
    }
  }, [isLoaded]);

  const loadCustomers = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/v2/customers?limit=200");
      if (!res.ok) return;
      const d = await res.json();
      setCustomers(d.customers || []);
    } catch {
      setCustomers([]);
    }
  }, [isLoaded]);

  useEffect(() => {
    loadSettings();
    loadCustomers();
  }, [loadSettings, loadCustomers]);

  useEffect(() => {
    if (!leadId || !customers.length) return;
    const leadCustomer = customers.find((c) => String(c.lead_id) === String(leadId));
    if (leadCustomer) {
      setCustomerId(String(leadCustomer.id));
      setCustomerName(leadCustomer.name || "");
      setCustomerEmail(leadCustomer.email || "");
    }
  }, [leadId, customers]);

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

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (!customerName.trim()) {
      setErr("Invoice To (customer name) is required.");
      return;
    }
    if (lines.every((l) => !String(l.product_name).trim())) {
      setErr("Add at least one line item with a product name.");
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
      const res = await apiFetch("/v2/invoices", {
        method: "POST",
        body: JSON.stringify({
          type: "sales",
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim() || null,
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
          status: "draft",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.message || "Could not create invoice");
        return;
      }
      window.location.href = "/invoice/sales";
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  const showModal = !settingsLoading && !invoiceSettingsComplete;

  return (
    <div className={styles.page}>
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalIcon}>
              <i className="fas fa-exclamation" />
            </div>
            <h2 className={styles.modalTitle}>Please fill out the Invoice Setting first before you generate an invoice.</h2>
            <p className={styles.modalText}>Follow the steps below to set up Invoice Settings.</p>
            <ol className={styles.modalSteps}>
              <li>
                Navigate to <strong>General Settings</strong> → <strong>Web settings</strong>, then open the{" "}
                <strong>Invoice settings</strong> tab.
              </li>
              <li>
                Choose <strong>Invoice settings</strong>, fill in all required information (company, bank, account, IFSC),
                and save.
              </li>
            </ol>
            <div className={styles.modalActions}>
              <Link href="/settings/web?tab=invoice" className={styles.btnModalPrimary}>
                Redirect Invoice Setting
              </Link>
              <button
                type="button"
                className={styles.btnModalNo}
                onClick={() => router.push("/invoice/sales")}
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={showModal ? styles.pageBehindBlocker : undefined}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Add invoice</h1>
          <p className={styles.sub}>Sales invoice with line items, GST mode, and payment details from workspace settings.</p>
        </div>
        <Link href="/invoice/sales" className={styles.btnGhost}>
          Invoice list
        </Link>
      </div>

      <form className={styles.formGrid} onSubmit={onSubmit}>
        {err ? <p className={styles.err}>{err}</p> : null}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Company &amp; payment (from settings)</h2>
          <p className={styles.sub} style={{ marginBottom: 12 }}>
            {companySettings?.company_name || "—"} · Bank: {companySettings?.invoice_bank_name || "—"} · A/C:{" "}
            {companySettings?.invoice_account_no || "—"} · IFSC: {companySettings?.invoice_ifsc || "—"}
          </p>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Date</label>
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
              <input type="date" className={styles.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Invoice to</h2>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Customer (saved)</label>
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
                  }
                }}
              >
                <option value="">— Select customer —</option>
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
          <div className={styles.field} style={{ marginTop: 12 }}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              className={styles.input}
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>GST type</h2>
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
              SGST / CGST
            </label>
          </div>
          <p className={styles.sub} style={{ marginTop: 8 }}>
            Tax is calculated at 18% on the subtotal when GST applies (simplified).
          </p>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Line items</h2>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.lineTable}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Cost</th>
                  <th>Qty</th>
                  <th>Discount</th>
                  <th>Type</th>
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
                        placeholder="Product name"
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
                        style={{ minWidth: 90 }}
                        value={row.discount_type}
                        onChange={(e) => updateLine(row.uid, { discount_type: e.target.value })}
                      >
                        <option value="percent">%</option>
                        <option value="amount">Amt</option>
                      </select>
                    </td>
                    <td>{lineSubtotal(row).toFixed(2)}</td>
                    <td>
                      <button type="button" className={styles.danger} onClick={() => removeLine(row.uid)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={styles.btnPrimary} style={{ marginTop: 12 }} onClick={addLine}>
            + Add line
          </button>
          <div className={styles.totals}>
            Currency:{" "}
            <select className={styles.select} style={{ display: "inline-block", minWidth: 80 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <br />
            <br />
            Subtotal: {subtotal.toFixed(2)} {currency}
            <br />
            Tax: {tax.toFixed(2)} {currency}
            <br />
            Total: {total.toFixed(2)} {currency}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Notes</h2>
          <textarea
            className={styles.input}
            style={{ minHeight: 100, width: "100%" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Terms, reference, line item notes…"
          />
        </div>

        <button type="submit" className={styles.btnSubmit} disabled={saving}>
          {saving ? "Saving…" : "Create invoice"}
        </button>
      </form>
      </div>
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
