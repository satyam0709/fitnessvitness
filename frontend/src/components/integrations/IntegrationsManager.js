"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import styles from "./integrationsManager.module.css";

export default function IntegrationsManager() {
  const { isLoaded, isSignedIn } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/integrations");
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const d = await res.json();
      setRows(Array.isArray(d.integrations) ? d.integrations : []);
    } catch (e) {
      setErr(e.message || "Failed to load integrations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(key) {
    setBusyKey(key);
    try {
      const res = await apiFetch(`/v2/integrations/${encodeURIComponent(key)}/toggle`, {
        method: "POST",
      });
      if (!res.ok) return;
      const d = await res.json();
      const active = !!d.is_active;
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, is_active: active ? 1 : 0 } : r)));
    } catch (e) {
      console.error(e);
    } finally {
      setBusyKey(null);
    }
  }

  if (!isLoaded) {
    return <p className={styles.hint}>Loading…</p>;
  }

  if (!isSignedIn) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Workspace integrations</h2>
        <p className={styles.hint}>
          Sign in to view and toggle lead source integrations for your workspace.{" "}
          <Link href="/sign-in" className={styles.link}>
            Sign in
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Workspace integrations</h2>
      <p className={styles.sub}>
        Enable or disable inbound lead sources. Changes apply to your CRM workspace immediately.
      </p>

      {err && <div className={styles.error}>{err}</div>}

      {loading ? (
        <p className={styles.hint}>Loading integrations…</p>
      ) : rows.length === 0 ? (
        <p className={styles.hint}>No integration records found. Run database migrations or seed data.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.key} className={styles.row}>
              <div>
                <div className={styles.name}>{row.name || row.key}</div>
                <div className={styles.key}>{row.key}</div>
              </div>
              <label className={styles.switchWrap}>
                <input
                  type="checkbox"
                  className={styles.switch}
                  checked={!!Number(row.is_active)}
                  disabled={busyKey === row.key}
                  onChange={() => toggle(row.key)}
                />
                <span className={styles.switchLabel}>{Number(row.is_active) ? "On" : "Off"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
