"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { apiFetch, getApiOrigin } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import ModalPortal from "@/components/UI/ModalPortal";
import styles from "./companiesPage.module.css";

const REL = ["Competitor", "Customer", "Integrator", "Other", "Partner", "Prospect", "Vendor"];

const EMPTY_FORM = {
  account_name: "",
  account_relationship: "Customer",
  phone: "",
  email: "",
  industry: "",
  street: "",
  city: "",
  state: "",
  country: "",
  postal_code: "",
  website: "",
  notes: "",
};

async function companiesRequest( suffix = "", options = {}) {
  const cleanSuffix = suffix.startsWith("/") || suffix.startsWith("?") ? suffix : `/${suffix}`;
  const paths = [`/companies${cleanSuffix}`, `/crm/companies${cleanSuffix}`];
  let lastRes = null;
  let lastErr = null;

  for (const p of paths) {
    try {
      const res = await apiFetch(p, options);
      lastRes = res;
      if (res.status !== 404) return res;
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr && !lastRes) throw lastErr;
  return lastRes;
}

export default function CompaniesPage() {
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [q, setQ] = useState("");
  const [relationship, setRelationship] = useState(searchParams.get("relationship") || "");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [industry, setIndustry] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [colFilters, setColFilters] = useState({
    account: "",
    relationship: "",
    phone: "",
    email: "",
    industry: "",
    street: "",
    city: "",
    state: "",
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeForm, setMergeForm] = useState({ keep_id: "", merge_id: "" });
  const [mergeSaving, setMergeSaving] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importMode, setImportMode] = useState("create_only");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const importJobIdRef = useRef(null);
  const loadRef = useRef(() => {});

  const load = useCallback(async (opts = {}) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("include_breakdown", "1");
      if (q.trim()) p.set("q", q.trim());
      if (relationship) p.set("account_relationship", relationship);
      if (city.trim()) p.set("city", city.trim());
      if (state.trim()) p.set("state", state.trim());
      if (industry.trim()) p.set("industry", industry.trim());
      if (starredOnly) p.set("starred", "1");
      const res = await companiesRequest( `?${p.toString()}`);
      if (!res) {
        showToast("Company service is temporarily unavailable", "error");
        setRows([]);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not load companies", "error");
        setRows([]);
        return;
      }
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch {
      showToast("Could not load companies", "error");
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [city, industry, q, relationship, showToast, starredOnly, state]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setInterval(() => load({ silent: true }), 20000);
    return () => clearInterval(timer);
  }, [isLoaded, load]);

  const refreshCompanyDetail = useCallback(
    async (id, silent = true) => {
      if (!id) return;
      if (!silent) setDetailLoading(true);
      try {
        const res = await companiesRequest( `/${id}`);
        if (!res) {
          if (!silent) showToast("Company service is temporarily unavailable", "error");
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          if (!silent) showToast(json.message || "Could not load company details", "error");
          return;
        }
        setDetailData(json.data || null);
      } catch {
        if (!silent) showToast("Could not load company details", "error");
      } finally {
        if (!silent) setDetailLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!isLoaded) {
      setLiveConnected(false);
      return;
    }
    let cancelled = false;
    const sockRef = { current: null };

    async function connectSocket() {
      if (cancelled) return;
      try {
        const { io } = await import("socket.io-client");
        const s = io(getApiOrigin(), {
          path: "/socket.io",
          auth: {},
          transports: ["websocket", "polling"],
          withCredentials: true,
          reconnection: true,
        });
        sockRef.current = s;
        s.on("connect", () => !cancelled && setLiveConnected(true));
        s.on("disconnect", () => !cancelled && setLiveConnected(false));
        s.on("connect_error", () => !cancelled && setLiveConnected(false));
        s.on("contacts:changed", () => {
          if (cancelled) return;
          loadRef.current?.({ silent: true });
          if (detailOpen && detailId) refreshCompanyDetail(detailId, true);
        });
        s.on("companies:import:progress", (payload) => {
          if (cancelled || !payload) return;
          if (importJobIdRef.current && payload.jobId && payload.jobId !== importJobIdRef.current) return;
          if (payload.summary) setImportResult(payload.summary);
          if (payload.status === "failed") {
            setImportError(payload.error || "Import failed");
            setImporting(false);
          } else if (payload.status === "completed") {
            setImportError("");
            setImporting(false);
            showToast("Company import completed");
            loadRef.current?.({ silent: true });
            if (detailOpen && detailId) refreshCompanyDetail(detailId, true);
          }
        });
      } catch {
        if (!cancelled) setLiveConnected(false);
      }
    }

    connectSocket();
    return () => {
      cancelled = true;
      setLiveConnected(false);
      if (sockRef.current) {
        try {
          sockRef.current.removeAllListeners();
          sockRef.current.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }, [isLoaded, showToast, detailOpen, detailId, refreshCompanyDetail]);

  const relCounts = useMemo(() => {
    const out = { all: rows.length };
    REL.forEach((r) => {
      out[r] = 0;
    });
    rows.forEach((r) => {
      if (out[r.account_relationship] != null) out[r.account_relationship] += 1;
    });
    return out;
  }, [rows]);
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (colFilters.account && !String(r.account_name || "").toLowerCase().includes(colFilters.account.toLowerCase()))
        return false;
      if (
        colFilters.relationship &&
        !String(r.account_relationship || "").toLowerCase().includes(colFilters.relationship.toLowerCase())
      )
        return false;
      if (colFilters.phone && !String(r.phone || "").toLowerCase().includes(colFilters.phone.toLowerCase())) return false;
      if (colFilters.email && !String(r.email || "").toLowerCase().includes(colFilters.email.toLowerCase())) return false;
      if (colFilters.industry && !String(r.industry || "").toLowerCase().includes(colFilters.industry.toLowerCase()))
        return false;
      if (colFilters.street && !String(r.street || "").toLowerCase().includes(colFilters.street.toLowerCase())) return false;
      if (colFilters.city && !String(r.city || "").toLowerCase().includes(colFilters.city.toLowerCase())) return false;
      if (colFilters.state && !String(r.state || "").toLowerCase().includes(colFilters.state.toLowerCase())) return false;
      return true;
    });
  }, [colFilters, rows]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      account_name: item.account_name || "",
      account_relationship: item.account_relationship || "Customer",
      phone: item.phone || "",
      email: item.email || "",
      industry: item.industry || "",
      street: item.street || "",
      city: item.city || "",
      state: item.state || "",
      country: item.country || "",
      postal_code: item.postal_code || "",
      website: item.website || "",
      notes: item.notes || "",
    });
    setCreateOpen(true);
  }

  async function saveCompany(e) {
    e.preventDefault();
    if (!form.account_name.trim()) {
      showToast("Account name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const method = editing ? "PUT" : "POST";
      const endpoint = editing ? `/${editing.id}` : "";
      const res = await companiesRequest( endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, account_name: form.account_name.trim() }),
      });
      if (!res) {
        showToast("Company service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || `Could not ${editing ? "update" : "create"} company`, "error");
        return;
      }
      setForm(EMPTY_FORM);
      setEditing(null);
      setCreateOpen(false);
      showToast(editing ? "Company updated" : "Company created");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function removeCompany(item) {
    const msg = buildDeleteMessage({
      singular: "company",
      name: item?.account_name?.trim() || null,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await companiesRequest( `/${item.id}`, { method: "DELETE" });
      if (!res) {
        showToast("Company service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not delete company", "error");
        return;
      }
      showToast("Company deleted");
      load();
    } catch {
      showToast("Could not delete company", "error");
    }
  }

  async function toggleStar(id, current) {
    try {
      const res = await companiesRequest( `/${id}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !current }),
      });
      if (!res) {
        showToast("Company service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update starred state", "error");
        return;
      }
      showToast(current ? "Removed from starred" : "Added to starred");
      load();
    } catch {
      showToast("Could not update starred state", "error");
    }
  }

  async function openDetail(item) {
    setDetailOpen(true);
    setDetailId(item.id);
    setDetailData(null);
    await refreshCompanyDetail(item.id, false);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function closeImportModal() {
    setImportOpen(false);
  }

  function closeMergeModal() {
    setMergeOpen(false);
  }

  function closeDetailModal() {
    setDetailOpen(false);
    setDetailId(null);
    setDetailData(null);
  }

  function openImport() {
    setImportFile(null);
    setImportMode("create_only");
    setImportResult(null);
    setImportError("");
    importJobIdRef.current = null;
    setImportOpen(true);
  }

  function openMerge() {
    setMergeForm({ keep_id: "", merge_id: "" });
    setMergeOpen(true);
  }

  async function mergeCompanies(e) {
    e.preventDefault();
    const keepId = Number(mergeForm.keep_id);
    const mergeId = Number(mergeForm.merge_id);
    if (!keepId || !mergeId || keepId === mergeId) {
      showToast("Select valid and different companies for merge", "error");
      return;
    }
    setMergeSaving(true);
    try {
      const res = await companiesRequest( "/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
      });
      if (!res) throw new Error("Company service is temporarily unavailable");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Could not merge companies");
      showToast("Companies merged successfully");
      setMergeOpen(false);
      load();
    } catch (err) {
      showToast(err.message || "Could not merge companies", "error");
    } finally {
      setMergeSaving(false);
    }
  }

  async function importCompanies(e) {
    e.preventDefault();
    if (!importFile) {
      showToast("Please choose a CSV file", "error");
      return;
    }
    setImporting(true);
    setImportError("");
    const jobId = `companies-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    importJobIdRef.current = jobId;
    setImportResult({ total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: [] });
    let keepImporting = false;
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("mode", importMode);
      fd.append("job_id", jobId);
      const res = await companiesRequest( "/import", { method: "POST", body: fd });
      if (!res) throw new Error("Company service is temporarily unavailable");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Import failed");
      setImportResult(json.summary || null);
      setImportError("");
      if (json.accepted) {
        keepImporting = true;
        showToast("Company import started. Live progress is running.");
      } else {
        setImporting(false);
        showToast("Company import completed");
        load();
      }
    } catch (err) {
      setImportError(err.message || "Import failed");
      setImporting(false);
      showToast(err.message || "Import failed", "error");
    } finally {
      if (!keepImporting) setImporting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Companies</h1>
        <div className={styles.headerActions}>
          <span className={styles.liveMeta}>
            <span className={`${styles.liveDot} ${liveConnected ? "" : styles.liveDotOff}`} />
            {liveConnected ? "Live" : "Offline"}
          </span>
          <button className={styles.btnGhost} type="button" onClick={openImport}>
            <i className="fas fa-file-import" /> Import
          </button>
          <button className={styles.btnGhost} type="button" onClick={openMerge}>
            <i className="fas fa-code-branch" /> Merge
          </button>
          <button className={styles.btnPrimary} type="button" onClick={openCreate}>
            <i className="fas fa-plus" /> Create
          </button>
        </div>
      </div>

      <div className={styles.relStrip}>
        <button
          type="button"
          className={`${styles.relCard} ${!relationship ? styles.relCardActive : ""}`}
          onClick={() => setRelationship("")}
        >
          <span>All [Account Relationship]</span>
          <strong>{relCounts.all || 0}</strong>
        </button>
        {REL.map((r) => (
          <button
            key={r}
            type="button"
            className={`${styles.relCard} ${relationship === r ? styles.relCardActive : ""}`}
            onClick={() => setRelationship((prev) => (prev === r ? "" : r))}
          >
            <span>{r}</span>
            <strong>{relCounts[r] || 0}</strong>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account/phone/email" />
        <input className={styles.input} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry" />
        <input className={styles.input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
        <input className={styles.input} value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
        <button className={styles.btnGhost} type="button" onClick={load}>
          Search
        </button>
        <button
          className={styles.btnGhost}
          type="button"
          onClick={() => {
            setQ("");
            setIndustry("");
            setCity("");
            setState("");
            setRelationship("");
            setStarredOnly(false);
          }}
        >
          Clear
        </button>
        <button
          className={`${styles.btnGhost} ${starredOnly ? styles.btnStarActive : ""}`}
          type="button"
          onClick={() => setStarredOnly((v) => !v)}
        >
          <i className="fas fa-star" /> Starred
        </button>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>Loading companies...</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.empty}>No companies found.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                <th>Account Name</th>
                <th>Account Relationship</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Industry</th>
                <th>Street</th>
                <th>City</th>
                <th>State</th>
                <th>Contacts</th>
                <th />
              </tr>
              <tr className={styles.filterRow}>
                <th />
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.account}
                    onChange={(e) => setColFilters((p) => ({ ...p, account: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.relationship}
                    onChange={(e) => setColFilters((p) => ({ ...p, relationship: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.phone}
                    onChange={(e) => setColFilters((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.email}
                    onChange={(e) => setColFilters((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.industry}
                    onChange={(e) => setColFilters((p) => ({ ...p, industry: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.street}
                    onChange={(e) => setColFilters((p) => ({ ...p, street: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.city}
                    onChange={(e) => setColFilters((p) => ({ ...p, city: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.state}
                    onChange={(e) => setColFilters((p) => ({ ...p, state: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${r.is_starred ? styles.iconBtnStarred : ""}`}
                      onClick={() => toggleStar(r.id, !!r.is_starred)}
                      title="Toggle favorite"
                    >
                      <i className="fas fa-star" />
                    </button>
                  </td>
                  <td>
                    <button type="button" className={styles.linkBtn} onClick={() => openDetail(r)}>
                      {r.account_name}
                    </button>
                  </td>
                  <td>{r.account_relationship || "-"}</td>
                  <td>{r.phone || "-"}</td>
                  <td>{r.email || "-"}</td>
                  <td>{r.industry || "-"}</td>
                  <td>{r.street || "-"}</td>
                  <td>{r.city || "-"}</td>
                  <td>{r.state || "-"}</td>
                  <td>{r.contacts_count || 0}</td>
                  <td>
                    <div className={styles.actionIcons}>
                      <button type="button" className={styles.iconBtn} onClick={() => openDetail(r)} title="View details">
                        <i className="fas fa-eye" />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => openEdit(r)} title="Edit">
                        <i className="fas fa-pen" />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => removeCompany(r)} title="Delete">
                        <i className="fas fa-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModalPortal open={createOpen} onClose={closeCreateModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>{editing ? "Edit Company" : "Add Company"}</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeCreateModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={saveCompany} className={styles.formGrid}>
              <label>
                Account Name *
                <input
                  required
                  value={form.account_name}
                  onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                />
              </label>
              <label>
                Account Relationship
                <select
                  value={form.account_relationship}
                  onChange={(e) => setForm((f) => ({ ...f, account_relationship: e.target.value }))}
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
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label>
                Industry
                <input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
              </label>
              <label>
                Website
                <input value={form.website || ""} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </label>
              <label className={styles.full}>
                Street
                <input value={form.street} onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))} />
              </label>
              <label>
                City
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </label>
              <label>
                State
                <input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </label>
              <label>
                Country
                <input value={form.country || ""} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
              </label>
              <label>
                Postal Code
                <input
                  value={form.postal_code || ""}
                  onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                />
              </label>
              <label className={styles.full}>
                Notes
                <textarea rows={3} value={form.notes || ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeCreateModal}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={saving}>
                  {saving ? "Saving..." : editing ? "Update Company" : "Create Company"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal open={importOpen} onClose={closeImportModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>Import Companies</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeImportModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={importCompanies} className={styles.formGrid}>
              <label className={styles.full}>
                CSV File
                <input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
              </label>
              <label className={styles.full}>
                Import Mode
                <select value={importMode} onChange={(e) => setImportMode(e.target.value)}>
                  <option value="create_only">Create new records only</option>
                  <option value="update_only">Update existing records only</option>
                  <option value="upsert">Create new + update existing</option>
                </select>
              </label>
              <div className={styles.infoBox}>
                CSV headers supported: account_name, account_relationship, phone, email, industry, street, city, state,
                country, postal_code, website, notes
              </div>
              <div className={styles.importMeta}>
                <span className={`${styles.liveDot} ${liveConnected ? "" : styles.liveDotOff}`} />
                Backend realtime: {liveConnected ? "Connected" : "Disconnected"}
              </div>
              {importResult ? (
                <div className={styles.importSummary}>
                  <div>Total: {importResult.total}</div>
                  <div>Processed: {importResult.processed ?? importResult.total}</div>
                  <div>Created: {importResult.created}</div>
                  <div>Updated: {importResult.updated}</div>
                  <div>Skipped: {importResult.skipped}</div>
                </div>
              ) : null}
              {importResult?.errors?.length ? (
                <div className={styles.errorBox}>
                  {importResult.errors.slice(0, 5).map((msg, idx) => (
                    <div key={`${idx}-${msg}`}>{msg}</div>
                  ))}
                </div>
              ) : null}
              {importError ? <div className={styles.errorBox}>{importError}</div> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeImportModal}>
                  Close
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={importing}>
                  {importing ? "Importing..." : "Start Import"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal open={mergeOpen} onClose={closeMergeModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>Merge Companies</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeMergeModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={mergeCompanies} className={styles.formGrid}>
              <label className={styles.full}>
                To Keep
                <select value={mergeForm.keep_id} onChange={(e) => setMergeForm((p) => ({ ...p, keep_id: e.target.value }))}>
                  <option value="">Select company</option>
                  {rows.map((it) => (
                    <option key={`k-${it.id}`} value={it.id}>
                      {it.account_name} {it.email ? `(${it.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.full}>
                To Merge (will be deleted after merge)
                <select value={mergeForm.merge_id} onChange={(e) => setMergeForm((p) => ({ ...p, merge_id: e.target.value }))}>
                  <option value="">Select company</option>
                  {rows.map((it) => (
                    <option key={`m-${it.id}`} value={it.id}>
                      {it.account_name} {it.email ? `(${it.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.infoBox}>
                Keep company remains. Merge company data is merged into keep and merge company is deleted.
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeMergeModal}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={mergeSaving}>
                  {mergeSaving ? "Merging..." : "Merge Companies"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal open={detailOpen} onClose={closeDetailModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>{detailData?.account_name || "Company Details"}</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeDetailModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <div className={styles.detailBody}>
              {detailLoading ? (
                <div className={styles.empty}>Loading company details...</div>
              ) : !detailData ? (
                <div className={styles.empty}>Company not found.</div>
              ) : (
                <>
                  <div className={styles.detailGrid}>
                    <label>
                      Account Name
                      <input value={detailData.account_name || ""} readOnly />
                    </label>
                    <label>
                      Account Relationship
                      <input value={detailData.account_relationship || ""} readOnly />
                    </label>
                    <label>
                      Phone
                      <input value={detailData.phone || ""} readOnly />
                    </label>
                    <label>
                      Email
                      <input value={detailData.email || ""} readOnly />
                    </label>
                    <label>
                      Industry
                      <input value={detailData.industry || ""} readOnly />
                    </label>
                    <label>
                      Website
                      <input value={detailData.website || ""} readOnly />
                    </label>
                    <label className={styles.full}>
                      Street
                      <input value={detailData.street || ""} readOnly />
                    </label>
                    <label>
                      City
                      <input value={detailData.city || ""} readOnly />
                    </label>
                    <label>
                      State
                      <input value={detailData.state || ""} readOnly />
                    </label>
                    <label>
                      Country
                      <input value={detailData.country || ""} readOnly />
                    </label>
                    <label>
                      Postal Code
                      <input value={detailData.postal_code || ""} readOnly />
                    </label>
                    <label className={styles.full}>
                      Notes
                      <textarea rows={3} value={detailData.notes || ""} readOnly />
                    </label>
                  </div>

                  <div className={styles.detailSection}>
                    <h3>Linked Contacts ({detailData.contacts?.length || 0})</h3>
                    {!detailData.contacts?.length ? (
                      <div className={styles.empty}>No linked contacts yet.</div>
                    ) : (
                      <table className={styles.detailTable}>
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
                          {detailData.contacts.map((c) => (
                            <tr key={c.id}>
                              <td>{c.contact_name || "-"}</td>
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
                </>
              )}
              <div className={styles.modalActions}>
                {detailData?.account_name ? (
                  <Link
                    href={`/contacts?company=${encodeURIComponent(detailData.account_name)}`}
                    className={styles.btnGhost}
                    onClick={closeDetailModal}
                  >
                    Open Contacts Module
                  </Link>
                ) : null}
                <button type="button" className={styles.btnPrimary} onClick={closeDetailModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  );
}
