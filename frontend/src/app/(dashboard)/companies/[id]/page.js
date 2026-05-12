"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import styles from "./companyDetailPage.module.css";

const REL = ["Competitor", "Customer", "Integrator", "Other", "Partner", "Prospect", "Vendor"];

export default function CompanyDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/companies/${id}`);
      const json = await res.json().catch(() => ({}));
      setData(json?.data || null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  async function save() {
    if (!data?.account_name?.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/companies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_name: data.account_name,
          account_relationship: data.account_relationship,
          phone: data.phone,
          email: data.email,
          industry: data.industry,
          street: data.street,
          city: data.city,
          state: data.state,
          country: data.country,
          postal_code: data.postal_code,
          website: data.website,
          notes: data.notes,
        }),
      });
      if (res.ok) load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.page}>Loading company...</div>;
  if (!data) return <div className={styles.page}>Company not found.</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{data.account_name}</h1>
        <div className={styles.actions}>
          <Link className={styles.btnGhost} href="/companies">
            Back
          </Link>
          <button className={styles.btnPrimary} type="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className={styles.formGrid}>
        <label>
          Account Name
          <input value={data.account_name || ""} onChange={(e) => setData((p) => ({ ...p, account_name: e.target.value }))} />
        </label>
        <label>
          Account Relationship
          <select
            value={data.account_relationship || "Customer"}
            onChange={(e) => setData((p) => ({ ...p, account_relationship: e.target.value }))}
          >
            {REL.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone
          <input value={data.phone || ""} onChange={(e) => setData((p) => ({ ...p, phone: e.target.value }))} />
        </label>
        <label>
          Email
          <input value={data.email || ""} onChange={(e) => setData((p) => ({ ...p, email: e.target.value }))} />
        </label>
        <label>
          Industry
          <input value={data.industry || ""} onChange={(e) => setData((p) => ({ ...p, industry: e.target.value }))} />
        </label>
        <label>
          Website
          <input value={data.website || ""} onChange={(e) => setData((p) => ({ ...p, website: e.target.value }))} />
        </label>
        <label>
          Street
          <input value={data.street || ""} onChange={(e) => setData((p) => ({ ...p, street: e.target.value }))} />
        </label>
        <label>
          City
          <input value={data.city || ""} onChange={(e) => setData((p) => ({ ...p, city: e.target.value }))} />
        </label>
        <label>
          State
          <input value={data.state || ""} onChange={(e) => setData((p) => ({ ...p, state: e.target.value }))} />
        </label>
        <label>
          Country
          <input value={data.country || ""} onChange={(e) => setData((p) => ({ ...p, country: e.target.value }))} />
        </label>
        <label>
          Postal Code
          <input value={data.postal_code || ""} onChange={(e) => setData((p) => ({ ...p, postal_code: e.target.value }))} />
        </label>
        <label className={styles.full}>
          Notes
          <textarea rows={3} value={data.notes || ""} onChange={(e) => setData((p) => ({ ...p, notes: e.target.value }))} />
        </label>
      </div>

      <div className={styles.section}>
        <h2>Linked Contacts ({data.contacts?.length || 0})</h2>
        {!data.contacts?.length ? (
          <div className={styles.empty}>No linked contacts yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.contact_name}</td>
                  <td>{c.designation || "-"}</td>
                  <td>{c.department || "-"}</td>
                  <td>{c.email || "-"}</td>
                  <td>{c.phone || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.sectionActions}>
        <button type="button" className={styles.btnGhost} onClick={() => router.push(`/contacts?company=${encodeURIComponent(data.account_name)}`)}>
          Open Contacts Module
        </button>
      </div>
    </div>
  );
}
