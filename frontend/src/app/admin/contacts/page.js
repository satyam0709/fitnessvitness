"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useCallback, useRef } from "react";
import { Suspense } from "react";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";
import contactStyles from "./contacts.module.css";

function ContactsContent() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const firstLoad = useRef(true);
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [toast, setToast] = useState("");
  const [listError, setListError] = useState(null);

  const fetchContacts = useCallback(async () => {
    if (firstLoad.current) {
      setLoading(true);
      firstLoad.current = false;
    }
    setListError(null);
    try {
      const params = new URLSearchParams({ limit: 30 });
      if (typeFilter) params.set("type", typeFilter);
      if (filter === "unread") params.set("is_read", "false");
      const res = await apiFetch(`/admin/contacts?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setListError(data.message || res.statusText || "Could not load contacts");
        setRequests([]);
        setTotal(0);
        return;
      }
      setRequests(data.requests || []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setListError(e.message || "Network error");
      setRequests([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, typeFilter]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts, refreshNonce]);

  async function markRead(id) {
    try {
      const res = await apiFetch(`/contact/${id}/read`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setToast(data.message || "Could not mark as read");
        setTimeout(() => setToast(""), 4000);
        return;
      }
      setToast("Saved on server — marked as read");
      setTimeout(() => setToast(""), 2500);
      fetchContacts();
    } catch (e) {
      setToast(e.message || "Network error");
      setTimeout(() => setToast(""), 4000);
    }
  }

  return (
    <div>
      {listError ? (
        <div className={styles.toast} style={{ position: "relative", bottom: "auto", right: "auto", marginBottom: 16, border: "1px solid #fecaca", color: "#b91c1c" }}>
          <i className="fas fa-exclamation-circle" /> {listError}
        </div>
      ) : null}
      {toast && <div className={styles.toast}><i className="fas fa-check-circle" /> {toast}</div>}

      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Contact Requests</h2>
          <p className={styles.pageSubtitle}>{total} requests</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ label: "All", value: "all" }, { label: "Unread", value: "unread" }].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`${contactStyles.filterBtn} ${filter === f.value ? contactStyles.filterActive : ""}`}
            >
              {f.label}
            </button>
          ))}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
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
            <option value="">All Types</option>
            <option value="contact">Contact</option>
            <option value="demo">Demo</option>
          </select>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Type</th>
              <th>Message</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className={styles.tableEmpty}><i className="fas fa-spinner fa-spin" /> Loading...</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={7} className={styles.tableEmpty}>No contact requests found</td></tr>
            ) : requests.map((r) => (
              <tr key={r.id}>
                <td><span className={styles.tableName}>{r.name}</span></td>
                <td><span className={styles.tableEmail}>{r.email}</span></td>
                <td><span className={styles.dateText}>{r.phone}</span></td>
                <td>
                  <span className={styles.subBadge} style={{
                    background: r.type === "demo" ? "rgba(59,130,246,0.12)" : "rgba(100,116,139,0.12)",
                    color: r.type === "demo" ? "#1d4ed8" : "#64748b",
                  }}>
                    {r.type}
                  </span>
                </td>
                <td>
                  <span className={styles.dateText} style={{ maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.message || "—"}
                  </span>
                </td>
                <td><span className={styles.dateText}>{r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</span></td>
                <td>
                  {Number(r.is_read) === 1 ? (
                    <span className={styles.activeBadge} style={{ background: "#f0fdf4", color: "#15803d" }}>Read</span>
                  ) : (
                    <button className={styles.actionBtn} title="Mark as Read" onClick={() => markRead(r.id)} style={{ fontSize: 11, width: "auto", padding: "4px 10px", gap: 4, display: "flex" }}>
                      <i className="fas fa-check" /> Mark Read
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminContactsPage() {
  return <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>}><ContactsContent /></Suspense>;
}