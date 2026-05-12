"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { apiFetch, getApiOrigin } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "./opportunitiesPage.module.css";

const STAGES = [
  { value: "qualification_done", label: "Qualification Done", color: "#94a3b8" },
  { value: "quotation_given", label: "Quotation Given", color: "#f59e0b" },
  { value: "negotiation_review", label: "Negotiation/Review", color: "#06b6d4" },
  { value: "on_hold", label: "On Hold", color: "#64748b" },
  { value: "closed_won", label: "Closed Won", color: "#16a34a" },
  { value: "closed_lost", label: "Closed Lost", color: "#9333ea" },
];
const PRODUCT_CATEGORIES = ["Hardware", "Software", "Services"];
const FOLLOWUP_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "demo", label: "Demo" },
  { value: "other", label: "Other" },
];
const OPPORTUNITY_TYPES = [
  { value: "new_business", label: "New Business" },
  { value: "upsell", label: "Upsell" },
  { value: "renewal", label: "Renewal" },
  { value: "cross_sell", label: "Cross-sell" },
  { value: "other", label: "Other" },
];
const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "social_media", label: "Social Media" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "cold_call", label: "Cold Call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];
const STAGE_ALIAS_TO_UI = {
  open: "qualification_done",
  proposal: "quotation_given",
  negotiation: "negotiation_review",
};

function normalizeStageForUi(stage) {
  const key = String(stage || "").trim().toLowerCase();
  return STAGE_ALIAS_TO_UI[key] || key;
}

function buildLabelMap(items) {
  return Object.fromEntries(items.map((it) => [it.value, it.label]));
}

