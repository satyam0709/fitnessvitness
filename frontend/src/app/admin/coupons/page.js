"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

/** Browser-local datetime-local → UTC `YYYY-MM-DD HH:mm:ss` for MySQL. */
function datetimeLocalToUtcMysql(dtLocal) {
  if (!dtLocal || !String(dtLocal).trim()) return null;
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

/** DB naive UTC string → value for `<input type="datetime-local" />` in user's local timezone. */
function utcMysqlToDatetimeLocal(mysqlUtc) {
  if (!mysqlUtc) return "";
  const raw = String(mysqlUtc).trim();
  const d = raw.includes("T")
    ? new Date(raw.endsWith("Z") ? raw : `${raw}Z`)
    : new Date(`${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminCouponsPage() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/admin/coupons");
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.message || "Could not load coupons");
      setCoupons(j.coupons || []);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  async function saveCoupon(e) {
    e.preventDefault();
    if (!modal) return;
    const body = {
      code: modal.code,
      discount_percent: Number(modal.discount_percent),
      description: modal.description || null,
      max_redemptions: modal.max_redemptions === "" || modal.max_redemptions == null ? null : Number(modal.max_redemptions),
      valid_from: datetimeLocalToUtcMysql(modal.valid_from),
      valid_until: datetimeLocalToUtcMysql(modal.valid_until),
      is_active: !!modal.is_active,
    };
    try {
      if (modal.id) {
        const res = await apiFetch(`/admin/coupons/${modal.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Update failed");
        showToast("Coupon updated");
      } else {
        const res = await apiFetch("/admin/coupons", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Create failed");
        showToast("Coupon created");
      }
      setModal(null);
      load();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  async function deleteCoupon(id) {
    if (!window.confirm("Delete this coupon permanently?")) return;
    try {
      const res = await apiFetch(`/admin/coupons/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.message || "Delete failed");
      showToast("Coupon deleted");
      load();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  function openNew() {
    setModal({
      id: null,
      code: "",
      discount_percent: 15,
      description: "",
      max_redemptions: "",
      valid_from: "",
      valid_until: "",
      is_active: true,
    });
  }

  function openEdit(c) {
    setModal({
      id: c.id,
      code: c.code,
      discount_percent: c.discount_percent,
      description: c.description || "",
      max_redemptions: c.max_redemptions != null ? String(c.max_redemptions) : "",
      valid_from: utcMysqlToDatetimeLocal(c.valid_from),
      valid_until: utcMysqlToDatetimeLocal(c.valid_until),
      is_active: !!c.is_active,
    });
  }

  return (
    <div>
      {toast ? (
        <div className={styles.toast} style={{ position: "relative", marginBottom: 12 }}>
          <i className="fas fa-check-circle" /> {toast}
        </div>
      ) : null}
      {error ? (
        <div
          className={styles.toast}
          style={{ position: "relative", marginBottom: 12, border: "1px solid #fecaca", color: "#b91c1c" }}
        >
          <i className="fas fa-exclamation-circle" /> {error}
        </div>
      ) : null}

      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Coupons</h2>
          <p className={styles.pageSubtitle}>
            Create discount codes (10–99% off package + add-ons before GST). Customers apply them on the cart page;
            Stripe totals are recalculated on the server.             Max redemptions and date range are optional. Start/end times use your **local** clock in the form and are
            stored in **UTC** on the server (same as Render/hosted APIs). Live sync for admins.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={openNew}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            background: "var(--yellow)",
            color: "#1a1a2e",
            border: "none",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <i className="fas fa-plus" /> New coupon
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingInline}>
          <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow)" }} /> Loading…
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Uses</th>
                <th>Valid</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code style={{ fontWeight: 700 }}>{c.code}</code>
                    <div className={styles.tableEmail}>{c.description || "—"}</div>
                  </td>
                  <td>{c.discount_percent}%</td>
                  <td>
                    {c.redemptions_used}
                    {c.max_redemptions != null ? ` / ${c.max_redemptions}` : " / ∞"}
                  </td>
                  <td className={styles.dateText}>
                    {c.valid_from
                      ? new Date(`${String(c.valid_from).replace(" ", "T")}Z`).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}{" "}
                    →{" "}
                    {c.valid_until
                      ? new Date(`${String(c.valid_until).replace(" ", "T")}Z`).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—"}
                  </td>
                  <td>
                    <span className={c.is_active ? styles.statusOn : styles.statusOff}>
                      {c.is_active ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className={styles.pageBtn} style={{ marginRight: 8 }} onClick={() => openEdit(c)}>
                      Edit
                    </button>
                    <button type="button" className={styles.pageBtn} onClick={() => deleteCoupon(c.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 400,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          role="dialog"
        >
          <form
            onSubmit={saveCoupon}
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              maxWidth: 440,
              width: "100%",
              padding: 24,
              border: "1px solid var(--border)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>{modal.id ? "Edit coupon" : "New coupon"}</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Code (letters/numbers, stored uppercase)
                <input
                  required
                  disabled={!!modal.id}
                  value={modal.code}
                  onChange={(e) => setModal({ ...modal, code: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Discount % (10–99)
                <input
                  type="number"
                  min={10}
                  max={99}
                  required
                  value={modal.discount_percent}
                  onChange={(e) => setModal({ ...modal, discount_percent: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Description (optional)
                <input
                  value={modal.description}
                  onChange={(e) => setModal({ ...modal, description: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Max redemptions (blank = unlimited)
                <input
                  type="number"
                  min={1}
                  value={modal.max_redemptions}
                  onChange={(e) => setModal({ ...modal, max_redemptions: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Valid from (optional — your local time; saved as UTC)
                <input
                  type="datetime-local"
                  value={modal.valid_from}
                  onChange={(e) => setModal({ ...modal, valid_from: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Valid until (optional — your local time; saved as UTC)
                <input
                  type="datetime-local"
                  value={modal.valid_until}
                  onChange={(e) => setModal({ ...modal, valid_until: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={modal.is_active}
                  onChange={(e) => setModal({ ...modal, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  background: "var(--yellow)",
                  border: "none",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
