"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { fetchInvoiceReceipt } from "@/lib/invoicesApi";
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

export default function InvoiceSalesDetailPage() {
  const params = useParams();
  const id = params?.id;
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const [inv, setInv] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

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
    } finally {
      setLoading(false);
    }
  }, [isLoaded, id]);

  useEffect(() => {
    load();
  }, [load]);

  const isReceipt =
    inv?.is_payment_receipt ||
    inv?.source_type === "collection_payment" ||
    inv?.source_type === "fitness_transaction";

  const lines = Array.isArray(inv?.line_items) ? inv.line_items : [];
  const cur = inv?.currency || "INR";

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
          <p className={styles.sub}>View sales invoice details, line items, and totals.</p>
        </div>
        <Link href="/invoice/sales" className={styles.btnPrimary}>
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
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Summary</h2>
            <div className={styles.detailGrid}>
              <div>
                <span className={styles.detailLabel}>Invoice no.</span>
                <p className={styles.detailValue}>{inv.invoice_number || "—"}</p>
              </div>
              <div>
                <span className={styles.detailLabel}>Status</span>
                <p className={styles.detailValue}>{inv.status || "—"}</p>
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

          {inv.notes ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Notes</h2>
              <p className={styles.sub} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {inv.notes}
              </p>
            </div>
          ) : null}

          <div className={styles.midBar} style={{ marginTop: 8 }}>
            <Link href="/invoice/sales/new" className={styles.btnPrimary}>
              Create another invoice
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
