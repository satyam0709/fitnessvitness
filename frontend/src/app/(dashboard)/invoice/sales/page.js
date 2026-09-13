"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import {
  deleteInvoice,
  fetchInvoices,
  createInvoicePayment,
  duplicateInvoice,
  emailInvoice,
  fetchInvoicePayments,
  patchInvoicePayment,
  createPaymentReminder,
} from "@/lib/invoicesApi";
import { openHtmlFromApi, openJsonUrlFromApi } from "@/lib/openPrintableHtml";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { CrmFilterStrip } from "@/components/UI/CrmFilterStrip";
import styles from "../invoicePages.module.css";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
}

function isInvoiceReceipt(inv) {
  return inv.source_type === "collection_payment" || inv.source_type === "fitness_transaction";
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function rowTone(inv) {
  if (String(inv.status) === "cancelled") return styles.rowMuted;
  const due = Number(inv.due_amount);
  const paid = Number(inv.amount_paid);
  if (due <= 0 && Number(inv.total) > 0) return styles.rowPaid;
  if (paid > 0) return styles.rowPartial;
  return "";
}

function viewHref(inv) {
  return isInvoiceReceipt(inv) ? `/invoice/receipt/${inv.id}` : `/invoice/sales/${inv.id}`;
}

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export default function InvoiceSalesListPage() {
  const { confirm } = useConfirmDialog();
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [range, setRange] = useState(defaultRange);
  const [kind, setKind] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [gstBucket, setGstBucket] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [users, setUsers] = useState([]);
  const [payInv, setPayInv] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payBusy, setPayBusy] = useState(false);
  const [payMethods, setPayMethods] = useState(["Cash", "UPI", "Bank", "Card"]);
  const [emailInv, setEmailInv] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [histInv, setHistInv] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [histBusy, setHistBusy] = useState(false);
  const [editPay, setEditPay] = useState(null);
  const [remInv, setRemInv] = useState(null);
  const [remAt, setRemAt] = useState("");
  const [remBusy, setRemBusy] = useState(false);

  const [bookedSummary, setBookedSummary] = useState(null);

  const rangeLabel = useMemo(() => {
    try {
      const a = new Date(range.from).toLocaleDateString("en-IN");
      const b = new Date(range.to).toLocaleDateString("en-IN");
      return `${a} – ${b}`;
    } catch {
      return "";
    }
  }, [range.from, range.to]);

  const loadUsers = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/users");
      if (!res.ok) return;
      const d = await res.json();
      setUsers(Array.isArray(d.data) ? d.data : []);
    } catch {
      setUsers([]);
    }
  }, [isLoaded]);

  const loadPayMethods = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const res = await apiFetch("/v2/payment-methods");
      const d = await res.json().catch(() => ({}));
      const names = (d.methods || []).map((m) => m.method).filter(Boolean);
      if (names.length) setPayMethods(names);
    } catch {
      /* keep defaults */
    }
  }, [isLoaded]);

  const loadBookedSummary = useCallback(async () => {
    if (!isLoaded) return;
    try {
      const qp = new URLSearchParams({
        from: range.from,
        to: range.to,
      });
      const res = await apiFetch(`/opportunities/revenue-summary?${qp}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) setBookedSummary(json.data);
      else setBookedSummary(null);
    } catch {
      setBookedSummary(null);
    }
  }, [isLoaded, range.from, range.to]);

  const fetchList = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const params = {
        date_from: range.from,
        date_to: range.to,
      };
      if (staffId && staffId !== "all") params.staff_id = staffId;
      if (q.trim()) params.q = q.trim();
      if (gstBucket && gstBucket !== "all") params.gst_bucket = gstBucket;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;

      const { invoices } = await fetchInvoices(params);
      setRows(invoices);
    } catch (e) {
      setErr(e.message || "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, staffId, q, range.from, range.to, gstBucket, statusFilter]);

  useEffect(() => {
    loadUsers();
    loadPayMethods();
  }, [loadUsers, loadPayMethods]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    void loadBookedSummary();
  }, [loadBookedSummary]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["invoices:changed", "collections:changed", "opportunities:changed"], () => {
      void fetchList();
      void loadBookedSummary();
    });
  }, [isLoaded, fetchList, loadBookedSummary]);

  function applySearch(e) {
    e?.preventDefault?.();
    setQ(searchInput);
  }

  async function removeInvoice(inv) {
    const label = inv.invoice_number?.trim() || inv.customer_name?.trim() || null;
    const msg = buildDeleteMessage({ singular: "invoice", name: label });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      await deleteInvoice(inv.id);
      setRows((prev) => prev.filter((r) => r.id !== inv.id));
      showToast("Invoice deleted");
    } catch (e) {
      setErr(e.message || "Delete failed");
    }
  }

  async function copyInvoice(inv) {
    try {
      const d = await duplicateInvoice(inv.id);
      showToast(`Duplicated as ${d.invoice_number || d.id}`);
      if (d.id) window.location.href = `/invoice/sales/${d.id}`;
    } catch (e) {
      setErr(e.message || "Duplicate failed");
    }
  }

  async function openPdf(inv) {
    try {
      await openHtmlFromApi(`/v2/invoices/${inv.id}/pdf`);
    } catch (e) {
      setErr(e.message || "PDF failed");
    }
  }

  function openEmail(inv) {
    const to = String(inv.customer_email || "").trim();
    if (!to || !to.includes("@")) {
      setErr("Customer email is missing on this invoice");
      return;
    }
    setEmailInv(inv);
    setEmailTo(to);
    setErr(null);
  }

  async function submitEmail(e) {
    e.preventDefault();
    if (!emailInv) return;
    setEmailBusy(true);
    setErr(null);
    try {
      await emailInvoice(emailInv.id, emailTo);
      setEmailInv(null);
      showToast("Invoice emailed");
    } catch (ex) {
      setErr(ex.message || "Email failed");
    } finally {
      setEmailBusy(false);
    }
  }

  async function openWhatsapp(inv) {
    try {
      await openJsonUrlFromApi(`/v2/invoices/${inv.id}/whatsapp`);
    } catch (e) {
      setErr(e.message || "WhatsApp failed");
    }
  }

  function openPay(inv) {
    setPayInv(inv);
    setPayAmount(String(Number(inv.due_amount || 0)));
    setPayMethod(payMethods[0] || "Cash");
    setPayDate(new Date().toISOString().slice(0, 10));
  }

  async function submitPay(e) {
    e.preventDefault();
    if (!payInv) return;
    setPayBusy(true);
    setErr(null);
    try {
      await createInvoicePayment(payInv.id, {
        amount: Number(payAmount),
        method: payMethod,
        payment_date: payDate,
      });
      setPayInv(null);
      await fetchList();
    } catch (ex) {
      setErr(ex.message || "Payment failed");
    } finally {
      setPayBusy(false);
    }
  }

  async function openHistory(inv) {
    setHistInv(inv);
    setHistRows([]);
    setEditPay(null);
    setHistBusy(true);
    try {
      const d = await fetchInvoicePayments(inv.id);
      setHistRows(Array.isArray(d.payments) ? d.payments : []);
      if (d.invoice) setHistInv({ ...inv, ...d.invoice });
    } catch (e) {
      setErr(e.message || "Could not load payments");
    } finally {
      setHistBusy(false);
    }
  }

  async function saveEditPay(e) {
    e.preventDefault();
    if (!histInv || !editPay) return;
    setHistBusy(true);
    try {
      const d = await patchInvoicePayment(histInv.id, editPay.id, {
        payment_date: editPay.payment_date,
        method: editPay.method,
        amount: Number(editPay.amount),
      });
      setHistRows(Array.isArray(d.payments) ? d.payments : []);
      if (d.invoice) setHistInv((prev) => ({ ...prev, ...d.invoice }));
      setEditPay(null);
      await fetchList();
    } catch (ex) {
      setErr(ex.message || "Could not update payment");
    } finally {
      setHistBusy(false);
    }
  }

  function openReminder(inv) {
    const due = inv.due_date ? String(inv.due_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    setRemInv(inv);
    setRemAt(`${due}T10:00`);
  }

  async function submitReminder(e) {
    e.preventDefault();
    if (!remInv) return;
    setRemBusy(true);
    try {
      await createPaymentReminder(remInv.id, {
        remind_at: remAt ? new Date(remAt).toISOString() : undefined,
      });
      setRemInv(null);
      showToast("Payment reminder set");
    } catch (ex) {
      setErr(ex.message || "Reminder failed");
    } finally {
      setRemBusy(false);
    }
  }

  function exportCsv() {
    const headers = [
      "Invoice No",
      "Company",
      "Customer",
      "Mobile",
      "Date",
      "GST Type",
      "Created By",
      "Total",
      "Paid",
      "Due",
    ];
    const lines = visibleRows.map((inv) =>
      [
        inv.invoice_number || inv.id,
        inv.company_name || "",
        inv.customer_name || "",
        inv.customer_phone || "",
        fmtDate(inv.invoice_date),
        inv.gst_type || "",
        inv.creator_name || "",
        money(inv.total),
        money(inv.amount_paid),
        money(inv.due_amount),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([`\ufeff${headers.join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stripCounts = useMemo(() => {
    let receipt = 0;
    let manual = 0;
    let paid = 0;
    let due = 0;
    for (const inv of rows) {
      if (isInvoiceReceipt(inv)) receipt += 1;
      else manual += 1;
      if (Number(inv.due_amount || 0) > 0) due += 1;
      else paid += 1;
    }
    return { all: rows.length, receipt, manual, paid, due };
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((inv) => {
      if (kind === "receipt") return isInvoiceReceipt(inv);
      if (kind === "manual") return !isInvoiceReceipt(inv);
      if (kind === "due") return Number(inv.due_amount || 0) > 0;
      if (kind === "paid") return Number(inv.due_amount || 0) <= 0;
      return true;
    });
  }, [rows, kind]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Invoice</h1>
          <p className={styles.sub}>Sales invoices for the selected date range.</p>
        </div>
        <div className={styles.rowActions}>
          <Link href="/settings/invoice" className={styles.btnGhost}>
            Settings
          </Link>
        </div>
      </div>

      <CrmFilterStrip
        ariaLabel="Filter invoices"
        activeKey={kind}
        items={[
          { key: "all", label: "All Invoices", count: stripCounts.all, color: "#64748b" },
          { key: "receipt", label: "Payment receipts", count: stripCounts.receipt, color: "#0ea5e9" },
          { key: "manual", label: "Sales", count: stripCounts.manual, color: "#2563eb" },
          { key: "paid", label: "Paid", count: stripCounts.paid, color: "#16a34a" },
          { key: "due", label: "Due", count: stripCounts.due, color: "#dc2626" },
        ]}
        onSelect={(key) => setKind(key || "all")}
      />

      <form className={styles.filters} onSubmit={applySearch}>
        <input
          type="date"
          className={styles.select}
          value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          aria-label="From date"
        />
        <input
          type="date"
          className={styles.select}
          value={range.to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          aria-label="To date"
        />
        <select className={styles.select} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="all">All Staff</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>
        <select className={styles.select} value={gstBucket} onChange={(e) => setGstBucket(e.target.value)}>
          <option value="all">GST: ALL</option>
          <option value="gst">GST</option>
          <option value="non_gst">Non GST</option>
        </select>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">ALL</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          className={`${styles.input} ${styles.inputSearch}`}
          placeholder="Search…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className={styles.rowActions}>
          <button type="submit" className={styles.iconBtn} title="Search">
            <i className="fas fa-search" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={exportCsv} title="Export">
            <i className="fas fa-download" />
          </button>
        </div>
      </form>

      <div className={styles.midBar}>
        <Link href="/invoice/sales/new" className={styles.btnPrimary}>
          Create Invoice
        </Link>
        <span className={styles.dateRange}>{rangeLabel}</span>
      </div>

      {bookedSummary ? (
        <div className={styles.bookedStrip}>
          <Link href="/opportunities?view=won" className={styles.bookedChip}>
            <span className={styles.bookedChipLabel}>Booked Closed Won (range)</span>
            <strong>
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(
                Number(bookedSummary.window?.closed_won_value ?? bookedSummary.mtd?.closed_won_value ?? 0)
              )}
            </strong>
          </Link>
          <Link href="/opportunities?view=lost" className={styles.bookedChipLost}>
            <span className={styles.bookedChipLabel}>Closed Lost (range)</span>
            <strong>
              {Number(bookedSummary.window?.closed_lost_count ?? bookedSummary.mtd?.closed_lost_count ?? 0)} ·{" "}
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(
                Number(bookedSummary.window?.closed_lost_value ?? bookedSummary.mtd?.closed_lost_value ?? 0)
              )}
            </strong>
          </Link>
          <span className={styles.bookedHint}>Booked from opportunities — not invoice cash</span>
        </div>
      ) : null}

      {err && <p className={styles.err}>{err}</p>}

      {loading ? (
        <p className={styles.sub}>Loading…</p>
      ) : visibleRows.length === 0 ? (
        <div className={styles.empty}>
          <p>No invoices in this range.</p>
          <Link href="/invoice/sales/new" className={styles.btnPrimary} style={{ marginTop: 12 }}>
            New invoice
          </Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Actions</th>
                <th>Invoice No.</th>
                <th>Company Name</th>
                <th>Customer Name</th>
                <th>Mobile</th>
                <th>Date</th>
                <th>GST Type</th>
                <th>Created By</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((inv, idx) => (
                <tr key={inv.id} className={rowTone(inv)}>
                  <td>{idx + 1}</td>
                  <td>
                    {isInvoiceReceipt(inv) ? (
                      <div className={styles.actionIcons}>
                        <Link href={viewHref(inv)} className={styles.actBtn} title="View">
                          <i className="fas fa-eye" />
                        </Link>
                        <button type="button" className={styles.actBtn} title="PDF" onClick={() => openPdf(inv)}>
                          <i className="fas fa-file-download" />
                        </button>
                      </div>
                    ) : (
                      <div className={styles.actionIcons}>
                        <Link href={viewHref(inv)} className={styles.actBtn} title="View">
                          <i className="fas fa-eye" />
                        </Link>
                        <Link href={`/invoice/sales/new?id=${inv.id}`} className={styles.actBtn} title="Edit">
                          <i className="fas fa-pencil-alt" />
                        </Link>
                        <button type="button" className={styles.actBtn} title="Add payment" onClick={() => openPay(inv)}>
                          <i className="fas fa-money-bill-wave" />
                        </button>
                        <button type="button" className={styles.actBtn} title="Download" onClick={() => openPdf(inv)}>
                          <i className="fas fa-file-download" />
                        </button>
                        <button type="button" className={styles.actBtn} title="Email" onClick={() => openEmail(inv)}>
                          <i className="fas fa-envelope" />
                        </button>
                        <button type="button" className={`${styles.actBtn} ${styles.actWa}`} title="WhatsApp" onClick={() => openWhatsapp(inv)}>
                          <i className="fab fa-whatsapp" />
                        </button>
                        <button type="button" className={styles.actBtn} title="Payment history" onClick={() => openHistory(inv)}>
                          <i className="fas fa-list-alt" />
                        </button>
                        <button type="button" className={styles.actBtn} title="Payment reminder" onClick={() => openReminder(inv)}>
                          <i className="fas fa-bell" />
                        </button>
                        <button type="button" className={styles.actBtn} title="Copy invoice" onClick={() => copyInvoice(inv)}>
                          <i className="fas fa-copy" />
                        </button>
                        <button type="button" className={`${styles.actBtn} ${styles.actDanger}`} title="Delete" onClick={() => removeInvoice(inv)}>
                          <i className="fas fa-trash" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <Link href={viewHref(inv)} className={styles.invoiceNumLink}>
                      {inv.invoice_number || `#${inv.id}`}
                    </Link>
                    {isInvoiceReceipt(inv) ? (
                      <span className={`${styles.pill} ${styles.pillReceipt}`} style={{ marginLeft: 8 }}>
                        Receipt
                      </span>
                    ) : null}
                  </td>
                  <td>{inv.company_name || "—"}</td>
                  <td>{inv.customer_name || "—"}</td>
                  <td>{inv.customer_phone || "—"}</td>
                  <td>{fmtDate(inv.invoice_date)}</td>
                  <td>{inv.gst_type || "—"}</td>
                  <td>{inv.creator_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payInv ? (
        <div className={styles.modalOverlay} role="dialog" onClick={() => !payBusy && setPayInv(null)}>
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Add Payment</h2>
              <button type="button" className={styles.payClose} onClick={() => setPayInv(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitPay} className={styles.payModalBody}>
              <p className={styles.payMeta}>
                Amount: ₹{money(payInv.total)}
                <br />
                Current Due Amount: ₹{money(payInv.due_amount)}
              </p>
              <label className={styles.label}>Payment Date</label>
              <input
                type="date"
                className={styles.input}
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                required
              />
              <label className={styles.label}>Accept payments via</label>
              <select className={styles.select} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {payMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label className={styles.label}>Amount</label>
              <div className={styles.amountWrap}>
                <span>₹</span>
                <input
                  className={styles.input}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                />
              </div>
              <p className={styles.payMeta}>
                New Due Amount: ₹{money(Math.max(0, Number(payInv.due_amount || 0) - Number(payAmount || 0)))}
              </p>
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={payBusy}>
                  {payBusy ? "Saving…" : "Add Payment"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setPayInv(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {histInv ? (
        <div className={styles.modalOverlay} role="dialog">
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Payment Details</h2>
              <button type="button" className={styles.payClose} onClick={() => setHistInv(null)}>
                ×
              </button>
            </div>
            <div className={styles.payModalBody}>
              <div className={styles.histSummary}>
                <strong>{histInv.customer_name || "—"}</strong>
                <div>
                  Invoice No: #{histInv.invoice_number}
                  <br />
                  Total Amount: ₹{money(histInv.total)}
                  <br />
                  Due Amount: ₹{money(histInv.due_amount)}
                </div>
              </div>
              {histBusy && !histRows.length ? <p className={styles.sub}>Loading…</p> : null}
              <table className={styles.histTable}>
                <thead>
                  <tr>
                    <th>INDEX</th>
                    <th>DATE</th>
                    <th>METHOD</th>
                    <th>AMOUNT</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {histRows.map((p, i) => (
                    <tr key={p.id || i}>
                      <td>{i + 1}</td>
                      <td>{fmtDate(p.payment_date)}</td>
                      <td>{p.method || "—"}</td>
                      <td>₹{money(p.amount)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.actBtn}
                          title="Edit"
                          onClick={() =>
                            setEditPay({
                              id: p.id,
                              payment_date: String(p.payment_date || "").slice(0, 10),
                              method: p.method || payMethods[0],
                              amount: String(p.amount ?? ""),
                            })
                          }
                        >
                          <i className="fas fa-pencil-alt" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editPay ? (
                <form onSubmit={saveEditPay} className={styles.editPayForm}>
                  <input
                    type="date"
                    className={styles.input}
                    value={editPay.payment_date}
                    onChange={(e) => setEditPay((p) => ({ ...p, payment_date: e.target.value }))}
                  />
                  <select
                    className={styles.select}
                    value={editPay.method}
                    onChange={(e) => setEditPay((p) => ({ ...p, method: e.target.value }))}
                  >
                    {payMethods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    value={editPay.amount}
                    onChange={(e) => setEditPay((p) => ({ ...p, amount: e.target.value }))}
                  />
                  <div className={styles.payActions}>
                    <button type="submit" className={styles.btnPrimary} disabled={histBusy}>
                      Save
                    </button>
                    <button type="button" className={styles.btnGhost} onClick={() => setEditPay(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              <div className={styles.payActions}>
                <button type="button" className={styles.btnPrimary} onClick={() => setHistInv(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {remInv ? (
        <div className={styles.modalOverlay} role="dialog">
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Payment reminder</h2>
              <button type="button" className={styles.payClose} onClick={() => setRemInv(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitReminder} className={styles.payModalBody}>
              <label className={styles.label}>Remind at</label>
              <input
                type="datetime-local"
                className={styles.input}
                value={remAt}
                onChange={(e) => setRemAt(e.target.value)}
                required
              />
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={remBusy}>
                  {remBusy ? "Saving…" : "Set reminder"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setRemInv(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {emailInv ? (
        <div className={styles.modalOverlay} role="dialog" onClick={() => !emailBusy && setEmailInv(null)}>
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>Email invoice</h2>
              <button type="button" className={styles.payClose} onClick={() => setEmailInv(null)}>
                ×
              </button>
            </div>
            <form onSubmit={submitEmail} className={styles.payModalBody}>
              <label className={styles.label}>To</label>
              <input
                type="email"
                className={styles.input}
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                required
              />
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={emailBusy}>
                  {emailBusy ? "Sending…" : "Send"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setEmailInv(null)}>
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
