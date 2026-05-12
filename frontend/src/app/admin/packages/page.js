"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import styles from "../users/page.module.css";

const emptyFeature = () => ({ label: "", included: true });

export default function AdminPackagesPage() {
  useAuth();
  const { refreshNonce } = useAdminRealtime();
  const [tab, setTab] = useState("packages");
  const [packages, setPackages] = useState([]);
  const [addons, setAddons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState("");

  const [pkgModal, setPkgModal] = useState(null);
  const [addonModal, setAddonModal] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [pr, ar] = await Promise.all([apiFetch("/admin/catalog/packages"), apiFetch("/admin/catalog/addons")]);
      const pj = await pr.json().catch(() => ({}));
      const aj = await ar.json().catch(() => ({}));
      if (!pr.ok || !pj.success) throw new Error(pj.message || "Could not load packages");
      if (!ar.ok || !aj.success) throw new Error(aj.message || "Could not load add-ons");
      setPackages(pj.packages || []);
      setAddons(aj.addons || []);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll, refreshNonce]);

  async function savePackage(e) {
    e.preventDefault();
    if (!pkgModal) return;
    const body = {
      slug: pkgModal.slug,
      name: pkgModal.name,
      description: pkgModal.description || null,
      price_inr: Number(pkgModal.price_inr) || 0,
      price_usd: Number(pkgModal.price_usd) || 0,
      staff_seats: Number(pkgModal.staff_seats) || 0,
      billing_period: pkgModal.billing_period || "Year",
      features: (pkgModal.features || []).filter((f) => String(f.label || "").trim()),
      sort_order: Number(pkgModal.sort_order) || 0,
      is_active: !!pkgModal.is_active,
    };
    try {
      if (pkgModal.id) {
        const res = await apiFetch(`/admin/catalog/packages/${pkgModal.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Update failed");
        showToast("Package updated");
      } else {
        const res = await apiFetch("/admin/catalog/packages", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Create failed");
        showToast("Package created");
      }
      setPkgModal(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  async function deletePackage(id) {
    if (!window.confirm("Delete this package from the catalog? Existing orders keep their stored plan name.")) return;
    try {
      const res = await apiFetch(`/admin/catalog/packages/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.message || "Delete failed");
      showToast("Package removed");
      loadAll();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  async function saveAddon(e) {
    e.preventDefault();
    if (!addonModal) return;
    const body = {
      slug: addonModal.slug,
      name: addonModal.name,
      period_label: addonModal.period_label || null,
      price_inr: Number(addonModal.price_inr) || 0,
      price_usd: Number(addonModal.price_usd) || 0,
      icon: addonModal.icon || "fas fa-circle",
      sort_order: Number(addonModal.sort_order) || 0,
      is_active: !!addonModal.is_active,
    };
    try {
      if (addonModal.id) {
        const res = await apiFetch(`/admin/catalog/addons/${addonModal.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Update failed");
        showToast("Add-on updated");
      } else {
        const res = await apiFetch("/admin/catalog/addons", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.success) throw new Error(j.message || "Create failed");
        showToast("Add-on created");
      }
      setAddonModal(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  async function deleteAddon(id) {
    if (!window.confirm("Delete this add-on?")) return;
    try {
      const res = await apiFetch(`/admin/catalog/addons/${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.message || "Delete failed");
      showToast("Add-on removed");
      loadAll();
    } catch (err) {
      showToast(err.message || "Error");
    }
  }

  function openNewPackage() {
    setPkgModal({
      id: null,
      slug: "",
      name: "",
      description: "",
      price_inr: 0,
      price_usd: 0,
      staff_seats: 3,
      billing_period: "Year",
      features: [emptyFeature()],
      sort_order: (packages[packages.length - 1]?.sort_order || 0) + 10,
      is_active: true,
    });
  }

  function openEditPackage(p) {
    setPkgModal({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description || "",
      price_inr: p.price_inr,
      price_usd: p.price_usd,
      staff_seats: p.staff_seats,
      billing_period: p.billing_period || "Year",
      features: (p.features && p.features.length ? p.features : [emptyFeature()]).map((f) => ({
        label: f.label,
        included: !!f.included,
      })),
      sort_order: p.sort_order,
      is_active: !!p.is_active,
    });
  }

  function openNewAddon() {
    setAddonModal({
      id: null,
      slug: "",
      name: "",
      period_label: "",
      price_inr: 0,
      price_usd: 0,
      icon: "fas fa-puzzle-piece",
      sort_order: (addons[addons.length - 1]?.sort_order || 0) + 10,
      is_active: true,
    });
  }

  function openEditAddon(a) {
    setAddonModal({ ...a });
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
          style={{
            position: "relative",
            marginBottom: 12,
            border: "1px solid #fecaca",
            color: "#b91c1c",
          }}
        >
          <i className="fas fa-exclamation-circle" /> {error}
        </div>
      ) : null}

      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Packages &amp; pricing</h2>
          <p className={styles.pageSubtitle}>
            Manage subscription packages and add-ons (prices, features, display order). Storefront and Stripe checkout
            use this catalog; changes sync live for admins.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          className={tab === "packages" ? styles.pageBtn : styles.pageBtn}
          onClick={() => setTab("packages")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: `1px solid var(--border)`,
            background: tab === "packages" ? "var(--yellow-tint)" : "var(--bg-card)",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          Packages
        </button>
        <button
          type="button"
          onClick={() => setTab("addons")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: `1px solid var(--border)`,
            background: tab === "addons" ? "var(--yellow-tint)" : "var(--bg-card)",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          Add-ons
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingInline}>
          <i className="fas fa-spinner fa-spin" style={{ color: "var(--yellow)" }} /> Loading catalog…
        </div>
      ) : tab === "packages" ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={openNewPackage}
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
              <i className="fas fa-plus" /> New package
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>INR</th>
                  <th>USD</th>
                  <th>Staff</th>
                  <th>Order</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className={styles.tableName}>{p.name}</div>
                      <div className={styles.tableEmail}>{p.description || "—"}</div>
                    </td>
                    <td>
                      <code style={{ fontSize: 12 }}>{p.slug}</code>
                    </td>
                    <td>₹{Number(p.price_inr).toLocaleString()}</td>
                    <td>${Number(p.price_usd).toLocaleString()}</td>
                    <td>{p.staff_seats}</td>
                    <td>{p.sort_order}</td>
                    <td>
                      <span className={p.is_active ? styles.statusOn : styles.statusOff}>
                        {p.is_active ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        onClick={() => openEditPackage(p)}
                        style={{ marginRight: 8 }}
                      >
                        Edit
                      </button>
                      <button type="button" className={styles.pageBtn} onClick={() => deletePackage(p.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={openNewAddon}
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
              <i className="fas fa-plus" /> New add-on
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Period</th>
                  <th>INR</th>
                  <th>USD</th>
                  <th>Icon</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {addons.map((a) => (
                  <tr key={a.id}>
                    <td className={styles.tableName}>{a.name}</td>
                    <td>
                      <code style={{ fontSize: 12 }}>{a.slug}</code>
                    </td>
                    <td className={styles.dateText}>{a.period_label || "—"}</td>
                    <td>₹{Number(a.price_inr).toLocaleString()}</td>
                    <td>${Number(a.price_usd).toLocaleString()}</td>
                    <td style={{ fontSize: 11 }}>{a.icon}</td>
                    <td>
                      <span className={a.is_active ? styles.statusOn : styles.statusOff}>
                        {a.is_active ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        onClick={() => openEditAddon(a)}
                        style={{ marginRight: 8 }}
                      >
                        Edit
                      </button>
                      <button type="button" className={styles.pageBtn} onClick={() => deleteAddon(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pkgModal ? (
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
          aria-modal="true"
        >
          <form
            onSubmit={savePackage}
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              maxWidth: 560,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              padding: 24,
              border: "1px solid var(--border)",
            }}
          >
            <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>
              {pkgModal.id ? "Edit package" : "New package"}
            </h3>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Slug (trial id)</span>
                <input
                  required
                  disabled={!!pkgModal.id}
                  value={pkgModal.slug}
                  onChange={(e) => setPkgModal({ ...pkgModal, slug: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Display name</span>
                <input
                  required
                  value={pkgModal.name}
                  onChange={(e) => setPkgModal({ ...pkgModal, name: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Description</span>
                <textarea
                  value={pkgModal.description}
                  onChange={(e) => setPkgModal({ ...pkgModal, description: e.target.value })}
                  rows={2}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Price INR</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pkgModal.price_inr}
                    onChange={(e) => setPkgModal({ ...pkgModal, price_inr: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Price USD</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pkgModal.price_usd}
                    onChange={(e) => setPkgModal({ ...pkgModal, price_usd: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Staff seats</span>
                  <input
                    type="number"
                    min={0}
                    value={pkgModal.staff_seats}
                    onChange={(e) => setPkgModal({ ...pkgModal, staff_seats: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Billing label</span>
                  <input
                    value={pkgModal.billing_period}
                    onChange={(e) => setPkgModal({ ...pkgModal, billing_period: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
                <label>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Sort order</span>
                  <input
                    type="number"
                    value={pkgModal.sort_order}
                    onChange={(e) => setPkgModal({ ...pkgModal, sort_order: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={pkgModal.is_active}
                  onChange={(e) => setPkgModal({ ...pkgModal, is_active: e.target.checked })}
                />
                <span style={{ fontWeight: 600 }}>Active (visible on storefront)</span>
              </label>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Features</div>
                {(pkgModal.features || []).map((f, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input
                      placeholder="Feature label"
                      value={f.label}
                      onChange={(e) => {
                        const next = [...pkgModal.features];
                        next[idx] = { ...next[idx], label: e.target.value };
                        setPkgModal({ ...pkgModal, features: next });
                      }}
                      style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={f.included}
                        onChange={(e) => {
                          const next = [...pkgModal.features];
                          next[idx] = { ...next[idx], included: e.target.checked };
                          setPkgModal({ ...pkgModal, features: next });
                        }}
                      />
                      Incl.
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = pkgModal.features.filter((_, i) => i !== idx);
                        setPkgModal({ ...pkgModal, features: next.length ? next : [emptyFeature()] });
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPkgModal({ ...pkgModal, features: [...(pkgModal.features || []), emptyFeature()] })}
                >
                  + Add feature row
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => setPkgModal(null)}>
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

      {addonModal ? (
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
        >
          <form
            onSubmit={saveAddon}
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              maxWidth: 480,
              width: "100%",
              padding: 24,
              border: "1px solid var(--border)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>{addonModal.id ? "Edit add-on" : "New add-on"}</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Slug
                <input
                  required
                  disabled={!!addonModal.id}
                  value={addonModal.slug}
                  onChange={(e) => setAddonModal({ ...addonModal, slug: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Name
                <input
                  required
                  value={addonModal.name}
                  onChange={(e) => setAddonModal({ ...addonModal, name: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Period label
                <input
                  value={addonModal.period_label || ""}
                  onChange={(e) => setAddonModal({ ...addonModal, period_label: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  INR
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addonModal.price_inr}
                    onChange={(e) => setAddonModal({ ...addonModal, price_inr: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
                <label>
                  USD
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addonModal.price_usd}
                    onChange={(e) => setAddonModal({ ...addonModal, price_usd: e.target.value })}
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </label>
              </div>
              <label>
                Font Awesome icon class
                <input
                  value={addonModal.icon || ""}
                  onChange={(e) => setAddonModal({ ...addonModal, icon: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                Sort order
                <input
                  type="number"
                  value={addonModal.sort_order}
                  onChange={(e) => setAddonModal({ ...addonModal, sort_order: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={addonModal.is_active}
                  onChange={(e) => setAddonModal({ ...addonModal, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" className={styles.pageBtn} onClick={() => setAddonModal(null)}>
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
