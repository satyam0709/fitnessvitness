"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";

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

const TABS = [
  { key: "followups", label: "Follow-ups" },
  { key: "notes", label: "Notes" },
  { key: "change_log", label: "Change Log" },
];

/**
 * @param {{ leadId: number|string, initialFollowups?: Array }} props
 */
export default function LeadHistoryPanel({ leadId, initialFollowups = [] }) {
  const [tab, setTab] = useState("followups");
  const [counts, setCounts] = useState({ followups: initialFollowups.length, notes: 0, change_log: 0 });
  const [rows, setRows] = useState(initialFollowups);
  const [loading, setLoading] = useState(false);

  const loadCounts = useCallback(async () => {
    try {
      const res = await apiFetch(`/leads/${leadId}/history`);
      const json = await res.json();
      if (json.success && json.data) setCounts(json.data);
    } catch {
      /* ignore */
    }
  }, [leadId]);

  const loadTab = useCallback(async (t) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/leads/${leadId}/history?tab=${t}`);
      const json = await res.json();
      if (json.success) setRows(json.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (tab === "followups" && initialFollowups.length) {
      setRows(initialFollowups);
      return;
    }
    loadTab(tab);
  }, [tab, leadId, initialFollowups, loadTab]);

  return (
    <div style={{ padding: 24, borderRadius: 12, background: "var(--surface, #fff)", border: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: tab === t.key ? "2px solid #6366f1" : "1px solid #e2e8f0",
              background: tab === t.key ? "#6366f11a" : "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t.label} ({counts[t.key] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>No records yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tab === "followups" &&
            rows.map((fu) => (
              <div key={fu.id} style={rowStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>
                    {fu.creator_email || "Unknown"}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDateTime(fu.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{fu.note}</p>
                {fu.next_follow_up_at && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
                    Next: {formatDateTime(fu.next_follow_up_at)}
                  </p>
                )}
              </div>
            ))}

          {tab === "notes" &&
            rows.map((n) => (
              <div key={n.id} style={rowStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>
                    {n.creator_email || "Unknown"}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDateTime(n.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{n.content}</p>
              </div>
            ))}

          {tab === "change_log" &&
            rows.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>
                    {c.field_name}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDateTime(c.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>{c.old_value || "—"}</span>
                  {" → "}
                  <strong>{c.new_value || "—"}</strong>
                </p>
                {c.user_email && (
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>by {c.user_email}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

const rowStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
};
