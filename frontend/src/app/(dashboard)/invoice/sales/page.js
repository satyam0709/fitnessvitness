"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { deleteInvoice, fetchInvoices } from "@/lib/invoicesApi";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "../invoicePages.module.css";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [range, setRange] = useState(defaultRange);
  const [kind, setKind] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [users, setUsers] = useState([]);

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
      if (kind && kind !== "all") params.kind = kind;
      if (staffId && staffId !== "all") params.staff_id = staffId;
      if (q.trim()) params.q = q.trim();

      const { invoices } = await fetchInvoices(params);
      setRows(invoices);
    } catch (e) {
      setErr(e.message || "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, kind, staffId, q, range.from, range.to]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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
    } catch {
      /* ignore */
    }
  }

  const isReceipt = (inv) =>
    inv.source_type === "collection_payment" || inv.source_type === "fitness_transaction";

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Invoices</h1>
          <p className={styles.sub}>
            Payment receipts (from Collections) and manual sales invoices. Updates live when payments are recorded.
          </p>
        </div>
        <div className={styles.rowActions}>
          <Link href="/settings/invoice" className={styles.btnGhost}>
            Settings
          </Link>
          <Link href="/invoice/sales/new" className={styles.btnPrimary}>
            New invoice
          </Link>
        </div>
      </div>

      <div className={styles.tabRow}>
        {[
          { id: "all", label: "All" },
          { id: "receipt", label: "Payment receipts" },
          { id: "manual", label: "Manual invoices" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${kind === t.id ? styles.tabActive : ""}`}
            onClick={() => setKind(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
          <option value="all">All staff</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>
        <input
          className={`${styles.input} ${styles.inputSearch}`}
          placeholder="Search #, customer…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className={styles.iconBtn} aria-label="Search">
          <i className="fas fa-search" />
        </button>
      </form>

      <p className={styles.dateRange}>{rangeLabel}</p>

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
      ) : rows.length === 0 ? (
        <div className={styles.empty}>
          <p>No invoices in this range.</p>
          <Link href="/collections" className={styles.btnPrimary} style={{ marginTop: 12 }}>
            Record a payment
          </Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link
                      href={isReceipt(inv) ? `/invoice/receipt/${inv.id}` : `/invoice/sales/${inv.id}`}
                      className={styles.invoiceNumLink}
                    >
                      {inv.invoice_number || `#${inv.id}`}
                    </Link>
                  </td>
                  <td>{fmtDate(inv.invoice_date)}</td>
                  <td>{inv.customer_name || "—"}</td>
                  <td>
                    {isReceipt(inv) ? (
                      <span className={`${styles.pill} ${styles.pillReceipt}`}>Receipt</span>
                    ) : (
                      <span className={`${styles.pill} ${styles.pillNon}`}>Sales</span>
                    )}
                  </td>
                  <td>₹{Number(inv.total || 0).toLocaleString("en-IN")}</td>
                  <td>{inv.status}</td>
                  <td>
                    {!isReceipt(inv) ? (
                      <button type="button" className={styles.danger} onClick={() => removeInvoice(inv)}>
                        Delete
                      </button>
                    ) : (
                      <Link href={`/invoice/receipt/${inv.id}`} className={styles.linkAction}>
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
