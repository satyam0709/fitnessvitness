"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
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

export default function InvoiceSalesListPage() {
  const { confirm } = useConfirmDialog();
  const { isLoaded } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [staffId, setStaffId] = useState("all");
  const [gstBucket, setGstBucket] = useState("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [users, setUsers] = useState([]);

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 7);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      label: `${start.toLocaleDateString("en-IN")} TO ${end.toLocaleDateString("en-IN")}`,
    };
  }, []);

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

  const fetchList = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        type: "sales",
        limit: "100",
        page: "1",
        date_from: range.from,
        date_to: range.to,
      });
      if (staffId && staffId !== "all") params.set("staff_id", staffId);
      if (gstBucket && gstBucket !== "all") params.set("gst_bucket", gstBucket);
      if (q.trim()) params.set("q", q.trim());

      const res = await apiFetch(`/v2/invoices?${params.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load invoices");
      setRows(d.invoices || []);
    } catch (e) {
      setErr(e.message || "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, staffId, gstBucket, q, range.from, range.to]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  function applySearch(e) {
    e?.preventDefault?.();
    setQ(searchInput);
  }

  function clearFilters() {
    setStaffId("all");
    setGstBucket("all");
    setSearchInput("");
    setQ("");
  }

  async function removeInvoice(inv) {
    const label =
      inv.invoice_number?.trim() ||
      inv.customer_name?.trim() ||
      null;
    const msg = buildDeleteMessage({ singular: "invoice", name: label });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/v2/invoices/${inv.id}`, { method: "DELETE" });
      if (!res.ok) return;
      setRows((prev) => prev.filter((r) => r.id !== inv.id));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Invoice</h1>
          <p className={styles.sub}>Sales invoices for the selected date range with staff and GST filters.</p>
        </div>
      </div>

      <form className={styles.filters} onSubmit={applySearch}>
        <select className={styles.select} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="all">All Staff</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
            </option>
          ))}
        </select>

        <select className={styles.select} value={gstBucket} onChange={(e) => setGstBucket(e.target.value)}>
          <option value="all">ALL</option>
          <option value="gst">GST</option>
          <option value="non_gst">Non GST</option>
        </select>

        <input
          className={`${styles.input} ${styles.inputSearch}`}
          placeholder="Search invoice #, customer, notes…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className={styles.rowActions}>
          <button type="submit" className={styles.iconBtn} aria-label="Search">
            <i className="fas fa-search" />
          </button>
          <button type="button" className={styles.iconBtn} aria-label="Clear" onClick={clearFilters}>
            <i className="fas fa-times" style={{ color: "#dc2626" }} />
          </button>
          <button type="button" className={styles.iconBtn} title="Date range uses last 7 days (backend filter)">
            <i className="fas fa-calendar" />
          </button>
          <button type="button" className={styles.iconBtn} title="Export coming soon" disabled>
            <i className="fas fa-download" />
          </button>
          <button type="button" className={styles.iconBtn} title="Import coming soon" disabled>
            <i className="fas fa-cloud-upload-alt" />
          </button>
        </div>
      </form>

      <div className={styles.midBar}>
        <Link href="/invoice/sales/new" className={styles.btnPrimary}>
          Create Invoice
        </Link>
        <span className={styles.dateRange}>{range.label}</span>
      </div>

      {err && <p className={styles.err}>{err}</p>}

      {loading ? (
        <p className={styles.sub}>Loading…</p>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>There are no records to display.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Staff</th>
                <th>GST</th>
                <th>Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoice/sales/${inv.id}`} className={styles.invoiceNumLink}>
                      {inv.invoice_number || `#${inv.id}`}
                    </Link>
                  </td>
                  <td>{fmtDate(inv.invoice_date)}</td>
                  <td>{inv.customer_name || "—"}</td>
                  <td>{inv.creator_name?.trim() || inv.creator_email || "—"}</td>
                  <td>
                    {inv.gst_mode && inv.gst_mode !== "none" ? (
                      <span className={`${styles.pill} ${styles.pillGst}`}>{inv.gst_mode}</span>
                    ) : (
                      <span className={`${styles.pill} ${styles.pillNon}`}>Non GST</span>
                    )}
                  </td>
                  <td>
                    {Number(inv.total || 0).toFixed(2)} {inv.currency || "INR"}
                  </td>
                  <td>{inv.status}</td>
                  <td>
                    <button type="button" className={styles.danger} onClick={() => removeInvoice(inv)}>
                      Delete
                    </button>
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
