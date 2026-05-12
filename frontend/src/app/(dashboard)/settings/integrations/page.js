"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import styles from "../../invoice/invoicePages.module.css";

export default function SettingsIntegrationsPage() {
  const { isLoaded } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/integrations");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load integrations");
      setRows(d.integrations || []);
    } catch (e) {
      setErr(e.message || "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(key) {
    setBusy(key);
    setErr(null);
    try {
      const res = await apiFetch(`/v2/integrations/${encodeURIComponent(key)}/toggle`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Toggle failed");
      setRows((prev) =>
        prev.map((row) =>
          row.key === key ? { ...row, is_active: d.is_active ? 1 : 0 } : row
        )
      );
    } catch (e) {
      setErr(e.message || "Error");
    } finally {
      setBusy(null);
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className={styles.page}>
        <p className={styles.sub}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Integrations</h1>
          <p className={styles.sub}>Toggle inbound sources stored in your workspace (API: GET/POST /v2/integrations).</p>
        </div>
        <Link href="/settings/web?tab=integrations" className={styles.btnGhost}>
          Web settings
        </Link>
      </div>

      {err ? <p className={styles.err}>{err}</p> : null}

      <div className={styles.card}>
        {rows.length === 0 ? (
          <p className={styles.sub}>No integration rows returned.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li
                key={r.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border, #e2e8f0)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{r.name || r.key}</div>
                  <div className={styles.sub} style={{ fontSize: 12 }}>
                    {r.key}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  style={{ minWidth: 100 }}
                  disabled={busy === r.key}
                  onClick={() => toggle(r.key)}
                >
                  {busy === r.key ? "…" : Number(r.is_active) === 1 ? "On" : "Off"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
