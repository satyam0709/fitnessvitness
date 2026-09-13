"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCompanySettings } from "@/lib/invoicesApi";
import { apiFetch, getAccessToken, getApiBase } from "@/lib/api";
import styles from "../../invoice/invoicePages.module.css";

export default function InvoiceSettingsPage() {
  const { isLoaded } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);

  const [company_name, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [gst_number, setGstNumber] = useState("");
  const [invoice_bank_name, setBank] = useState("");
  const [invoice_account_no, setAcc] = useState("");
  const [invoice_ifsc, setIfsc] = useState("");
  const [invoice_currency, setCur] = useState("INR");
  const [invoice_gst_mode, setGstMode] = useState("none");
  const [invoice_start_no, setStartNo] = useState("1");
  const [logoUrl, setLogoUrl] = useState(null);
  const [signUrl, setSignUrl] = useState(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [signPreview, setSignPreview] = useState("");
  const [uploading, setUploading] = useState("");

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const { company: row } = await fetchCompanySettings();
      if (row) {
        setCompanyName(row.company_name || "");
        setPhone(row.phone || "");
        setEmail(row.email || "");
        setAddress(row.address || "");
        setCity(row.city || "");
        setState(row.state || "");
        setGstNumber(row.gst_number || "");
        setBank(row.invoice_bank_name || "");
        setAcc(row.invoice_account_no || "");
        setIfsc(row.invoice_ifsc || "");
        setCur(row.invoice_currency || "INR");
        setGstMode(row.invoice_gst_mode || "none");
        setStartNo(String(row.invoice_start_no || 1));
        setLogoUrl(row.logo_url || null);
        setSignUrl(row.signature_url || row.invoice_nongst?.signature_url || row.invoice_gst?.signature_url || null);
      }
    } catch (e) {
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  }, [isLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    async function toObj(rel) {
      if (!rel) return "";
      const base = getApiBase();
      const token = getAccessToken();
      const res = await fetch(`${base}${rel}`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return "";
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      if (!alive) {
        URL.revokeObjectURL(obj);
        return "";
      }
      return obj;
    }
    (async () => {
      const [logo, sign] = await Promise.all([toObj(logoUrl), toObj(signUrl)]);
      if (!alive) return;
      setLogoPreview(logo);
      setSignPreview(sign);
    })();
    return () => {
      alive = false;
    };
  }, [logoUrl, signUrl]);

  async function uploadAsset(kind, file) {
    if (!file) return;
    setUploading(kind);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append(kind === "logo" ? "logo" : "signature", file);
      const path = kind === "logo" ? "/v2/settings/web/logo" : "/v2/settings/web/invoice-signature";
      const res = await apiFetch(path, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Upload failed");
      setOk(true);
      setTimeout(() => setOk(false), 4000);
      await load();
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setUploading("");
    }
  }

  async function resetStart() {
    setUploading("start");
    setErr(null);
    try {
      const res = await apiFetch("/v2/settings/web/invoice-start-reset", {
        method: "POST",
        body: JSON.stringify({ start: invoice_start_no }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Reset failed");
      setOk(true);
      setTimeout(() => setOk(false), 4000);
      await load();
    } catch (e) {
      setErr(e.message || "Could not reset invoice start");
    } finally {
      setUploading("");
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      const res = await apiFetch("/v2/settings/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company_name.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          country: "India",
          gst_number: gst_number.trim() || null,
          invoice_bank_name: invoice_bank_name.trim() || null,
          invoice_account_no: invoice_account_no.trim() || null,
          invoice_ifsc: invoice_ifsc.trim().toUpperCase() || null,
          invoice_currency: invoice_currency || "INR",
          invoice_gst_mode: invoice_gst_mode || "none",
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Save failed");
      setOk(true);
      setTimeout(() => setOk(false), 4000);
      await load();
    } catch (e) {
      setErr(e.message || "Error");
    } finally {
      setSaving(false);
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
          <h1 className={styles.title}>Invoice settings</h1>
          <p className={styles.sub}>
            Company and bank details used on payment receipts and sales invoices. Saved to your workspace instantly.
          </p>
        </div>
        <Link href="/invoice/sales" className={styles.btnGhost}>
          All invoices
        </Link>
      </div>

      {err ? <p className={styles.err}>{err}</p> : null}
      {ok ? <p style={{ color: "#059669", fontWeight: 600 }}>Saved.</p> : null}

      <form className={styles.formGrid} onSubmit={onSubmit}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Company on invoice</h2>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>
                Company name <span className={styles.req}>*</span>
              </label>
              <input
                className={styles.input}
                value={company_name}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>GST number</label>
              <input className={styles.input} value={gst_number} onChange={(e) => setGstNumber(e.target.value)} />
            </div>
          </div>
          <div className={styles.row2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>Phone</label>
              <input className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input type="email" className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label}>Address</label>
            <textarea
              className={styles.textarea}
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className={styles.row2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>City</label>
              <input className={styles.input} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>State</label>
              <input className={styles.input} value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Bank details (payment receipts)</h2>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>
                Bank name <span className={styles.req}>*</span>
              </label>
              <input className={styles.input} value={invoice_bank_name} onChange={(e) => setBank(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>
                Account number <span className={styles.req}>*</span>
              </label>
              <input className={styles.input} value={invoice_account_no} onChange={(e) => setAcc(e.target.value)} required />
            </div>
          </div>
          <div className={styles.row2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>
                IFSC <span className={styles.req}>*</span>
              </label>
              <input className={styles.input} value={invoice_ifsc} onChange={(e) => setIfsc(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Default currency</label>
              <select className={styles.select} value={invoice_currency} onChange={(e) => setCur(e.target.value)}>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label}>Default GST on new invoices</label>
            <select className={styles.select} value={invoice_gst_mode} onChange={(e) => setGstMode(e.target.value)}>
              <option value="none">Non GST</option>
              <option value="igst">IGST</option>
              <option value="sgst_cgst">SGST / CGST</option>
            </select>
          </div>
        </div>

        <button type="submit" className={styles.btnSubmit} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>

      <div className={styles.card} style={{ marginTop: 20 }}>
        <h2 className={styles.cardTitle}>Branding on invoices</h2>
        <p className={styles.sub}>Logo and signature appear on printable invoices and quotations.</p>
        <div className={styles.brandGrid}>
          <div className={styles.brandSlot}>
            <span className={styles.label}>Logo</span>
            {logoPreview ? <img src={logoPreview} alt="Invoice logo" className={styles.brandImg} /> : null}
            <label className={styles.fileBtn}>
              {uploading === "logo" ? "Uploading…" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={!!uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadAsset("logo", file);
                }}
              />
            </label>
          </div>
          <div className={styles.brandSlot}>
            <span className={styles.label}>Signature</span>
            {signPreview ? <img src={signPreview} alt="Invoice signature" className={styles.brandImg} /> : null}
            <label className={styles.fileBtn}>
              {uploading === "signature" ? "Uploading…" : "Upload signature"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={!!uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadAsset("signature", file);
                }}
              />
            </label>
          </div>
        </div>
        <div className={styles.row2} style={{ marginTop: 16 }}>
          <div className={styles.field}>
            <label className={styles.label}>Next invoice start number</label>
            <input
              type="number"
              min="1"
              className={styles.input}
              value={invoice_start_no}
              onChange={(e) => setStartNo(e.target.value)}
            />
          </div>
          <div className={styles.field} style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="button" className={styles.btnGhost} disabled={uploading === "start"} onClick={resetStart}>
              {uploading === "start" ? "Saving…" : "Reset start number"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
