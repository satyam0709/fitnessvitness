"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, publicFileUrl } from "@/lib/api";
import LeadQuickModals from "@/components/Leads/LeadQuickModals";
import styles from "../leads.module.css";

const STATUS_CONFIG = {
  new:        { label: "New",        color: "#6366f1" },
  processing: { label: "Processing", color: "#f59e0b" },
  close_by:   { label: "Close-by",   color: "#3b82f6" },
  confirm:    { label: "Confirm",    color: "#22c55e" },
  cancel:     { label: "Cancel",     color: "#ef4444" },
};

const STATUSES = Object.entries(STATUS_CONFIG).map(([key, v]) => ({ key, ...v }));

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function LeadDetailPage() {
  const params    = useParams();
  useAuth();

  const [lead, setLead]         = useState(null);
  const [followups, setFollowups] = useState([]);
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [modal, setModal]       = useState(null);
  const [toast, setToast]       = useState(null);

  const id = params?.id;

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr("");
    try {
      const [leadRes, fuRes, usersRes] = await Promise.all([
        apiFetch(`/leads/${id}`),
        apiFetch(`/leads/${id}/followups`),
        apiFetch("/users"),
      ]);

      const leadJson  = await leadRes.json();
      const fuJson    = await fuRes.json();
      const usersJson = await usersRes.json();

      if (!leadRes.ok || !leadJson.success) {
        setErr(leadJson.message || "Lead not found");
        setLead(null);
        return;
      }

      setLead(leadJson.data);
      setFollowups(fuJson.success ? (fuJson.data || []) : []);
      if (usersJson.success && Array.isArray(usersJson.data)) {
        setUsers(usersJson.data.filter((u) => u.is_active !== 0));
      }
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Loading lead…
        </div>
      </div>
    );
  }

  if (err || !lead) {
    return (
      <div className={styles.page}>
        <p className={styles.sub}>{err || "Lead not found."}</p>
        <Link href="/leads" className={styles.leadName}>← Back to leads</Link>
      </div>
    );
  }

  const sc          = STATUS_CONFIG[lead.status] || { label: lead.status, color: "#94a3b8" };
  const attachments = Array.isArray(lead.attachments) ? lead.attachments : [];

  return (
    <div className={styles.page}>
      {toast && (
        <div
          className={`${styles.toast} ${toast.type === "ok" ? styles.toastOk : styles.toastErr}`}
        >
          <i className={`fas ${toast.type === "ok" ? "fa-check-circle" : "fa-exclamation-circle"}`} />
          {toast.msg}
        </div>
      )}

      {/* ── Header ───────────────────────────────────── */}
      <div className={styles.headerRow} style={{ marginBottom: 20 }}>
        <div className={styles.titleBlock}>
          <Link href="/leads" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>
            ← Leads
          </Link>
          <h1 style={{ marginTop: 8 }}>{lead.name}</h1>
          <p className={styles.sub}>
            <span
              style={{
                display: "inline-block",
                padding: "2px 10px",
                borderRadius: 5,
                background: sc.color + "22",
                color: sc.color,
                fontWeight: 700,
                fontSize: 12,
                marginRight: 8,
              }}
            >
              {sc.label}
            </span>
            {lead.source}
          </p>
        </div>

        {/* Quick actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { icon: "fa-tag",         label: "Label",    type: "label"   },
            { icon: "fa-user-plus",   label: "Assign",   type: "assign"  },
            { icon: "fa-exchange-alt",label: "Convert",  type: "convert" },
            { icon: "fa-flag",        label: "Status",   type: "status"  },
            { icon: "fa-phone-alt",   label: "Follow-up",type: "followup"},
          ].map(({ icon, label, type }) => (
            <button
              key={type}
              onClick={() => setModal({ type, lead })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#1a1a2e",
              }}
            >
              <i className={`fas ${icon}`} style={{ color: "#6366f1", fontSize: 12 }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Lead info panel ──────────────────────────── */}
      <div className={styles.panel} style={{ padding: 24, marginBottom: 20 }}>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          }}
        >
          {[
            { label: "Phone",       val: lead.phone },
            { label: "Email",       val: lead.email },
            { label: "Company",     val: lead.company_name },
            { label: "Label",       val: lead.label },
            { label: "Reference",   val: lead.reference },
            { label: "Assigned To", val: lead.assigned_name?.trim() },
            {
              label: "Follow-up Date",
              val: lead.follow_up_date
                ? new Date(lead.follow_up_date).toLocaleDateString("en-IN")
                : null,
            },
            {
              label: "Created",
              val: lead.created_at
                ? new Date(lead.created_at).toLocaleDateString("en-IN")
                : null,
            },
          ].map(({ label, val }) => (
            <div key={label}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 14, color: "#1a1a2e" }}>
                {val || "—"}
              </p>
            </div>
          ))}
        </div>

        {lead.address && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Address
            </p>
            <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{lead.address}</p>
          </div>
        )}

        {lead.notes && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Notes / Comment
            </p>
            <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{lead.notes}</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Attachments
            </p>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {attachments.map((p, i) => (
                <li key={i}>
                  <a href={publicFileUrl(p)} target="_blank" rel="noopener noreferrer">
                    {String(p).split("/").pop()}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Follow-up history ────────────────────────── */}
      <div className={styles.panel} style={{ padding: 24 }}>
        <p
          style={{
            margin: "0 0 16px",
            fontFamily: "var(--font-display)",
            fontSize: 14,
            fontWeight: 800,
            color: "var(--text)",
          }}
        >
          Follow-up History ({followups.length})
        </p>

        {followups.length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: 13 }}>No follow-ups yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {followups.map((fu) => (
              <div
                key={fu.id}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>
                    {fu.creator_email || "Unknown"}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {formatDateTime(fu.created_at)}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{fu.note}</p>
                {fu.next_follow_up_at && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
                    <i className="fas fa-calendar-alt" style={{ marginRight: 4 }} />
                    Next follow-up: {formatDateTime(fu.next_follow_up_at)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Quick modals ─────────────────────────────── */}
      <LeadQuickModals
        modal={modal}
        onClose={() => setModal(null)}
        users={users}
        statuses={STATUSES} onDone={load}
        onLeadPatch={(partial) => {
          if (partial?.id === lead.id) setLead((prev) => ({ ...prev, ...partial }));
        }}
      />
    </div>
  );
}