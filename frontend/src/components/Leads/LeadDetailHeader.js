"use client";

import Link from "next/link";
import { formatLeadStatus } from "./leadConstants";

function leadAge(createdAt) {
  if (!createdAt) return null;
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/**
 * @param {{ lead: object, onAction: (type: string) => void, onEdit?: () => void }} props
 */
export default function LeadDetailHeader({ lead, onAction, onEdit }) {
  const sc = formatLeadStatus(lead);
  const age = leadAge(lead.created_at);

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
      <div>
        <Link href="/leads" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>
          ← Leads
        </Link>
        <h1 style={{ marginTop: 8, marginBottom: 4 }}>{lead.name}</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
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
          {age && <span style={{ marginLeft: 8 }}>· {age} old</span>}
          {lead.lead_number && <span style={{ marginLeft: 8 }}>· #{lead.lead_number}</span>}
          {lead.converted_opportunity_id && (
            <Link
              href={`/opportunities?highlight=${lead.converted_opportunity_id}`}
              style={{ marginLeft: 8, color: "#6366f1" }}
            >
              · Opportunity #{lead.converted_opportunity_id}
            </Link>
          )}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            style={actionBtnStyle}
          >
            <i className="fas fa-pen" style={{ color: "#6366f1", fontSize: 12 }} />
            Edit
          </button>
        )}
        {[
          { icon: "fa-tag", label: "Label", type: "label" },
          { icon: "fa-user-plus", label: "Assign", type: "assign" },
          { icon: "fa-exchange-alt", label: "Convert", type: "convert" },
          { icon: "fa-link", label: "Link Client", type: "link-client" },
          { icon: "fa-flag", label: "Status", type: "status" },
          { icon: "fa-phone-alt", label: "Follow-up", type: "followup" },
          { icon: "fa-copy", label: "Duplicate", type: "duplicate" },
        ].map(({ icon, label, type }) => (
          <button key={type} type="button" onClick={() => onAction(type)} style={actionBtnStyle}>
            <i className={`fas ${icon}`} style={{ color: "#6366f1", fontSize: 12 }} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const actionBtnStyle = {
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
};
