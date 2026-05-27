"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { fetchInvoiceReceipt } from "@/lib/invoicesApi";
import PaymentReceiptView from "@/components/Invoice/PaymentReceiptView";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "../../invoicePages.module.css";

export default function PaymentReceiptPage() {
  const params = useParams();
  const id = params?.id;
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const [invoice, setInvoice] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded || !id) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchInvoiceReceipt(id);
      setInvoice(data.invoice);
      setCompany(data.company);
    } catch (e) {
      setErr(e.message || "Could not load receipt");
      setInvoice(null);
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Payment receipt</h1>
          <p className={styles.sub}>Download or share with your customer on WhatsApp.</p>
        </div>
        <div className={styles.rowActions}>
          <Link href="/invoice/sales" className={styles.btnGhost}>
            All invoices
          </Link>
          {invoice?.id ? (
            <Link href={`/invoice/sales/${invoice.id}`} className={styles.btnPrimary}>
              Invoice details
            </Link>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className={styles.sub}>Loading receipt…</p>
      ) : err ? (
        <p className={styles.err}>{err}</p>
      ) : !invoice ? (
        <p className={styles.sub}>Receipt not found.</p>
      ) : (
        <PaymentReceiptView
          invoice={invoice}
          company={company}
          onWhatsAppError={(msg) => showToast(msg, "error")}
        />
      )}
    </div>
  );
}
