"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { PRODUCT_CATEGORIES, buildFieldOptions } from "./leadConstants";
import styles from "./LeadQuickModals.module.css";

/**
 * Convert lead → opportunity (reference flow).
 * @param {{ lead: object, onClose: () => void, onDone?: () => void }} props
 */
export default function ConvertLeadModal({ lead, onClose, onDone }) {
  const router = useRouter();
  const [amount, setAmount] = useState(lead.amount ? String(lead.amount) : "");
  const [currency, setCurrency] = useState(lead.currency || "INR");
  const [productCategory, setProductCategory] = useState(lead.product_category || "");
  const [expectedClose, setExpectedClose] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [customOptions, setCustomOptions] = useState({});

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch("/leads/custom-options");
        const json = await res.json();
        if (json.success && json.data) setCustomOptions(json.data);
      } catch {
        /* non-fatal */
      }
    }
    load();
  }, []);

  const categoryOptions = useMemo(
    () =>
      buildFieldOptions(PRODUCT_CATEGORIES, customOptions.product_category || [], {
        includeEmpty: true,
        emptyLabel: "Select category…",
      }),
    [customOptions.product_category]
  );

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const body = {
        amount: amount ? Number(amount) : 0,
        currency,
        product_category: productCategory || undefined,
        expected_close_date: expectedClose || undefined,
        notes: notes.trim() || undefined,
      };
      const res = await apiFetch(`/leads/${lead.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Conversion failed");
        return;
      }
      onDone?.();
      onClose();
      const oppId = json.opportunity_id;
      if (oppId) {
        router.push(`/opportunities?highlight=${oppId}`);
      }
    } catch (e) {
      setErr(e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal} style={{ maxWidth: 480 }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Convert to Opportunity</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.body}>
            {err ? <p className={styles.err}>{err}</p> : null}
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
              Convert <strong>{lead.name}</strong> into a sales opportunity. Use &quot;Link Client&quot; separately for fitness/customer linking.
            </p>

            <label className={styles.label}>Amount</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ flex: 1 }}
              />
              <select
                className={styles.select}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{ width: 90 }}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>

            <label className={styles.label} style={{ marginTop: 12 }}>
              Product / Service Category
            </label>
            <select
              className={styles.select}
              value={productCategory}
              onChange={(e) => setProductCategory(e.target.value)}
            >
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label className={styles.label} style={{ marginTop: 12 }}>
              Expected Close Date
            </label>
            <input
              className={styles.input}
              type="date"
              value={expectedClose}
              onChange={(e) => setExpectedClose(e.target.value)}
            />

            <label className={styles.label} style={{ marginTop: 12 }}>
              Notes (optional)
            </label>
            <textarea
              className={styles.textarea}
              placeholder="Deal notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Converting…" : "Convert to Opportunity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
