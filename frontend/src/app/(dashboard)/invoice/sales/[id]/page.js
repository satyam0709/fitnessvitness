"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import {
  fetchInvoiceReceipt,
  createInvoicePayment,
  markInvoicePaid,
  duplicateInvoice,
  emailInvoice,
  createPaymentReminder,
} from "@/lib/invoicesApi";
import { openHtmlFromApi, openJsonUrlFromApi } from "@/lib/openPrintableHtml";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import PaymentReceiptView from "@/components/Invoice/PaymentReceiptView";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "../../invoicePages.module.css";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
}

function gstLabel(mode) {
  if (!mode || mode === "none") return "Non GST";
  if (mode === "igst") return "IGST";
  if (mode === "sgst_cgst") return "CGST + SGST";
  return String(mode);
}

async function openInvoicePdf(id) {
  await openHtmlFromApi(`/v2/invoices/${id}/pdf`);
}

export default function InvoiceSalesDetailPage() {
  const params = useParams();
  const id = params?.id;
  const router = useRouter();
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const [inv, setInv] = useState(null);
  const [company, setCompany] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payMethods, setPayMethods] = useState(["Cash", "UPI", "Bank", "Card"]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [remindAt, setRemindAt] = useState("");

  const load = useCallback(async () => {
    if (!isLoaded || !id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/v2/invoices/${encodeURIComponent(id)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Could not load invoice");
      const invoice = d.invoice || null;
      setInv(invoice);
      setPayments(Array.isArray(invoice?.payments) ? invoice.payments : []);
      setEmailTo(invoice?.customer_email || "");
      if (invoice?.due_date) {
        const due = new Date(invoice.due_date);
        if (!Number.isNaN(due.getTime())) setRemindAt(due.toISOString().slice(0, 16));
      }

      if (
        invoice?.is_payment_receipt ||
        invoice?.source_type === "collection_payment" ||
        invoice?.source_type === "fitness_transaction"
      ) {
        try {
          const receipt = await fetchInvoiceReceipt(id);
          setCompany(receipt.company);
        } catch {
          setCompany(null);
        }
      } else {
        setCompany(null);
      }
    } catch (e) {
      setErr(e.message || "Error");
      setInv(null);
      setCompany(null);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["invoices:changed"], () => load());
  }, [isLoaded, load]);

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const res = await apiFetch("/v2/payment-methods");
        const d = await res.json().catch(() => ({}));
        const names = (d.methods || []).map((m) => m.method).filter(Boolean);
        if (names.length) setPayMethods(names);
      } catch {
        /* keep defaults */
      }
    })();
  }, [isLoaded]);

  const isReceipt =
    inv?.is_payment_receipt ||
    inv?.source_type === "collection_payment" ||
    inv?.source_type === "fitness_transaction";

  const lines = Array.isArray(inv?.line_items) ? inv.line_items : [];
  const cur = inv?.currency || "INR";
  const due = Number(inv?.due_amount || 0);

  async function runAction(key, fn) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showToast(e.message || "Action failed", "error");
    } finally {
      setBusy("");
    }
  }

  function openPay() {
    setPayAmount(String(due || ""));
    setPayMethod(payMethods[0] || "Cash");
    setPayOpen(true);
  }

  async function submitPay(e) {
    e.preventDefault();
    await runAction("pay", async () => {
      await createInvoicePayment(id, {
        amount: Number(payAmount),
        method: payMethod,
        payment_date: new Date().toISOString().slice(0, 10),
      });
      setPayOpen(false);
      showToast("Payment recorded", "success");
      await load();
    });
  }

  async function settlePaid() {
    await runAction("paid", async () => {
      await markInvoicePaid(id, { method: payMethods[0] || "Other" });
      showToast("Marked as paid", "success");
      await load();
    });
  }

  async function copyInvoice() {
    await runAction("copy", async () => {
      const d = await duplicateInvoice(id);
      if (d.id) router.push(`/invoice/sales/${d.id}`);
    });
  }

  async function sendEmail(e) {
    e.preventDefault();
    await runAction("email", async () => {
      await emailInvoice(id, emailTo);
      setEmailOpen(false);
      showToast("Invoice emailed", "success");
    });
  }

  async function openWhatsapp() {
    await runAction("wa", async () => {
      await openJsonUrlFromApi(`/v2/invoices/${id}/whatsapp`);
    });
  }

  async function setReminder(e) {
    e.preventDefault();
    await runAction("remind", async () => {
      await createPaymentReminder(id, {
        remind_at: remindAt ? new Date(remindAt).toISOString() : undefined,
      });
      showToast("Payment reminder set", "success");
    });
  }

  if (!loading && !err && inv && isReceipt) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Payment receipt</h1>
            <p className={styles.sub}>
              {inv.invoice_number} — {inv.customer_name || "Customer"}
            </p>
          </div>
          <div className={styles.rowActions}>
            <Link href="/invoice/sales" className={styles.btnGhost}>
              Invoice list
            </Link>
            <Link href={`/invoice/receipt/${inv.id}`} className={styles.btnPrimary}>
              Full receipt view
            </Link>
          </div>
        </div>
        <PaymentReceiptView
          invoice={inv}
          company={company}
          onWhatsAppError={(msg) => showToast(msg, "error")}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Invoice</h1>
          <p className={styles.sub}>View sales invoice details, line items, and payments.</p>
        </div>
        <Link href="/invoice/sales" className={styles.btnGhost}>
          Invoice list
        </Link>
      </div>

      {loading ? (
        <p className={styles.sub}>Loading…</p>
      ) : err ? (
        <p className={styles.err}>{err}</p>
      ) : !inv ? (
        <p className={styles.sub}>Invoice not found.</p>
      ) : (
        <div className={styles.formGrid}>
          <div className={styles.rowActions}>
            <Link href={`/invoice/sales/new?id=${id}`} className={styles.btnPrimary}>
              Edit
            </Link>
            <button type="button" className={styles.btnGhost} disabled={busy === "pdf"} onClick={() => runAction("pdf", () => openInvoicePdf(id))}>
              PDF
            </button>
            <button type="button" className={styles.btnGhost} disabled={due <= 0 || !!busy} onClick={openPay}>
              Record payment
            </button>
            <button type="button" className={styles.btnGhost} disabled={due <= 0 || !!busy} onClick={settlePaid}>
              Mark paid
            </button>
            <button type="button" className={styles.btnGhost} disabled={!!busy} onClick={() => setEmailOpen(true)}>
              Email
            </button>
            <button type="button" className={styles.btnGhost} disabled={!!busy} onClick={openWhatsapp}>
              WhatsApp
            </button>
            <button type="button" className={styles.btnGhost} disabled={!!busy} onClick={copyInvoice}>
              Duplicate
            </button>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Summary</h2>
            <div className={styles.detailGrid}>
              <div>
                <span className={styles.detailLabel}>Invoice no.</span>
                <p className={styles.detailValue}>{inv.invoice_number || "—"}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>Status</span>
                <p className={styles.detailValue}>{inv.payment_status || inv.status || "—"}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>Date</span>
                <p className={styles.detailValue}>{fmtDate(inv.invoice_date)}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>Due date</span>
                <p className={styles.detailValue}>{fmtDate(inv.due_date)}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>GST</span>
                <p className={styles.detailValue}>{gstLabel(inv.gst_mode)}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>Staff</span>
                <p className={styles.detailValue}>
                  {inv.creator_name?.trim() || inv.creator_email || "—"}
                </p>
              </div>
              <div>
                <span className={styles.detailLabel}>Paid</span>
                <p className={styles.detailValue}>
                  ₹{Number(inv.amount_paid || 0).toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <span className={styles.detailLabel}>Due</span>
                <p className={styles.detailValue}>₹{due.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Bill to</h2>
            <p className={styles.detailValue} style={{ margin: 0 }}>
              {inv.customer_name || "—"}
            </p>
            {inv.customer_email ? (
              <p className={styles.sub} style={{ marginTop: 8 }}>
                {inv.customer_email}
              </p>
            ) : null}
            {inv.customer_phone ? (
              <p className={styles.sub} style={{ marginTop: 4 }}>
                {inv.customer_phone}
              </p>
            ) : null}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Line items</h2>
            {lines.length === 0 ? (
              <p className={styles.sub}>No line items stored for this invoice.</p>
            ) : (
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
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.product_name || "—"}</td>
                        <td>{Number(row.cost || 0).toFixed(2)}</td>
                        <td>{row.qty ?? "—"}</td>
                        <td>{row.discount ?? "—"}</td>
                        <td>{row.discount_type === "amount" ? "Amt" : "%"}</td>
                        <td>{Number(row.subtotal || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={styles.totals}>
              Subtotal: {Number(inv.subtotal || 0).toFixed(2)} {cur}
              <br />
              Tax: {Number(inv.tax || 0).toFixed(2)} {cur}
              <br />
              Total: {Number(inv.total || 0).toFixed(2)} {cur}
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Payments</h2>
            {payments.length === 0 ? (
              <p className={styles.sub}>No payments recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className={styles.lineTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.payment_date)}</td>
                        <td>{p.method || "—"}</td>
                        <td>₹{Number(p.amount || 0).toLocaleString("en-IN")}</td>
                        <td>{p.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {inv.notes ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Notes</h2>
              <p className={styles.sub} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {inv.notes}
              </p>
            </div>
          ) : null}

          <form className={styles.card} onSubmit={setReminder}>
            <h2 className={styles.cardTitle}>Payment reminder</h2>
            <p className={styles.sub}>Creates a reminder on /reminders for the due amount.</p>
            <div className={styles.row2} style={{ marginTop: 12 }}>
              <div className={styles.field}>
                <label className={styles.label}>Remind at</label>
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" className={styles.btnPrimary} style={{ marginTop: 12 }} disabled={busy === "remind"}>
              {busy === "remind" ? "Saving…" : "Set reminder"}
            </button>
          </form>

          <div className={styles.midBar} style={{ marginTop: 8 }}>
            <Link href="/invoice/sales/new" className={styles.btnPrimary}>
              Create another invoice
            </Link>
          </div>
        </div>
      )}

      {payOpen ? (
        <div className={styles.modalOverlay} role="dialog" onClick={() => setPayOpen(false)}>
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Record payment</h2>
              <button type="button" className={styles.payClose} onClick={() => setPayOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={submitPay} className={styles.payModalBody}>
              <label className={styles.label}>Amount</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={styles.input}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
              <label className={styles.label}>Method</label>
              <select className={styles.select} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {payMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={busy === "pay"}>
                  {busy === "pay" ? "Saving…" : "Save"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setPayOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {emailOpen ? (
        <div className={styles.modalOverlay} role="dialog" onClick={() => setEmailOpen(false)}>
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Email invoice</h2>
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
                <button type="submit" className={styles.btnPrimary} disabled={busy === "email"}>
                  {busy === "email" ? "Sending…" : "Send"}
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
