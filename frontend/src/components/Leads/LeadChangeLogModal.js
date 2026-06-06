"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./LeadQuickModals.module.css";

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * @param {{ leadId: number|string, onClose: () => void }} props
 */
export default function LeadChangeLogModal({ leadId, onClose }) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 25;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch(`/leads/${leadId}/change-log?page=${page}&limit=${limit}`);
        const json = await res.json();
        if (!cancelled && json.success) {
          setRows(json.data || []);
          setTotal(json.pagination?.total || 0);
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [leadId, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal} style={{ maxWidth: 560, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Change Log</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.body} style={{ overflow: "auto", flex: 1 }}>
          {loading ? (
            <p style={{ color: "#94a3b8" }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No changes recorded.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <strong style={{ color: "#6366f1" }}>{c.field_name}</strong>
                    <span style={{ color: "#94a3b8" }}>{formatDateTime(c.created_at)}</span>
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                    {c.old_value || "—"} → <strong>{c.new_value || "—"}</strong>
                  </p>
                  {(c.user_name || c.user_email) && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>
                      {c.user_name || c.user_email}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className={styles.footer} style={{ justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              className={styles.btnGhost}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
            <button
              type="button"
              className={styles.btnGhost}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
        <div className={styles.footer}>
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
