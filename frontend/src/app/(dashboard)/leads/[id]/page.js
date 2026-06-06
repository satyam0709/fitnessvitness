"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, publicFileUrl } from "@/lib/api";
import LeadQuickModals from "@/components/Leads/LeadQuickModals";
import LeadDetailHeader from "@/components/Leads/LeadDetailHeader";
import LeadHistoryPanel from "@/components/Leads/LeadHistoryPanel";
import LeadChangeLogModal from "@/components/Leads/LeadChangeLogModal";
import { LEGACY_STATUSES } from "@/components/Leads/leadConstants";
import styles from "../leads.module.css";

const STATUSES = LEGACY_STATUSES.map(({ key, label, color }) => ({ key, label, color }));

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  useAuth();

  const [lead, setLead] = useState(null);
  const [followups, setFollowups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [toast, setToast] = useState(null);

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

      const leadJson = await leadRes.json();
      const fuJson = await fuRes.json();
      const usersJson = await usersRes.json();

      if (!leadRes.ok || !leadJson.success) {
        setErr(leadJson.message || "Lead not found");
        setLead(null);
        return;
      }

      setLead(leadJson.data);
      setFollowups(fuJson.success ? fuJson.data || [] : []);
      if (usersJson.success && Array.isArray(usersJson.data)) {
        setUsers(usersJson.data.filter((u) => u.is_active !== 0));
      }
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleAction(type) {
    if (type === "change-log") {
      setChangeLogOpen(true);
      return;
    }
    if (lead) setModal({ type, lead });
  }

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

  const attachments = Array.isArray(lead.attachments) ? lead.attachments : [];

  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${toast.type === "ok" ? styles.toastOk : styles.toastErr}`}>
          <i className={`fas ${toast.type === "ok" ? "fa-check-circle" : "fa-exclamation-circle"}`} />
          {toast.msg}
        </div>
      )}

      <LeadDetailHeader
        lead={lead}
        onAction={handleAction}
        onEdit={() => router.push(`/leads/${id}/edit`)}
      />

      <div className={styles.panel} style={{ padding: 24, marginBottom: 20 }}>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          }}
        >
          {[
            { label: "Phone", val: lead.phone },
            { label: "Email", val: lead.email },
            { label: "Company", val: lead.company_name },
            { label: "Label", val: lead.label },
            { label: "Reference", val: lead.reference },
            { label: "Assigned To", val: lead.assigned_name?.trim() },
            { label: "Amount", val: lead.amount ? `${lead.currency || "INR"} ${lead.amount}` : null },
            { label: "Product Category", val: lead.product_category },
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
              <p style={{ margin: "4px 0 0", fontSize: 14, color: "#1a1a2e" }}>{val || "—"}</p>
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

      <LeadHistoryPanel leadId={id} initialFollowups={followups} />

      <LeadQuickModals
        modal={modal}
        onClose={() => setModal(null)}
        users={users}
        statuses={STATUSES}
        onDone={load}
        onLeadPatch={(partial) => {
          if (partial?.id === lead.id) setLead((prev) => ({ ...prev, ...partial }));
        }}
        onConvertLead={(l) => setModal({ type: "convert", lead: l })}
      />

      {changeLogOpen && (
        <LeadChangeLogModal leadId={id} onClose={() => setChangeLogOpen(false)} />
      )}
    </div>
  );
}
