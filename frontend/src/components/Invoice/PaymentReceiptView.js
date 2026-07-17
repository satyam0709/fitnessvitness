"use client";

import { useMemo } from "react";
import { openWhatsAppPaymentReceipt } from "@/lib/whatsappShare";
import styles from "./PaymentReceiptView.module.css";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(d);
  }
}

function fmtInr(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PaymentReceiptView({
  invoice,
  company,
  showToolbar = true,
  onWhatsAppError,
}) {
  const lines = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
  const meta = invoice?.payment_meta || {};
  const cur = invoice?.currency || "INR";

  const companyLines = useMemo(() => {
    const c = company || {};
    const parts = [];
    if (c.address) parts.push(c.address);
    const cityLine = [c.city, c.state, c.country].filter(Boolean).join(", ");
    if (cityLine) parts.push(cityLine);
    if (c.phone) parts.push(`Tel: ${c.phone}`);
    if (c.email) parts.push(c.email);
    if (c.gst_number) parts.push(`GSTIN: ${c.gst_number}`);
    if (c.pan_number) parts.push(`PAN: ${c.pan_number}`);
    return parts;
  }, [company]);

  const receiptUrl =
    typeof window !== "undefined" && invoice?.id
      ? `${window.location.origin}/invoice/receipt/${invoice.id}`
      : "";

  function handlePrint() {
    window.print();
  }

  function handleWhatsApp() {
    try {
      openWhatsAppPaymentReceipt({
        phone: invoice?.customer_phone,
        customerName: invoice?.customer_name,
        invoiceNumber: invoice?.invoice_number,
        totalInr: invoice?.total,
        paidAt: fmtDate(invoice?.invoice_date),
        payMode: meta.pay_mode,
        receiptUrl,
        companyName: company?.company_name,
      });
    } catch (e) {
      onWhatsAppError?.(e.message || "Could not open WhatsApp");
    }
  }  return (
    <div className={styles.wrap}>
      {showToolbar ? (
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handlePrint}>
            <i className="fas fa-print" aria-hidden="true" />
            Print Receipt
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnWa}`} onClick={handleWhatsApp}>
            <i className="fab fa-whatsapp" aria-hidden="true" />
            Share on WhatsApp
          </button>
        </div>
      ) : null}

      <article className={styles.paper} id="payment-receipt-print">
        <div className={styles.contentWrapper}>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.logoBox}>
                <img src="/assets/logo.svg" alt="Logo" className={styles.logoImage} />
              </div>
              <div className={styles.companyInfo}>
                <h1 className={styles.brandName}>{company?.company_name || "Company Name"}</h1>
                {companyLines.map((line, i) => (
                  <p key={i} className={styles.brandMeta}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className={styles.headerRight}>
              <span className={styles.receiptBadge}>Payment receipt</span>
              <p className={styles.receiptNo}>{invoice?.invoice_number || "—"}</p>
              <p className={styles.receiptDate}>Date: {fmtDate(invoice?.invoice_date)}</p>
            </div>
          </header>

          <div className={styles.grid2}>
            <div>
              <p className={styles.blockTitle}>Billed To</p>
              <p className={styles.blockBody}>
                <strong>{invoice?.customer_name || "—"}</strong>
              </p>
              {invoice?.customer_phone ? (
                <p className={styles.blockBody}>Phone: {invoice.customer_phone}</p>
              ) : null}
              {invoice?.customer_email ? (
                <p className={styles.blockBody}>{invoice.customer_email}</p>
              ) : null}
            </div>
            <div>
              <p className={styles.blockTitle}>Payment Details</p>
              <p className={styles.blockBody}>
                <strong>Status:</strong> {String(invoice?.status || "Paid").toUpperCase()}
              </p>
              {meta.pay_mode ? (
                <p className={styles.blockBody}>
                  <strong>Method:</strong> {meta.pay_mode}
                </p>
              ) : null}
              {meta.paid_at ? (
                <p className={styles.blockBody}>
                  <strong>Paid On:</strong> {fmtDate(meta.paid_at)}
                </p>
              ) : null}
              {meta.collection_id ? (
                <p className={styles.blockBody}>
                  <strong>Ref:</strong> Collection #{meta.collection_id}
                </p>
              ) : null}
              {meta.transaction_id ? (
                <p className={styles.blockBody}>
                  <strong>Ref:</strong> TXN #{meta.transaction_id}
                </p>
              ) : null}
            </div>
          </div>

          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td>Payment received</td>
                    <td>1</td>
                    <td>{fmtInr(invoice?.total)}</td>
                  </tr>
                ) : (
                  lines.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.product_name || "—"}</td>
                      <td>{row.qty ?? 1}</td>
                      <td>{fmtInr(row.subtotal ?? row.cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.totalsWrapper}>
            <div className={styles.totals}>
              <div className={styles.totalRow}>
                <span>Subtotal</span>
                <span>
                  {Number(invoice?.subtotal || 0).toFixed(2)} {cur}
                </span>
              </div>
              {Number(invoice?.tax) > 0 ? (
                <div className={styles.totalRow}>
                  <span>Tax</span>
                  <span>
                    {Number(invoice.tax).toFixed(2)} {cur}
                  </span>
                </div>
              ) : null}
              <div className={styles.totalRowGrand}>
                <span>Amount Paid</span>
                <span>{fmtInr(invoice?.total)}</span>
              </div>
            </div>
          </div>

          {meta.collection_pending_inr != null && Number(meta.collection_pending_inr) > 0 ? (
            <div className={styles.payBox}>
              Balance remaining on this collection: {fmtInr(meta.collection_pending_inr)}
            </div>
          ) : null}

          {company?.invoice_bank_name ? (
            <div className={styles.bankBox}>
              <strong>Bank Details</strong>
              <br />
              {company.invoice_bank_name}
              {company.invoice_account_no ? (
                <>
                  <br />
                  A/C: {company.invoice_account_no}
                </>
              ) : null}
              {company.invoice_ifsc ? (
                <>
                  <br />
                  IFSC: {company.invoice_ifsc}
                </>
              ) : null}
            </div>
          ) : null}

          {invoice?.notes ? <div className={styles.notes}>{invoice.notes}</div> : null}

          <footer className={styles.footer}>
            <p className={styles.footerText}>
              This is a computer-generated payment receipt and does not require a physical signature.
            </p>
          </footer>
        </div>
      </article>
    </div>
  );
}
