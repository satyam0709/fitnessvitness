"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

const PAGE_SIZE = 30;

const STATUS_COLORS = {
  trial: { bg: "#fff7e6", color: "#d4a900" },
  active: { bg: "#f0fdf4", color: "#15803d" },
  expired: { bg: "#fef2f2", color: "#dc2626" },
  trial_expired: { bg: "#fef2f2", color: "#dc2626" },
  cancelled: { bg: "#f3f4f6", color: "#6b7280" },
};

const STATUSES = ["trial", "active", "expired", "trial_expired", "cancelled"];

function OrdersContent() {
  const {} = useAuth();
  const { refreshNonce } = useAdminRealtime();
  const firstLoad = useRef(true);
  const searchParams = useSearchParams();
  const router = useRouter();
  const statusFromUrl = searchParams.get("status") || "";
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(statusFromUrl);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setFilter(statusFromUrl);
  }, [statusFromUrl]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));

  const fetchOrders = useCallback(async () => {
    if (firstLoad.current) {
      setLoading(true);
      firstLoad.current = false;
    }
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
      if (filter) params.set("status", filter);
      const res = await apiFetch(`/admin/orders?${params}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
      } else {
        setToast(data.message || `Could not load orders (${res.status})`);
        setTimeout(() => setToast(""), 5000);
      }
    } catch (e) {
      setToast(e.message || "Could not load orders");
      setTimeout(() => setToast(""), 4000);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders, refreshNonce]);

  function onFilterChange(next) {
    setFilter(next);
    const u = new URLSearchParams(searchParams.toString());
    if (next) u.set("status", next);
    else u.delete("status");
    const q = u.toString();
    router.replace(q ? `/admin/order?${q}` : "/admin/order", { scroll: false });
  }

  async function changeStatus(orderId, status) {
    try {
      const res = await apiFetch(`/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setToast(data.message || "Update failed — check server logs");
        setTimeout(() => setToast(""), 4000);
        fetchOrders();
        return;
      }
      setToast("Status saved on server");
      setTimeout(() => setToast(""), 3000);
      fetchOrders();
    } catch (e) {
      setToast(e.message || "Network error");
      setTimeout(() => setToast(""), 4000);
    }
  }

  return (
    <div>
      {toast && <div className={styles.toast}><i className="fas fa-check-circle" /> {toast}</div>}

      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Orders</h2>
          <p className={styles.pageSubtitle}>{total} total orders</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-main)",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>User</th>
              <th>Plan</th>
              <th>Total</th>
              <th>Currency</th>
              <th>Status</th>
              <th>Date</th>
              <th>Change Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={styles.tableEmpty}><i className="fas fa-spinner fa-spin" /> Loading...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className={styles.tableEmpty}>No orders found</td></tr>
            ) : orders.map((o) => {
              const sc = STATUS_COLORS[o.status] || { bg: "#f3f4f6", color: "#6b7280" };
              return (
                <tr key={o.id}>
                  <td><span className={styles.dateText}>#{o.id}</span></td>
                  <td>
                    <p className={styles.tableName}>{o.first_name || ""} {o.last_name || ""}</p>
                    <p className={styles.tableEmail}>{o.email}</p>
                  </td>
                  <td><span className={styles.planText}>{o.package_name || "—"}</span></td>
                  <td><span className={styles.tableName}>{o.currency === "USD" ? "$" : "₹"}{Number(o.total || 0).toLocaleString()}</span></td>
                  <td><span className={styles.dateText}>{o.currency}</span></td>
                  <td><span className={styles.subBadge} style={{ background: sc.bg, color: sc.color }}>{o.status}</span></td>
                  <td><span className={styles.dateText}>{o.created_at ? new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></td>
                  <td>
                    <select
                      value={o.status}
                      onChange={(e) => changeStatus(o.id, e.target.value)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-card)",
                        color: "var(--text-main)",
                        fontFamily: "var(--font-display)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && total > PAGE_SIZE ? (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className={styles.dateText} style={{ alignSelf: "center" }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminOrdersPage() {
  return <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>}><OrdersContent /></Suspense>;
}