function prettifyToken(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const EMPTY_FORM = {
  title: "",
  company_name: "",
  product_category: "Hardware",
  quantity: "",
  amount: "",
  stage: "qualification_done",
  expected_close_date: "",
  external_quotation_url: "",
  followup_at: "",
  followup_type: "call",
  opportunity_type: "new_business",
  lead_source: "website",
  comments_history: "",
  team: "",
};

async function opportunitiesRequest( suffix = "", options = {}) {
  const cleanSuffix = suffix.startsWith("/") || suffix.startsWith("?") ? suffix : `/${suffix}`;
  const paths = [`/opportunities${cleanSuffix}`, `/crm/opportunities${cleanSuffix}`];
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

export default function OpportunitiesPage() {
  const { isLoaded } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [stageFilter, setStageFilter] = useState(normalizeStageForUi(searchParams.get("stage") || ""));
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [colFilters, setColFilters] = useState({
    title: "",
    company: "",
    category: "",
    followupType: "",
    opportunityType: "",
    minAmount: "",
    maxAmount: "",
    expectedClose: "",
    leadSource: "",
    owner: "",
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("include_breakdown", "1");
      if (stageFilter) p.set("stage", stageFilter);
      if (q.trim()) p.set("q", q.trim());
      if (fromDate) p.set("expected_close_from", fromDate);
      if (toDate) p.set("expected_close_to", toDate);
      if (starredOnly) p.set("starred", "1");
      const res = await opportunitiesRequest( `?${p.toString()}`);
      if (!res) {
        showToast("Opportunity service is temporarily unavailable", "error");
        setItems([]);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not load opportunities", "error");
        setItems([]);
        return;
      }
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch {
      showToast("Could not load opportunities", "error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, q, showToast, stageFilter, starredOnly, toDate]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setInterval(fetchItems, 20000);
    return () => clearInterval(timer);
  }, [isLoaded, fetchItems]);

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
        s.on("calendar:changed", () => !cancelled && fetchItems());
        s.on("opportunities:changed", () => !cancelled && fetchItems());
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
  }, [isLoaded, fetchItems]);

  const stageCounts = useMemo(() => {
    const out = { all: items.length };
    for (const s of STAGES) out[s.value] = 0;
    for (const it of items) {
      const stageKey = normalizeStageForUi(it.stage);
      if (out[stageKey] != null) out[stageKey] += 1;
    }
    return out;
  }, [items]);

  const totalAmount = useMemo(() => items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0), [items]);
  const filteredRows = useMemo(() => {
    return items.filter((it) => {
      if (colFilters.title && !String(it.title || "").toLowerCase().includes(colFilters.title.toLowerCase())) return false;
      if (colFilters.company && !String(it.company_name || "").toLowerCase().includes(colFilters.company.toLowerCase()))
        return false;
      if (colFilters.category && String(it.product_category || "").toLowerCase() !== colFilters.category.toLowerCase())
        return false;
      if (
        colFilters.followupType &&
        String(it.followup_type || "").toLowerCase() !== colFilters.followupType.toLowerCase()
      )
        return false;
      if (
        colFilters.opportunityType &&
        String(it.opportunity_type || "").toLowerCase() !== colFilters.opportunityType.toLowerCase()
      )
        return false;
      const amt = Number(it.amount) || 0;
      if (colFilters.minAmount && amt < Number(colFilters.minAmount)) return false;
      if (colFilters.maxAmount && amt > Number(colFilters.maxAmount)) return false;
      if (colFilters.expectedClose && String(it.expected_close_date || "").slice(0, 10) !== colFilters.expectedClose) return false;
      if (
        colFilters.leadSource &&
        !String(it.lead_source || "").toLowerCase().includes(colFilters.leadSource.toLowerCase())
      )
        return false;
      if (colFilters.owner && !String(it.owner_email || "").toLowerCase().includes(colFilters.owner.toLowerCase())) return false;
      return true;
    });
  }, [colFilters, items]);

  const selectedStageMeta = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.value, s.label])), []);
  const followupTypeLabels = useMemo(() => buildLabelMap(FOLLOWUP_TYPES), []);
  const opportunityTypeLabels = useMemo(() => buildLabelMap(OPPORTUNITY_TYPES), []);
  const leadSourceLabels = useMemo(() => buildLabelMap(LEAD_SOURCES), []);
  const productCategoryLabels = useMemo(
    () => Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c.toLowerCase(), c])),
    []
  );

  function openCreateModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCreateModalOpen(true);
  }

  function openEditModal(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      company_name: item.company_name || "",
      product_category: item.product_category || "Hardware",
      quantity: item.quantity != null ? String(item.quantity) : "",
      amount: item.amount != null ? String(item.amount) : "",
      stage: normalizeStageForUi(item.stage) || "qualification_done",
      expected_close_date: item.expected_close_date ? String(item.expected_close_date).slice(0, 10) : "",
      external_quotation_url: item.external_quotation_url || "",
      followup_at: item.followup_at ? String(item.followup_at).slice(0, 16).replace(" ", "T") : "",
      followup_type: item.followup_type || "call",
      opportunity_type: item.opportunity_type || "new_business",
      lead_source: item.lead_source || "website",
      comments_history: item.comments_history || "",
      team: item.team || "",
    });
    setCreateModalOpen(true);
  }

  async function createOpportunity(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      showToast("Opportunity name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const isEdit = Boolean(editingId);
      const res = await opportunitiesRequest( isEdit ? `/${editingId}` : "", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          amount: Number(form.amount) || 0,
          quantity: Number(form.quantity) || 0,
          expected_close_date: form.expected_close_date || null,
        }),
      });
      if (!res) {
        showToast("Opportunity service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || (isEdit ? "Could not update opportunity" : "Could not create opportunity"), "error");
        return;
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setCreateModalOpen(false);
      showToast(isEdit ? "Opportunity updated" : "Opportunity created");
      fetchItems();
    } finally {
      setSaving(false);
    }
  }

  async function updateStage(id, nextStage) {
    try {
      const res = await opportunitiesRequest( `/${id}/stage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: nextStage }),
      });
      if (!res) {
        showToast("Opportunity service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update stage", "error");
        return;
      }
      showToast("Opportunity stage updated");
      fetchItems();
    } catch {
      showToast("Could not update stage", "error");
    }
  }

  async function remove(item) {
    const msg = buildDeleteMessage({
      singular: "opportunity",
      name: item?.title?.trim() || null,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await opportunitiesRequest( `/${item.id}`, { method: "DELETE" });
      if (!res) {
        showToast("Opportunity service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not delete opportunity", "error");
        return;
      }
      showToast("Opportunity deleted");
      fetchItems();
    } catch {
      showToast("Could not delete opportunity", "error");
    }
  }

  async function toggleStar(id, current) {
    try {
      const res = await opportunitiesRequest( `/${id}/star`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !current }),
      });
      if (!res) {
        showToast("Opportunity service is temporarily unavailable", "error");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        showToast(json.message || "Could not update starred state", "error");
        return;
      }
      showToast(current ? "Removed from starred" : "Added to starred");
      fetchItems();
    } catch {
      showToast("Could not update starred state", "error");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Opportunities</h1>
        <div className={styles.headerMeta}>
          <button type="button" className={styles.btnPrimary} onClick={openCreateModal}>
            <i className="fas fa-plus" /> Create
          </button>
          <span className={styles.liveMeta}>
            <span className={`${styles.liveDot} ${liveConnected ? "" : styles.liveDotOff}`} />
            {liveConnected ? "Live" : "Offline"}
          </span>
          <div className={styles.totalValue}>Expected Amount: INR {totalAmount.toLocaleString("en-IN")}</div>
        </div>
      </div>

      <div className={styles.stageStrip}>
        <button
          type="button"
          className={`${styles.stageCard} ${!stageFilter ? styles.stageCardActive : ""}`}
          onClick={() => setStageFilter("")}
        >
          <span>All [Sales Stage]</span>
          <strong>{stageCounts.all || 0}</strong>
        </button>
        {STAGES.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`${styles.stageCard} ${stageFilter === s.value ? styles.stageCardActive : ""}`}
            style={{ borderTopColor: s.color }}
            onClick={() => setStageFilter((prev) => (prev === s.value ? "" : s.value))}
          >
            <span>{s.label}</span>
            <strong>{stageCounts[s.value] || 0}</strong>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search opportunity / account name"
        />
        <input type="date" className={styles.input} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" className={styles.input} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button type="button" className={styles.btnGhost} onClick={fetchItems}>
          Search
        </button>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => {
            setQ("");
            setFromDate("");
            setToDate("");
            setStageFilter("");
            setStarredOnly(false);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className={`${styles.btnGhost} ${starredOnly ? styles.btnStarActive : ""}`}
          onClick={() => setStarredOnly((v) => !v)}
        >
          <i className="fas fa-star" /> Starred
        </button>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>Loading opportunities...</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.empty}>No opportunities found.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                <th>Opportunity Name</th>
                <th>Account Name</th>
                <th>Category</th>
                <th>Expected Amount</th>
                <th>Qty</th>
                <th>Expected Close Date</th>
                <th>Sales Stage</th>
                <th>Followup Type</th>
                <th>Opportunity Type</th>
                <th>Lead Source</th>
                <th>Assigned</th>
                <th />
              </tr>
              <tr className={styles.filterRow}>
                <th />
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.title}
                    onChange={(e) => setColFilters((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.company}
                    onChange={(e) => setColFilters((p) => ({ ...p, company: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th>
                  <select
                    className={styles.filterInput}
                    value={colFilters.category}
                    onChange={(e) => setColFilters((p) => ({ ...p, category: e.target.value }))}
                  >
                    <option value="">All</option>
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <div className={styles.amountFilterWrap}>
                    <input
                      className={styles.filterInput}
                      value={colFilters.minAmount}
                      onChange={(e) => setColFilters((p) => ({ ...p, minAmount: e.target.value }))}
                      placeholder="Min"
                    />
                    <input
                      className={styles.filterInput}
                      value={colFilters.maxAmount}
                      onChange={(e) => setColFilters((p) => ({ ...p, maxAmount: e.target.value }))}
                      placeholder="Max"
                    />
                  </div>
                </th>
                <th>
                  <input
                    type="date"
                    className={styles.filterInput}
                    value={colFilters.expectedClose}
                    onChange={(e) => setColFilters((p) => ({ ...p, expectedClose: e.target.value }))}
                  />
                </th>
                <th />
                <th />
                <th />
                <th>
                  <select
                    className={styles.filterInput}
                    value={colFilters.followupType}
                    onChange={(e) => setColFilters((p) => ({ ...p, followupType: e.target.value }))}
                  >
                    <option value="">All</option>
                    {FOLLOWUP_TYPES.map((it) => (
                      <option key={it.value} value={it.value}>
                        {it.label}
                      </option>
                    ))}
                  </select>
                </th>
                <th>
                  <select
                    className={styles.filterInput}
                    value={colFilters.opportunityType}
                    onChange={(e) => setColFilters((p) => ({ ...p, opportunityType: e.target.value }))}
                  >
                    <option value="">All</option>
                    {OPPORTUNITY_TYPES.map((it) => (
                      <option key={it.value} value={it.value}>
                        {it.label}
                      </option>
                    ))}
                  </select>
                </th>
                <th />
                <th>
                  <input
                    className={styles.filterInput}
                    value={colFilters.owner}
                    onChange={(e) => setColFilters((p) => ({ ...p, owner: e.target.value }))}
                    placeholder="Search"
                  />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((it) => (
                <tr key={it.id}>
                  <td>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${it.is_starred ? styles.iconBtnStarred : ""}`}
                      onClick={() => toggleStar(it.id, !!it.is_starred)}
                      title="Toggle favorite"
                    >
                      <i className="fas fa-star" />
                    </button>
                  </td>
                  <td>{it.title}</td>
                  <td>{it.company_name || "-"}</td>
                  <td>{productCategoryLabels[String(it.product_category || "").toLowerCase()] || prettifyToken(it.product_category) || "-"}</td>
                  <td>INR {Number(it.amount || 0).toLocaleString("en-IN")}</td>
                  <td>{Number(it.quantity || 0)}</td>
                  <td>{it.expected_close_date ? String(it.expected_close_date).slice(0, 10) : "-"}</td>
                  <td>
                    <select className={styles.stageSelect} value={normalizeStageForUi(it.stage)} onChange={(e) => updateStage(it.id, e.target.value)}>
                      {STAGES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{followupTypeLabels[String(it.followup_type || "").toLowerCase()] || prettifyToken(it.followup_type) || "-"}</td>
                  <td>{opportunityTypeLabels[String(it.opportunity_type || "").toLowerCase()] || prettifyToken(it.opportunity_type) || "-"}</td>
                  <td>{leadSourceLabels[String(it.lead_source || "").toLowerCase()] || prettifyToken(it.lead_source) || "-"}</td>
                  <td>{it.owner_email || "-"}</td>
                  <td>
                    <div className={styles.actionIcons}>
                      <button type="button" className={styles.iconBtn} onClick={() => openEditModal(it)} title="Edit">
                        <i className="fas fa-pen" />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => updateStage(it.id, "open")} title="Move Open">
                        <i className="fas fa-rotate-left" />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => remove(it)} title="Delete">
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

      {createModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.modalBackdrop} onClick={() => setCreateModalOpen(false)}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHead}>
                  <h2>{editingId ? "Edit Opportunity" : "Create Opportunity"}</h2>
                  <button type="button" className={styles.modalCloseBtn} onClick={() => setCreateModalOpen(false)}>
                    <i className="fas fa-times" />
                  </button>
                </div>
                <form className={styles.modalForm} onSubmit={createOpportunity}>
                  <div className={styles.modalFormGrid}>
              <label className={styles.field}>
                Opportunity Name *
                <input
                  className={styles.input}
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Account Name
                <input
                  className={styles.input}
                  value={form.company_name}
                  onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Product Category
                <select
                  className={styles.input}
                  value={form.product_category}
                  onChange={(e) => setForm((f) => ({ ...f, product_category: e.target.value }))}
                >
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Quantity
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Expected Amount
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Expected Close Date
                <input
                  className={styles.input}
                  type="date"
                  value={form.expected_close_date}
                  onChange={(e) => setForm((f) => ({ ...f, expected_close_date: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Sales Stage
                <select
                  className={styles.input}
                  value={form.stage}
                  onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
                >
                  {STAGES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                External Quotation Url
                <input
                  className={styles.input}
                  value={form.external_quotation_url}
                  onChange={(e) => setForm((f) => ({ ...f, external_quotation_url: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Followup Date
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={form.followup_at}
                  onChange={(e) => setForm((f) => ({ ...f, followup_at: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                Followup Type
                <select
                  className={styles.input}
                  value={form.followup_type}
                  onChange={(e) => setForm((f) => ({ ...f, followup_type: e.target.value }))}
                >
                  {FOLLOWUP_TYPES.map((it) => (
                    <option key={it.value} value={it.value}>
                      {it.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Opportunity Type
                <select
                  className={styles.input}
                  value={form.opportunity_type}
                  onChange={(e) => setForm((f) => ({ ...f, opportunity_type: e.target.value }))}
                >
                  {OPPORTUNITY_TYPES.map((it) => (
                    <option key={it.value} value={it.value}>
                      {it.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Lead Source
                <select
                  className={styles.input}
                  value={form.lead_source}
                  onChange={(e) => setForm((f) => ({ ...f, lead_source: e.target.value }))}
                >
                  {LEAD_SOURCES.map((it) => (
                    <option key={it.value} value={it.value}>
                      {it.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                Team
                <input
                  className={styles.input}
                  value={form.team}
                  onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))}
                />
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                Comments / History
                <textarea
                  className={styles.textArea}
                  rows={4}
                  value={form.comments_history}
                  onChange={(e) => setForm((f) => ({ ...f, comments_history: e.target.value }))}
                />
              </label>
                  </div>
                  <div className={styles.modalActions}>
                    <button type="button" className={styles.btnGhost} onClick={() => setCreateModalOpen(false)}>
                      Cancel
                    </button>
                    <button disabled={saving} type="submit" className={styles.btnPrimary}>
                      {saving ? "Saving..." : editingId ? "Update Opportunity" : "Save Opportunity"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
