"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import LeadForm from "@/components/Leads/LeadForm";
import styles from "../../leads.module.css";

export default function EditLeadPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/leads/${id}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Lead not found");
        setLead(null);
        return;
      }
      setLead(json.data);
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          Loading…
        </div>
      </div>
    );
  }

  if (err || !lead) {
    return (
      <div className={styles.page}>
        <p>{err || "Lead not found"}</p>
        <Link href="/leads">← Back to leads</Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link href={`/leads/${id}`} style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>
        ← Back to lead
      </Link>
      <h1 style={{ marginTop: 12, marginBottom: 20 }}>Edit Lead — {lead.name}</h1>
      <div className={styles.panel} style={{ padding: 0, overflow: "hidden" }}>
        <LeadForm
          mode="edit"
          lead={lead}
          onCancel={() => router.push(`/leads/${id}`)}
          onSuccess={() => router.push(`/leads/${id}`)}
        />
      </div>
    </div>
  );
}
