"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import styles from "../../invoice/invoicePages.module.css";

const TAB_IDS = ["general", "invoice", "integrations"];

function WebSettingsBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isLoaded } = useAuth();

  const rawTab = searchParams.get("tab");
  const activeTab = TAB_IDS.includes(rawTab || "") ? rawTab : "general";

  const setTab = useCallback(
    (id) => {
      router.replace(`/settings/web?tab=${id}`, { scroll: false });
    },
    [router]
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);

  const [company_name, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [gst_number, setGstNumber] = useState("");
  const [pan_number, setPanNumber] = useState("");

  const [invoice_bank_name, setBank] = useState("");
  const [invoice_account_no, setAcc] = useState("");
  const [invoice_ifsc, setIfsc] = useState("");
  const [invoice_currency, setCur] = useState("INR");
  const [invoice_gst_mode, setGstMode] = useState("none");

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/settings/company");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load settings");
      const row = d.data;
      if (row) {
        setCompanyName(row.company_name || "");
        setWebsite(row.website || "");
        setPhone(row.phone || "");
        setEmail(row.email || "");
        setAddress(row.address || "");
        setCity(row.city || "");
        setState(row.state || "");
        setCountry(row.country || "India");
        setGstNumber(row.gst_number || "");
        setPanNumber(row.pan_number || "");
        setBank(row.invoice_bank_name || "");
        setAcc(row.invoice_account_no || "");
        setIfsc(row.invoice_ifsc || "");
        setCur(row.invoice_currency || "INR");
        setGstMode(row.invoice_gst_mode || "none");
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

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      const res = await apiFetch("/v2/settings/company", {
        method: "PUT",
        body: JSON.stringify({
          company_name: company_name.trim() || null,
          website: website.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          country: country.trim() || "India",
          gst_number: gst_number.trim() || null,
          pan_number: pan_number.trim() || null,
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
          <h1 className={styles.title}>Web settings</h1>
          <p className={styles.sub}>Company profile, invoice defaults, and integrations (same data as the CRM company API).</p>
        </div>
        <Link href="/invoice/sales/new" className={styles.btnGhost}>
          Back to add invoice
        </Link>
      </div>

      <nav className={styles.webTabs} aria-label="Settings sections">
        {[
          { id: "general", label: "General settings" },
          { id: "invoice", label: "Invoice settings" },
          { id: "integrations", label: "Integrations" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.webTab} ${activeTab === t.id ? styles.webTabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {err ? <p className={styles.err}>{err}</p> : null}
      {ok ? <p style={{ color: "#059669", fontWeight: 600 }}>Saved.</p> : null}

      {activeTab === "integrations" ? (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Integrations</h2>
          <p className={styles.sub}>Enable or disable inbound lead sources connected to your workspace.</p>
          <Link href="/settings/integrations" className={styles.btnPrimary} style={{ marginTop: 12 }}>
            Open integrations
          </Link>
        </div>
      ) : (
        <form className={styles.formGrid} onSubmit={onSave}>
          {activeTab === "general" && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>General company</h2>
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
                  <label className={styles.label}>Website</label>
                  <input className={styles.input} value={website} onChange={(e) => setWebsite(e.target.value)} />
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
                  className={styles.input}
                  style={{ minHeight: 72 }}
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
              <div className={styles.row2} style={{ marginTop: 14 }}>
                <div className={styles.field}>
                  <label className={styles.label}>Country</label>
                  <input className={styles.input} value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>GST number</label>
                  <input className={styles.input} value={gst_number} onChange={(e) => setGstNumber(e.target.value)} />
                </div>
              </div>
              <div className={styles.field} style={{ marginTop: 14 }}>
                <label className={styles.label}>PAN number</label>
                <input className={styles.input} value={pan_number} onChange={(e) => setPanNumber(e.target.value)} />
              </div>
            </div>
          )}

          {activeTab === "invoice" && (
            <>
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Company (on invoice)</h2>
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
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Payment details (shown on invoice)</h2>
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
                  <label className={styles.label}>Default GST mode (for new invoices)</label>
                  <select className={styles.select} value={invoice_gst_mode} onChange={(e) => setGstMode(e.target.value)}>
                    <option value="none">Non GST</option>
                    <option value="igst">IGST</option>
                    <option value="sgst_cgst">SGST / CGST</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <button type="submit" className={styles.btnSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function WebSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <p className={styles.sub}>Loading…</p>
        </div>
      }
    >
      <WebSettingsBody />
    </Suspense>
  );
}
