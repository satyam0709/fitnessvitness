"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, getApiOrigin } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import ModalPortal from "@/components/UI/ModalPortal";
import styles from "./contactsPage.module.css";

const RELATIONSHIP_OPTIONS = [
  "Customer",
  "Competitor", 
  "Integrator",
  "Other",
  "Partner",
  "Prospect",
  "Vendor",
];

const FORM_EMPTY = {
  company_name: "",
  company_id: "",
  company_pick_search: "",
  contact_name: "",
  designation: "",
  account_relationship: "Customer",
  department: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  state: "",
  country: "",
  postal_code: "",
  website: "",
  notes: "",
};

const COMPANY_COPY_FIELDS = [
  "account_relationship",
  "phone",
  "email",
  "street",
  "city",
  "state",
  "country",
  "postal_code",
  "website",
  "notes",
];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

export default function ContactsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const q = useDebounced(searchInput, 300);

  const [selectedDesignation, setSelectedDesignation] = useState("");
  const [companyFilter, setCompanyFilter] = useState(searchParams.get("company") || "");
  const [relationshipFilter, setRelationshipFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formDirty, setFormDirty] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState(FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [mergeForm, setMergeForm] = useState({ keep_id: "", merge_id: "" });
  const [mergeSaving, setMergeSaving] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importMode, setImportMode] = useState("create_only");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);
  const [companyPicklist, setCompanyPicklist] = useState([]);
  const importJobIdRef = useRef(null);
  const loadRef = useRef(() => {});

  const companyPickQ = useDebounced(form.company_pick_search, 350);

  const setField = (key, value) => {
    setFormDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const applyContactToForm = useCallback((item) => {
    setForm({
      company_name: item.company_name || "",
      company_id: item.company_id ? String(item.company_id) : "",
      company_pick_search: "",
      contact_name: item.contact_name || "",
      designation: item.designation || "",
      account_relationship: item.account_relationship || "Customer",
      department: item.department || "",
      email: item.email || "",
      phone: item.phone || "",
      street: item.street || "",
      city: item.city || "",
      state: item.state || "",
      country: item.country || "",
      postal_code: item.postal_code || "",
      website: item.website || "",
      notes: item.notes || "",
    });
  }, []);

  const fetchCompanyDirectory = useCallback(
    async (query = "") => {
      if (!isLoaded) return;
      try {
        const p = new URLSearchParams();
        if (String(query || "").trim()) p.set("q", String(query).trim());
        const res = await apiFetch(`/companies?${p.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success && Array.isArray(json.data)) {
          setCompanyPicklist(json.data.slice(0, 80));
        } else {
          setCompanyPicklist([]);
        }
      } catch {
        setCompanyPicklist([]);
      }
    },
    [isLoaded]
  );

  const applyCompanyToContactForm = useCallback((companyRow) => {
    if (!companyRow) return;
    setFormDirty(true);
    setForm((prev) => {
      const next = { ...prev };
      next.company_id = String(companyRow.id || "");
      next.company_name = companyRow.account_name || prev.company_name;
      COMPANY_COPY_FIELDS.forEach((field) => {
        const source = companyRow[field];
        if (source != null && String(source).trim() !== "") next[field] = String(source);
      });
      if (companyRow.industry && !String(prev.department || "").trim()) {
        next.department = String(companyRow.industry);
      }
      return next;
    });
  }, []);

  const load = useCallback(async (opts = {}) => {
    const silent = Boolean(opts?.silent);
    if (!isLoaded) return;
    if (!silent) setLoading(true);
    setErr("");
    try {
      const p = new URLSearchParams();
      p.set("include_breakdown", "1");
      if (q.trim()) p.set("q", q.trim());
      if (selectedDesignation) p.set("designation", selectedDesignation);
      if (companyFilter) p.set("company_name", companyFilter);
      if (relationshipFilter) p.set("account_relationship", relationshipFilter);
      if (departmentFilter) p.set("department", departmentFilter);

      const res = await apiFetch(`/contacts?${p.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load contacts");
      }
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setItems([]);
      setErr(e.message || "Failed to load contacts");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isLoaded, q, selectedDesignation, companyFilter, relationshipFilter, departmentFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen || !isLoaded) return undefined;
    let cancelled = false;
    (async () => {
      await fetchCompanyDirectory(companyPickQ);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, companyPickQ, isLoaded, fetchCompanyDirectory]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const refreshContactDetail = useCallback(
    async (id, options = {}) => {
      const { silent = true, applyToEdit = false } = options;
      if (!id || !isLoaded) return;
      if (!silent) setDetailLoading(true);
      try {
        const res = await apiFetch(`/contacts/${id}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !json.data) {
          if (!silent) showToast(json.message || "Could not load contact details", "error");
          return;
        }
        const row = json.data;
        if (detailOpen && Number(detailId) === Number(id)) setDetailData(row);
        if (applyToEdit && editing?.id === row.id) {
          setEditing(row);
          if (!formDirty && !saving) applyContactToForm(row);
        }
      } catch {
        if (!silent) showToast("Could not load contact details", "error");
      } finally {
        if (!silent) setDetailLoading(false);
      }
    },
    [applyContactToForm, detailId, detailOpen, editing, formDirty, isLoaded, saving, showToast]
  );

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setInterval(() => {
      load({ silent: true });
    }, 20000);
    return () => clearInterval(timer);
  }, [isLoaded, load]);

  useEffect(() => {
    if (!isLoaded) {
      setLiveConnected(false);
      return;
    }

    let cancelled = false;
    const sockRef = { current: null };

    async function connectSocket() {
      if (!isSignedIn || cancelled) return;

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

        s.io.on("reconnect_attempt", async () => {
          /* session cookie sent with withCredentials */
        });

        s.on("connect", () => {
          if (!cancelled) setLiveConnected(true);
        });
        s.on("disconnect", () => {
          if (!cancelled) setLiveConnected(false);
        });
        s.on("connect_error", () => {
          if (!cancelled) setLiveConnected(false);
        });

        s.on("contacts:changed", (payload) => {
          if (cancelled) return;
          loadRef.current?.({ silent: true });
          const reason = String(payload?.reason || "");
          if (modalOpen && reason.startsWith("companies:")) {
            void fetchCompanyDirectory(companyPickQ);
          }
          if (detailOpen && detailId) refreshContactDetail(detailId, { silent: true, applyToEdit: false });
          if (modalOpen && editing?.id) refreshContactDetail(editing.id, { silent: true, applyToEdit: true });
        });

        s.on("contacts:import:progress", (payload) => {
          if (cancelled || !payload) return;
          if (importJobIdRef.current && payload.jobId && payload.jobId !== importJobIdRef.current) return;
          if (payload.summary) setImportResult(payload.summary);
          if (payload.status === "failed") {
            setImportError(payload.error || "Import failed");
            setImporting(false);
          } else if (payload.status === "completed") {
            setImportError("");
            setImporting(false);
            showToast("Import completed");
            loadRef.current?.({ silent: true });
            if (detailOpen && detailId) refreshContactDetail(detailId, { silent: true, applyToEdit: false });
            if (modalOpen && editing?.id) refreshContactDetail(editing.id, { silent: true, applyToEdit: true });
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
  }, [isLoaded, isSignedIn, showToast, detailOpen, detailId, modalOpen, editing, refreshContactDetail, fetchCompanyDirectory, companyPickQ]);

  const companyOptions = useMemo(() => {
    const s = new Set();
    items.forEach((it) => {
      if (it.company_name && String(it.company_name).trim()) s.add(String(it.company_name).trim());
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const departmentOptions = useMemo(() => {
    const s = new Set();
    items.forEach((it) => {
      if (it.department && String(it.department).trim()) s.add(String(it.department).trim());
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const designationBuckets = useMemo(() => {
    const map = new Map();
    map.set("All", 0);
    items.forEach((it) => {
      const key = String(it.designation || "Other").trim() || "Other";
      map.set(key, (map.get(key) || 0) + 1);
      map.set("All", (map.get("All") || 0) + 1);
    });
    return [...map.entries()].map(([key, count]) => ({ key, count }));
  }, [items]);

  function resetFilters() {
    setSearchInput("");
    setSelectedDesignation("");
    setCompanyFilter("");
    setRelationshipFilter("");
    setDepartmentFilter("");
  }

  function openCreate() {
    setEditing(null);
    setForm(FORM_EMPTY);
    setFormDirty(false);
    setModalOpen(true);
  }

  function openMerge() {
    setMergeForm({ keep_id: "", merge_id: "" });
    setMergeOpen(true);
  }

  function openImport() {
    setImportFile(null);
    setImportMode("create_only");
    setImportResult(null);
    setImportError("");
    importJobIdRef.current = null;
    setImportOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    applyContactToForm(item);
    setFormDirty(false);
    setModalOpen(true);
    void refreshContactDetail(item.id, { silent: true, applyToEdit: true });
  }

  async function openDetail(item) {
    setDetailOpen(true);
    setDetailId(item.id);
    setDetailData(null);
    await refreshContactDetail(item.id, { silent: false, applyToEdit: false });
  }

  function closeContactModal() {
    setModalOpen(false);
    setFormDirty(false);
  }

  function closeContactDetailModal() {
    setDetailOpen(false);
    setDetailId(null);
    setDetailData(null);
  }

  function closeMergeModal() {
    setMergeOpen(false);
  }

  function closeImportModal() {
    setImportOpen(false);
  }

  async function saveContact(e) {
    e.preventDefault();
    if (!form.contact_name.trim()) {
      showToast("Contact name is required", "error");
      return;
    }
    if (!form.company_id && !form.company_name.trim()) {
      showToast("Select a company or enter a company name", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form)
          .filter(([k]) => k !== "company_pick_search")
          .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
      );
      if (payload.company_id) {
        payload.company_id = Number(payload.company_id) || null;
      } else {
        delete payload.company_id;
      }

      const res = await apiFetch(editing ? `/contacts/${editing.id}` : "/contacts", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Could not save contact");
      }

      setModalOpen(false);
      setEditing(null);
      setForm(FORM_EMPTY);
      setFormDirty(false);
      showToast(editing ? "Contact updated successfully" : "Contact added successfully");
      load();
    } catch (e2) {
      showToast(e2.message || "Could not save contact", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeContact(item) {
    const msg = buildDeleteMessage({
      singular: "contact",
      name: `${item.contact_name} (${item.company_name})`,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;

    try {
      const res = await apiFetch(`/contacts/${item.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Could not delete");
      }
      showToast("Contact deleted successfully");
      load();
    } catch (e) {
      showToast(e.message || "Could not delete", "error");
    }
  }

  async function mergeContacts(e) {
    e.preventDefault();
    const keepId = Number(mergeForm.keep_id);
    const mergeId = Number(mergeForm.merge_id);
    if (!keepId || !mergeId || keepId === mergeId) {
      showToast("Select valid and different contacts for merge", "error");
      return;
    }
    setMergeSaving(true);
    try {
      const res = await apiFetch("/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Could not merge contacts");
      showToast("Contacts merged successfully");
      setMergeOpen(false);
      load();
    } catch (e2) {
      showToast(e2.message || "Could not merge contacts", "error");
    } finally {
      setMergeSaving(false);
    }
  }

  async function importContacts(e) {
    e.preventDefault();
    if (!importFile) {
      showToast("Please choose a CSV file", "error");
      return;
    }
    setImporting(true);
    setImportError("");
    const jobId = `contacts-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    importJobIdRef.current = jobId;
    setImportResult({ total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: [] });
    let keepImporting = false;
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("mode", importMode);
      fd.append("job_id", jobId);
      const res = await apiFetch("/contacts/import", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Import failed");
      setImportResult(json.summary || null);
      setImportError("");
      if (json.accepted) {
        keepImporting = true;
        showToast("Import started. Live progress is running.");
      } else {
        setImporting(false);
        showToast("Import completed");
        load();
      }
    } catch (e2) {
      setImportError(e2.message || "Import failed");
      setImporting(false);
      showToast(e2.message || "Import failed", "error");
    } finally {
      if (!keepImporting) setImporting(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!selectedDesignation) return items;
    return items.filter((it) => normalizeText(it.designation || "Other") === normalizeText(selectedDesignation));
  }, [items, selectedDesignation]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Contacts</h1>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.btnGhost} onClick={resetFilters}>
            Clear Filters
          </button>
          <button type="button" className={styles.btnGhost} onClick={openMerge}>
            <i className="fas fa-code-branch" /> Merge
          </button>
          <button type="button" className={styles.btnGhost} onClick={openImport}>
            <i className="fas fa-file-import" /> Import
          </button>
          <button type="button" className={styles.btnPrimary} onClick={openCreate}>
            <i className="fas fa-plus" /> Create
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          placeholder="Search contact, company, email, phone..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select className={styles.select} value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">All Companies</option>
          {companyOptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={relationshipFilter}
          onChange={(e) => setRelationshipFilter(e.target.value)}
        >
          <option value="">All Relationships</option>
          {RELATIONSHIP_OPTIONS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
        >
          <option value="">All Departments</option>
          {departmentOptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.bucketStrip}>
        {designationBuckets.map((b) => {
          const active = (b.key === "All" && !selectedDesignation) || selectedDesignation === b.key;
          return (
            <button
              key={b.key}
              type="button"
              className={`${styles.bucket} ${active ? styles.bucketActive : ""}`}
              onClick={() => setSelectedDesignation(b.key === "All" ? "" : b.key)}
            >
              <span>{b.key}</span>
              <strong>{b.count}</strong>
            </button>
          );
        })}
      </div>

      {err ? (
        <div className={styles.errorBox}>
          {err}{" "}
          <button type="button" className={styles.btnGhost} onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>Loading contacts...</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.empty}>No contacts found for selected filters.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contact Name</th>
                <th>Designation</th>
                <th>Company</th>
                <th>Relationship</th>
                <th>Department</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Street</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.contact_name || "—"}</td>
                  <td>{row.designation || "—"}</td>
                  <td>{row.company_linked_name || row.company_name || "—"}</td>
                  <td>{row.account_relationship || "—"}</td>
                  <td>{row.department || "—"}</td>
                  <td>{row.email || "—"}</td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.street || "—"}</td>
                  <td className={styles.actions}>
                    <button type="button" className={styles.btnSmall} onClick={() => openDetail(row)}>
                      View
                    </button>
                    <button type="button" className={styles.btnSmall} onClick={() => openEdit(row)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles.btnSmall} ${styles.btnDanger}`}
                      onClick={() => removeContact(row)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModalPortal open={modalOpen} onClose={closeContactModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>{editing ? "Edit Contact" : "Add Contact"}</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeContactModal}>
                <i className="fas fa-times" />
              </button>
            </div>

            <form onSubmit={saveContact} className={styles.formGrid}>
              <label>
                Company directory
                <input
                  placeholder="Search companies…"
                  value={form.company_pick_search}
                  onChange={(e) => setField("company_pick_search", e.target.value)}
                />
              </label>
              <label>
                Linked company
                <select
                  value={form.company_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const row = companyPicklist.find((c) => String(c.id) === String(id));
                    if (!id) {
                      setFormDirty(true);
                      setForm((prev) => ({ ...prev, company_id: "" }));
                      return;
                    }
                    if (row) {
                      applyCompanyToContactForm(row);
                    } else {
                      setFormDirty(true);
                      setForm((prev) => ({ ...prev, company_id: id }));
                    }
                  }}
                >
                  <option value="">— none (use name below) —</option>
                  {companyPicklist.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.account_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Company name (if not linked)
                <input
                  value={form.company_name}
                  onChange={(e) => setField("company_name", e.target.value)}
                  disabled={Boolean(form.company_id)}
                />
              </label>
              <label>
                Contact Name *
                <input value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} />
              </label>
              <label>
                Designation
                <input value={form.designation} onChange={(e) => setField("designation", e.target.value)} />
              </label>
              <label>
                Account Relationship
                <select
                  value={form.account_relationship}
                  onChange={(e) => setField("account_relationship", e.target.value)}
                >
                  {RELATIONSHIP_OPTIONS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Department
                <input value={form.department} onChange={(e) => setField("department", e.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </label>
              <label>
                Website
                <input value={form.website} onChange={(e) => setField("website", e.target.value)} />
              </label>
              <label className={styles.full}>
                Street
                <input value={form.street} onChange={(e) => setField("street", e.target.value)} />
              </label>
              <label>
                City
                <input value={form.city} onChange={(e) => setField("city", e.target.value)} />
              </label>
              <label>
                State
                <input value={form.state} onChange={(e) => setField("state", e.target.value)} />
              </label>
              <label>
                Country
                <input value={form.country} onChange={(e) => setField("country", e.target.value)} />
              </label>
              <label>
                Postal Code
                <input value={form.postal_code} onChange={(e) => setField("postal_code", e.target.value)} />
              </label>
              <label className={styles.full}>
                Notes
                <textarea rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </label>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeContactModal}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={saving}>
                  {saving ? "Saving..." : editing ? "Update Contact" : "Create Contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal open={detailOpen} onClose={closeContactDetailModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>{detailData?.contact_name || "Contact Details"}</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeContactDetailModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <div className={styles.formGrid}>
              {detailLoading ? (
                <div className={styles.full}>Loading contact details...</div>
              ) : !detailData ? (
                <div className={styles.full}>Contact not found.</div>
              ) : (
                <>
                  <label>
                    Contact Name
                    <input value={detailData.contact_name || ""} readOnly />
                  </label>
                  <label>
                    Designation
                    <input value={detailData.designation || ""} readOnly />
                  </label>
                  <label>
                    Company
                    <input value={detailData.company_linked_name || detailData.company_name || ""} readOnly />
                  </label>
                  <label>
                    Account Relationship
                    <input value={detailData.account_relationship || ""} readOnly />
                  </label>
                  <label>
                    Department
                    <input value={detailData.department || ""} readOnly />
                  </label>
                  <label>
                    Email
                    <input value={detailData.email || ""} readOnly />
                  </label>
                  <label>
                    Phone
                    <input value={detailData.phone || ""} readOnly />
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
                  {detailData.company_linked_name ? (
                    <>
                      <div className={styles.infoBox}>
                        Linked Company Details (auto-fetched from backend)
                      </div>
                      <label>
                        Company Name
                        <input value={detailData.company_linked_name || ""} readOnly />
                      </label>
                      <label>
                        Company Relationship
                        <input value={detailData.company_account_relationship || ""} readOnly />
                      </label>
                      <label>
                        Company Phone
                        <input value={detailData.company_phone || ""} readOnly />
                      </label>
                      <label>
                        Company Email
                        <input value={detailData.company_email || ""} readOnly />
                      </label>
                      <label>
                        Company Industry
                        <input value={detailData.company_industry || ""} readOnly />
                      </label>
                      <label>
                        Company Website
                        <input value={detailData.company_website || ""} readOnly />
                      </label>
                      <label className={styles.full}>
                        Company Street
                        <input value={detailData.company_street || ""} readOnly />
                      </label>
                      <label>
                        Company City
                        <input value={detailData.company_city || ""} readOnly />
                      </label>
                      <label>
                        Company State
                        <input value={detailData.company_state || ""} readOnly />
                      </label>
                      <label>
                        Company Country
                        <input value={detailData.company_country || ""} readOnly />
                      </label>
                      <label>
                        Company Postal Code
                        <input value={detailData.company_postal_code || ""} readOnly />
                      </label>
                      <label className={styles.full}>
                        Company Notes
                        <textarea rows={3} value={detailData.company_notes || ""} readOnly />
                      </label>
                    </>
                  ) : null}
                </>
              )}
              <div className={styles.modalActions}>
                {detailData?.company_name ? (
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => {
                      router.push(`/contacts?company=${encodeURIComponent(detailData.company_name)}`);
                    }}
                  >
                    Open Company Contacts
                  </button>
                ) : null}
                <button type="button" className={styles.btnPrimary} onClick={closeContactDetailModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal open={mergeOpen} onClose={closeMergeModal}>
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} data-modal-content="true">
            <div className={styles.modalHead}>
              <h2>Merge Contacts</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeMergeModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={mergeContacts} className={styles.formGrid}>
              <label className={styles.full}>
                To Keep
                <select
                  value={mergeForm.keep_id}
                  onChange={(e) => setMergeForm((p) => ({ ...p, keep_id: e.target.value }))}
                >
                  <option value="">Select contact</option>
                  {items.map((it) => (
                    <option key={`k-${it.id}`} value={it.id}>
                      {it.contact_name} - {it.company_name} {it.email ? `(${it.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.full}>
                To Merge (will be deleted after merge)
                <select
                  value={mergeForm.merge_id}
                  onChange={(e) => setMergeForm((p) => ({ ...p, merge_id: e.target.value }))}
                >
                  <option value="">Select contact</option>
                  {items.map((it) => (
                    <option key={`m-${it.id}`} value={it.id}>
                      {it.contact_name} - {it.company_name} {it.email ? `(${it.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.infoBox}>
                Keep record remains. Merge record data is merged into keep and merge record is deleted.
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeMergeModal}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={mergeSaving}>
                  {mergeSaving ? "Merging..." : "Merge Contacts"}
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
              <h2>Import Contacts</h2>
              <button type="button" className={styles.modalCloseBtn} onClick={closeImportModal}>
                <i className="fas fa-times" />
              </button>
            </div>
            <form onSubmit={importContacts} className={styles.formGrid}>
              <label className={styles.full}>
                CSV File
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
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
                CSV headers supported: company_name, contact_name, designation, account_relationship, department,
                email, phone, street, city, state, country, postal_code, website, notes
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
    </div>
  );
}
