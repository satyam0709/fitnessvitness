"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { searchClients } from "@/lib/fitnessApi";
import {
  getCollections,
  getCollectionSummary,
  getCollection,
  createCollection,
  addCollectionPayment,
  updateCollection,
  markCollectionPaid,
} from "@/lib/collectionsApi";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { useListHighlight, itemHighlightClass } from "@/lib/useListHighlight";
import { useToast } from "@/components/Toast/ToastContext";
import CrmShellModal from "@/components/Dashboard/CrmShellModal";
import styles from "./collectionsPage.module.css";

const PAY_MODES = ["GPay", "Cash", "Online Transfer", "Cheque", "UPI", "NEFT"];
const COLLECTION_TYPES = [
  { value: "diet_plan", label: "Diet / plan" },
  { value: "supplement", label: "Supplement" },
  { value: "other", label: "Other" },
];

const STATUS_BADGE = {
  open: styles.badgeOpen,
  partial: styles.badgePartial,
  paid: styles.badgePaid,
  cancelled: styles.badgeCancelled,
};

function fmtInr(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyLine() {
  return {
    collection_type: "diet_plan",
    title: "",
    total_inr: "",
    paid_now_inr: "",
    quantity: "1",
  };
}

function CollectionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { highlightedId: highlightId } = useListHighlight(
    searchParams.get("highlight"),
    !loading,
    styles.rowHighlight
  );

  const [due, setDue] = useState("open");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showPay, setShowPay] = useState(null);
  const [showReschedule, setShowReschedule] = useState(null);

  const [walkIn, setWalkIn] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [externalBuyer, setExternalBuyer] = useState({ full_name: "", phone: "" });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [visitForm, setVisitForm] = useState({
    next_followup_date: "",
    pay_mode: "UPI",
    transaction_date: todayYmd(),
    notes: "",
  });
  const [payForm, setPayForm] = useState({ amount_inr: "", pay_mode: "UPI", paid_at: todayYmd(), notes: "" });
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [saving, setSaving] = useState(false);

  const searchTimeout = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (searchParams.get("create") === "1") setShowCreate(true);
  }, [searchParams]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [listRes, sum] = await Promise.all([
        getCollections({
          due: due || undefined,
          status: status || undefined,
          type: type || undefined,
          q: debouncedQ || undefined,
          limit: 100,
        }),
        getCollectionSummary(),
      ]);
      setRows(listRes.data);
      setSummary(sum);
    } catch (e) {
      setError(e.message || "Failed to load collections");
    } finally {
      setLoading(false);
    }
  }, [due, status, type, debouncedQ]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void loadRef.current();
    return subscribeCrmLive(["collections:changed"], refresh);
  }, []);

  function handleClientSearch(value) {
    setClientSearch(value);
    setSelectedClient(null);
    clearTimeout(searchTimeout.current);
    if (value.length < 2) {
      setClientResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchClients(value);
        setClientResults(results);
      } catch {
        setClientResults([]);
      }
    }, 300);
  }

  async function submitVisit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const validLines = lines
        .filter((l) => String(l.title).trim())
        .map((l) => ({
          collection_type: l.collection_type,
          title: l.title.trim(),
          total_inr: Number(l.total_inr) || 0,
          paid_now_inr: Number(l.paid_now_inr) || 0,
          quantity: Number(l.quantity) || 1,
        }));
      if (!validLines.length) throw new Error("Add at least one line with a title");

      const hasPending = validLines.some(
        (l) => (Number(l.total_inr) || 0) > (Number(l.paid_now_inr) || 0)
      );
      if (hasPending && !visitForm.next_followup_date) {
        throw new Error("Follow-up date is required when balance remains");
      }

      const payload = {
        lines: validLines,
        next_followup_date: visitForm.next_followup_date || null,
        pay_mode: visitForm.pay_mode,
        transaction_date: visitForm.transaction_date,
        notes: visitForm.notes || null,
      };

      if (walkIn) {
        payload.external_buyer = {
          full_name: externalBuyer.full_name.trim(),
          phone: externalBuyer.phone.trim() || null,
        };
      } else {
        if (!selectedClient?.client_id) throw new Error("Select a client");
        payload.client_id = selectedClient.client_id;
      }

      const created = await createCollection(payload);
      showToast("Collection recorded", "success");
      setShowCreate(false);
      const withReceipt = Array.isArray(created)
        ? created.find((c) => c?.receipt_invoice_id)
        : null;
      if (withReceipt?.receipt_invoice_id) {
        router.push(`/invoice/receipt/${withReceipt.receipt_invoice_id}`);
      } else {
        router.replace("/collections");
      }
      void load();
    } catch (err) {
      showToast(err.message || "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  function openReceiptIfAny(data) {
    const receiptId = data?.receipt_invoice_id;
    if (receiptId) {
      router.push(`/invoice/receipt/${receiptId}`);
      return true;
    }
    return false;
  }

  async function submitPayment(e) {
    e.preventDefault();
    if (!showPay) return;
    setSaving(true);
    try {
      const data = await addCollectionPayment(showPay.id, {
        amount_inr: Number(payForm.amount_inr),
        pay_mode: payForm.pay_mode,
        paid_at: payForm.paid_at,
        notes: payForm.notes || null,
      });
      showToast("Payment recorded — opening receipt", "success");
      setShowPay(null);
      void load();
      if (!openReceiptIfAny(data)) {
        showToast("Payment saved (receipt will appear in Invoices)", "success");
      }
    } catch (err) {
      showToast(err.message || "Payment failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function submitReschedule(e) {
    e.preventDefault();
    if (!showReschedule) return;
    setSaving(true);
    try {
      await updateCollection(showReschedule.id, {
        next_followup_date: rescheduleDate,
      });
      showToast("Follow-up rescheduled", "success");
      setShowReschedule(null);
      void load();
    } catch (err) {
      showToast(err.message || "Update failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid(row) {
    if (!confirm(`Mark "${row.title}" as fully paid?`)) return;
    try {
      const data = await markCollectionPaid(row.id);
      showToast("Marked as paid", "success");
      void load();
      openReceiptIfAny(data);
    } catch (err) {
      showToast(err.message || "Failed", "error");
    }
  }

  const clientLabel = (row) =>
    row.client_name
      ? `${row.client_name} (${row.client_id})`
      : row.external_buyer_name || "Walk-in";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Collections</h1>
          <p className={styles.subtitle}>
            Track diet & supplement payments, balances, and follow-up dates
          </p>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={() => setShowCreate(true)}>
          <i className="fas fa-plus" /> Record visit
        </button>
      </header>

      {summary && (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Open</div>
            <div className={styles.statValue}>{summary.open_count ?? 0}</div>
          </div>
          <div className={`${styles.stat} ${styles.statWarn}`}>
            <div className={styles.statLabel}>Due today</div>
            <div className={styles.statValue}>{summary.due_today ?? 0}</div>
          </div>
          <div className={`${styles.stat} ${styles.statWarn}`}>
            <div className={styles.statLabel}>Overdue</div>
            <div className={styles.statValue}>{summary.overdue ?? 0}</div>
          </div>
          <div className={`${styles.stat} ${styles.statOk}`}>
            <div className={styles.statLabel}>Total pending</div>
            <div className={styles.statValue}>{fmtInr(summary.total_pending_inr)}</div>
          </div>
          <Link href="/opportunities?view=won" className={`${styles.stat} ${styles.statBooked}`}>
            <div className={styles.statLabel}>Booked won (MTD)</div>
            <div className={styles.statValue}>{fmtInr(summary.booked_closed_won_mtd)}</div>
          </Link>
          <Link href="/opportunities?view=lost" className={`${styles.stat} ${styles.statLost}`}>
            <div className={styles.statLabel}>Closed lost (MTD)</div>
            <div className={styles.statValue}>
              {summary.closed_lost_count_mtd ?? 0} · {fmtInr(summary.closed_lost_value_mtd)}
            </div>
          </Link>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.toolbar}>
        <select value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="open">Open balances</option>
          <option value="today">Due today</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Upcoming</option>
          <option value="all">All</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {COLLECTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          className={`${styles.searchInput}`}
          placeholder="Search client or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loading}>Loading collections…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>No collections match your filters.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Item</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Pending</th>
                <th>Follow-up</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={itemHighlightClass(row.id, highlightId, styles.rowHighlight)}
                >
                  <td>
                    {row.client_id ? (
                      <Link href={`/clients/${row.client_id}`}>{clientLabel(row)}</Link>
                    ) : (
                      clientLabel(row)
                    )}
                  </td>
                  <td>
                    <span className={styles.typeBadge}>{row.collection_type}</span>
                    <div>{row.title}</div>
                  </td>
                  <td>{fmtInr(row.total_inr)}</td>
                  <td>{fmtInr(row.received_inr)}</td>
                  <td>
                    <strong>{fmtInr(row.pending_inr)}</strong>
                  </td>
                  <td>
                    {row.next_followup_date
                      ? new Date(row.next_followup_date).toLocaleDateString("en-IN")
                      : "—"}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${STATUS_BADGE[row.status] || ""}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {row.status === "paid" && row.latest_receipt_invoice_id ? (
                        <Link
                          href={`/invoice/receipt/${row.latest_receipt_invoice_id}`}
                          className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                        >
                          <i className="fas fa-file-invoice" /> Receipt
                        </Link>
                      ) : null}
                      {row.status !== "paid" && row.status !== "cancelled" && (
                        <>
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                            onClick={() => {
                              setShowPay(row);
                              setPayForm({
                                amount_inr: String(row.pending_inr || ""),
                                pay_mode: "UPI",
                                paid_at: todayYmd(),
                                notes: "",
                              });
                            }}
                          >
                            Pay
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => {
                              setShowReschedule(row);
                              setRescheduleDate(
                                row.next_followup_date
                                  ? String(row.next_followup_date).slice(0, 10)
                                  : todayYmd()
                              );
                            }}
                          >
                            Reschedule
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => handleMarkPaid(row)}
                          >
                            Mark paid
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CrmShellModal open={showCreate} title="Record visit & payments" onClose={() => setShowCreate(false)} wide>
        <form onSubmit={submitVisit}>
          <button
            type="button"
            className={styles.walkInToggle}
            onClick={() => setWalkIn((v) => !v)}
          >
            {walkIn ? "Switch to registered client" : "Walk-in / external buyer"}
          </button>

          {walkIn ? (
            <div className={styles.formGrid}>
              <div className={styles.formField}>
                <label>Name</label>
                <input
                  required
                  value={externalBuyer.full_name}
                  onChange={(e) =>
                    setExternalBuyer((p) => ({ ...p, full_name: e.target.value }))
                  }
                />
              </div>
              <div className={styles.formField}>
                <label>Phone</label>
                <input
                  value={externalBuyer.phone}
                  onChange={(e) => setExternalBuyer((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div className={styles.formField}>
              <label>Client</label>
              <input
                value={clientSearch}
                onChange={(e) => handleClientSearch(e.target.value)}
                placeholder="Search by name or ID…"
              />
              {clientResults.length > 0 && (
                <div className={styles.clientResults}>
                  {clientResults.map((c) => (
                    <div
                      key={c.client_id}
                      className={styles.clientOption}
                      onClick={() => {
                        setSelectedClient(c);
                        setClientSearch(`${c.full_name} (${c.client_id})`);
                        setClientResults([]);
                      }}
                    >
                      <strong>{c.full_name}</strong> — {c.client_id}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p style={{ fontWeight: 700, margin: "1rem 0 0.5rem", fontSize: "0.9rem" }}>Line items</p>
          {lines.map((line, idx) => (
            <div key={idx} className={styles.linesBlock}>
              <div className={styles.lineRow}>
                <div className={styles.formField}>
                  <label>Type</label>
                  <select
                    value={line.collection_type}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], collection_type: e.target.value };
                      setLines(next);
                    }}
                  >
                    {COLLECTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.formField}>
                  <label>Title</label>
                  <input
                    value={line.title}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], title: e.target.value };
                      setLines(next);
                    }}
                    placeholder="e.g. 3 Month Plan"
                  />
                </div>
                <div className={styles.formField}>
                  <label>Total (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.total_inr}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], total_inr: e.target.value };
                      setLines(next);
                    }}
                  />
                </div>
                <div className={styles.formField}>
                  <label>Paid now (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.paid_now_inr}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], paid_now_inr: e.target.value };
                      setLines(next);
                    }}
                  />
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className={styles.lineRemove}
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          <button type="button" className={styles.addLineBtn} onClick={() => setLines([...lines, emptyLine()])}>
            + Add line
          </button>

          <div className={styles.formGrid} style={{ marginTop: "1rem" }}>
            <div className={styles.formField}>
              <label>Follow-up date (if balance)</label>
              <input
                type="date"
                value={visitForm.next_followup_date}
                onChange={(e) =>
                  setVisitForm((p) => ({ ...p, next_followup_date: e.target.value }))
                }
              />
            </div>
            <div className={styles.formField}>
              <label>Visit date</label>
              <input
                type="date"
                value={visitForm.transaction_date}
                onChange={(e) =>
                  setVisitForm((p) => ({ ...p, transaction_date: e.target.value }))
                }
              />
            </div>
            <div className={styles.formField}>
              <label>Payment mode</label>
              <select
                value={visitForm.pay_mode}
                onChange={(e) => setVisitForm((p) => ({ ...p, pay_mode: e.target.value }))}
              >
                {PAY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.formField} ${styles.full}`}>
              <label>Notes</label>
              <textarea
                rows={2}
                value={visitForm.notes}
                onChange={(e) => setVisitForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? "Saving…" : "Save collection"}
            </button>
          </div>
        </form>
      </CrmShellModal>

      <CrmShellModal
        open={!!showPay}
        title={`Record payment — ${showPay?.title || ""}`}
        onClose={() => setShowPay(null)}
      >
        <form onSubmit={submitPayment}>
          <div className={styles.formGrid}>
            <div className={styles.formField}>
              <label>Amount (₹)</label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={payForm.amount_inr}
                onChange={(e) => setPayForm((p) => ({ ...p, amount_inr: e.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>Date</label>
              <input
                type="date"
                value={payForm.paid_at}
                onChange={(e) => setPayForm((p) => ({ ...p, paid_at: e.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label>Mode</label>
              <select
                value={payForm.pay_mode}
                onChange={(e) => setPayForm((p) => ({ ...p, pay_mode: e.target.value }))}
              >
                {PAY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.formField} ${styles.full}`}>
              <label>Notes</label>
              <input
                value={payForm.notes}
                onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowPay(null)}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? "Saving…" : "Record payment"}
            </button>
          </div>
        </form>
      </CrmShellModal>

      <CrmShellModal
        open={!!showReschedule}
        title="Reschedule follow-up"
        onClose={() => setShowReschedule(null)}
      >
        <form onSubmit={submitReschedule}>
          <div className={styles.formField}>
            <label>Next follow-up date</label>
            <input
              type="date"
              required
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
            />
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowReschedule(null)}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              Save
            </button>
          </div>
        </form>
      </CrmShellModal>
    </div>
  );
}

export default function CollectionsPage() {
  return (
    <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
      <CollectionsPageInner />
    </Suspense>
  );
}
