"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import AddLeadModal from "@/components/Leads/AddLeadModal";
import LeadDateRangeModal from "@/components/Leads/LeadDateRangeModal";
import LeadQuickModals from "@/components/Leads/LeadQuickModals";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import LeadChangeLogModal from "@/components/Leads/LeadChangeLogModal";
import {
  LEGACY_STATUSES,
  SOURCES,
  CONVERT_OPTION_VALUE,
  isLeadConverted,
} from "@/components/Leads/leadConstants";
import styles from "./leads.module.css";

const STATUSES = LEGACY_STATUSES;
const SOURCE_ITEMS = SOURCES;

export default function LeadsPage() {
  const { confirm } = useConfirmDialog();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── data state ─────────────────────────────────────────────────────────
  const [leads,      setLeads]      = useState([]);
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);

  // ── view / filter state ────────────────────────────────────────────────
  const [viewMode,       setViewMode]       = useState("list"); // "kanban" | "list"
  const [filterSource,   setFilterSource]   = useState("");
  const [filterDate,     setFilterDate]     = useState("");
  const [filterFollowUpFrom, setFilterFollowUpFrom] = useState("");
  const [filterFollowUpTo,   setFilterFollowUpTo]   = useState("");
  const [filterSearch,   setFilterSearch]   = useState("");
  const [filterCreatedBy,setFilterCreatedBy]= useState("");
  const [filterAssignTo, setFilterAssignTo] = useState("");
  const [filterLabel,    setFilterLabel]    = useState("");
  const [filterStatus,   setFilterStatus]   = useState(searchParams.get("status") || "");

  // ── modal state ────────────────────────────────────────────────────────
  const [addOpen,       setAddOpen]       = useState(false);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const menuRef = useRef(null);

  const [actionModal, setActionModal] = useState(null);
  const [changeLogLeadId, setChangeLogLeadId] = useState(null);

  // ── toast ──────────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── close menu on outside click ────────────────────────────────────────
  useEffect(() => {
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ── fetch leads ────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSource) params.set("source", filterSource);
      if (filterFollowUpFrom && filterFollowUpTo) {
        params.set("follow_up_from", filterFollowUpFrom);
        params.set("follow_up_to", filterFollowUpTo);
      } else if (filterDate) {
        params.set("follow_up_date", filterDate);
      }
      if (filterSearch) params.set("search", filterSearch);
      if (filterStatus) params.set("status", filterStatus);
      if (filterAssignTo) params.set("assigned_to", filterAssignTo);

      const qs = params.toString();
      const res  = await apiFetch(`/leads${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setLeads(json.data);
      else setLeads([]);
    } catch { setLeads([]); }
    finally  { setLoading(false); }
  }, [filterSource, filterDate, filterFollowUpFrom, filterFollowUpTo, filterSearch, filterStatus, filterAssignTo]);

  const fetchUsers = useCallback(async () => {
    try {
      const res  = await apiFetch("/users");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setUsers(json.data);
    } catch { setUsers([]); }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    const unsub = subscribeCrmLive(["leads:changed", "calendar:changed"], () => {
      fetchLeads();
    });
    return unsub;
  }, [fetchLeads]);

  // ── derived ─────────────────────────────────────────────────────────────
  const filteredLeads = leads.filter((l) => {
    if (filterCreatedBy && String(l.created_by) !== filterCreatedBy) return false;
    if (filterLabel     && l.label !== filterLabel)                   return false;
    return true;
  });

  function leadsForStatus(key) {
    if (key === "confirm") {
      return filteredLeads.filter((l) => isLeadConverted(l) || l.status === "confirm");
    }
    return filteredLeads.filter((l) => l.status === key && !isLeadConverted(l));
  }

  function handleStatusSelect(lead, newStatus) {
    if (newStatus === CONVERT_OPTION_VALUE) {
      if (isLeadConverted(lead)) {
        showToast("Lead is already converted", "error");
        return;
      }
      setActionModal({ type: "convert", lead });
      return;
    }
    handleStatusChange(lead.id, newStatus);
  }

  function openConvertFromStatus(lead) {
    setActionModal({ type: "convert", lead });
  }

  // ── status change (inline dropdown) ────────────────────────────────────
  async function handleStatusChange(leadId, newStatus) {
    try {
      // PUT (not PATCH) so CORS preflight works with APIs that omit PATCH in Allow-Methods.
      const res = await apiFetch(`/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (json.success) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, ...(json.data || {}), status: newStatus } : l
          )
        );
        showToast("Status updated");
      } else showToast(json.message || "Failed", "error");
    } catch { showToast("Network error", "error"); }
  }

  // ── delete ─────────────────────────────────────────────────────────────
  async function handleDelete(lead) {
    const msg = buildDeleteMessage({ singular: "lead", name: lead.name });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    const leadId = lead.id;
    try {
      const res  = await apiFetch(`/leads/${leadId}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        showToast("Lead deleted");
      } else showToast(json.message || "Failed", "error");
    } catch { showToast("Network error", "error"); }
  }

  // ── select all ─────────────────────────────────────────────────────────
  function toggleSelectAll() {
    if (selectedLeads.size === filteredLeads.length) setSelectedLeads(new Set());
    else setSelectedLeads(new Set(filteredLeads.map((l) => l.id)));
  }
  function toggleSelect(id) {
    setSelectedLeads((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  // ── bulk delete ────────────────────────────────────────────────────────
  async function handleBulkDelete() {
    if (!selectedLeads.size) return;
    const msg = buildDeleteMessage({
      singular: "lead",
      plural: "leads",
      count: selectedLeads.size,
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    const ids = [...selectedLeads];
    await Promise.all(ids.map((id) =>
      apiFetch(`/leads/${id}`, { method: "DELETE" })
    ));
    setLeads((prev) => prev.filter((l) => !selectedLeads.has(l.id)));
    setSelectedLeads(new Set());
    showToast(`${ids.length} leads deleted`);
  }

  // ── export CSV ─────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = filteredLeads;
    if (!rows.length) return;
    const header = ["ID","Name","Phone","Email","Company","Source","Status","Label","Assigned To","Follow Up Date","Created At"];
    const csv = [
      header.join(","),
      ...rows.map((l) => [
        l.id, `"${l.name}"`, l.phone, l.email || "",
        `"${l.company_name || ""}"`, l.source, l.status,
        l.label || "", `"${l.assigned_name || ""}"`,
        l.follow_up_date || "", new Date(l.created_at).toLocaleDateString("en-IN"),
      ].join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `leads_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
    setMenuOpen(false);
  }

  function clearFilters() {
    setFilterSource("");
    setFilterDate("");
    setFilterFollowUpFrom("");
    setFilterFollowUpTo("");
    setFilterSearch("");
    setFilterCreatedBy("");
    setFilterAssignTo("");
    setFilterLabel("");
    setFilterStatus("");
  }

  const hasDateRange = Boolean(filterFollowUpFrom && filterFollowUpTo);
  const hasFilters =
    filterSource ||
    filterDate ||
    hasDateRange ||
    filterSearch ||
    filterCreatedBy ||
    filterAssignTo ||
    filterLabel ||
    filterStatus;

  function statusCount(key) {
    if (key === "confirm") {
      return filteredLeads.filter((l) => isLeadConverted(l) || l.status === "confirm").length;
    }
    return filteredLeads.filter((l) => l.status === key && !isLeadConverted(l)).length;
  }

  function toggleStatusFilter(key) {
    setFilterStatus((prev) => (prev === key ? "" : key));
  }

  function goView(mode) {
    setViewMode(mode);
    if (mode === "kanban") setFilterStatus("");
  }

  function mergeLead(updated) {
    if (!updated?.id) return;
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  }

  async function handleLeadMenuAction(key, lead) {
    if (key === "whatsapp") {
      setActionModal({ type: "whatsapp", lead });
      return;
    }
    if (key === "copy") {
      try {
        await navigator.clipboard.writeText(
          JSON.stringify(
            { name: lead.name, phone: lead.phone, email: lead.email, company: lead.company_name, source: lead.source },
            null,
            2
          )
        );
        showToast("Lead copied to clipboard");
      } catch {
        showToast("Could not copy", "error");
      }
      return;
    }
    if (key === "reminder") {
      const tomorrow = new Date(Date.now() + 86400000);
      const remindAt = tomorrow.toISOString().slice(0, 19).replace("T", " ");
      try {
        const res = await apiFetch("/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Follow up: ${lead.name}`,
            note: lead.phone || "",
            remind_at: remindAt,
            lead_id: lead.id,
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) showToast("Reminder created");
        else showToast(json.message || "Failed", "error");
      } catch {
        showToast("Network error", "error");
      }
      return;
    }
    if (key === "meeting") {
      const start = new Date(Date.now() + 3600000);
      const end = new Date(start.getTime() + 3600000);
      try {
        const res = await apiFetch("/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Meeting: ${lead.name}`,
            description: lead.notes || "",
            start_time: start.toISOString().slice(0, 19).replace("T", " "),
            end_time: end.toISOString().slice(0, 19).replace("T", " "),
            lead_id: lead.id,
          }),
        });
        const json = await res.json();
        if (res.ok && (json.success || json.id)) showToast("Meeting scheduled");
        else showToast(json.message || "Failed", "error");
      } catch {
        showToast("Network error", "error");
      }
      return;
    }
    if (key === "task") {
      try {
        const res = await apiFetch("/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Task: ${lead.name}`,
            description: lead.notes || lead.reference || "",
            lead_id: lead.id,
            assigned_to: lead.assigned_to || undefined,
            due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
            priority: "medium",
            status: "todo",
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) showToast("Task created");
        else showToast(json.message || "Failed", "error");
      } catch {
        showToast("Network error", "error");
      }
      return;
    }
    if (key === "quotation") {
      router.push(`/invoice/quotation?lead_id=${lead.id}`);
      return;
    }
    if (key === "invoice") {
      router.push(`/invoice/sales/new?lead_id=${lead.id}`);
      return;
    }
    if (key === "duplicate") {
      setActionModal({ type: "duplicate", lead });
      return;
    }
    if (key === "link-client") {
      setActionModal({ type: "link-client", lead });
      return;
    }
    if (key === "change-log") {
      setChangeLogLeadId(lead.id);
    }
  }

  return (
    <div className={styles.page}>
      {/* ── toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === "error" ? styles.toastErr : styles.toastOk}`}>
          <i className={`fas ${toast.type === "error" ? "fa-circle-exclamation" : "fa-circle-check"}`} />
          {toast.msg}
        </div>
      )}

      {/* ── header + filters (matches CRM layout: title, views, two filter rows, status strip) ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarHead}>
          <h1 className={styles.pageTitle}>Leads</h1>
          <div className={styles.viewToggle} role="group" aria-label="View mode">
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
              onClick={() => goView("list")}
              title="List view"
            >
              <i className="fas fa-list" />
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${viewMode === "kanban" ? styles.viewBtnActive : ""}`}
              onClick={() => goView("kanban")}
              title="Kanban view"
            >
              <i className="fas fa-table-columns" />
            </button>
          </div>
        </div>

        <div className={styles.filtersPrimary}>
          <div className={styles.selectWrap}>
            <select
              className={styles.filterSelect}
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              aria-label="Lead platform"
            >
              <option value="">Select Lead Platform</option>
              {SOURCE_ITEMS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <i className="fas fa-chevron-down" />
          </div>

          <div className={styles.dateField}>
            <span className={styles.dateFieldLabel}>Search By Follow-Up Date</span>
            <div className={styles.selectWrap}>
              <input
                type="date"
                className={`${styles.filterSelect} ${styles.dateInput}`}
                value={filterDate}
                onChange={(e) => {
                  setFilterDate(e.target.value);
                  setFilterFollowUpFrom("");
                  setFilterFollowUpTo("");
                }}
              />
            </div>
          </div>

          <div className={styles.searchWrap}>
            <i className="fas fa-magnifying-glass" />
            <input
              className={styles.searchInput}
              placeholder="Search By Text..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
          </div>

          <button type="button" className={styles.iconBtn} title="Apply search" onClick={fetchLeads}>
            <i className="fas fa-magnifying-glass" />
          </button>

          {hasFilters && (
            <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} title="Clear filters" onClick={clearFilters}>
              <i className="fas fa-xmark" />
            </button>
          )}

          <button
            type="button"
            className={`${styles.iconBtn} ${hasDateRange ? styles.iconBtnCalendarActive : ""}`}
            title={hasDateRange ? `Follow-up range: ${filterFollowUpFrom} → ${filterFollowUpTo}` : "Pick follow-up date range"}
            aria-expanded={dateRangeOpen}
            aria-haspopup="dialog"
            onClick={() => setDateRangeOpen(true)}
          >
            <i className="fas fa-calendar" />
          </button>

          <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)} title="Add lead">
            <i className="fas fa-plus" />
          </button>

          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setMenuOpen((v) => !v)}
              title="More options"
            >
              <i className="fas fa-ellipsis-vertical" />
            </button>
            {menuOpen && (
              <div className={styles.dropdown}>
                <button type="button" className={styles.dropItem} onClick={() => { setMenuOpen(false); }}>
                  <i className="fas fa-sort" /> Lead Sorting
                </button>
                <button type="button" className={styles.dropItem} onClick={exportCSV}>
                  <i className="fas fa-file-export" /> Export Leads
                </button>
                <button type="button" className={styles.dropItem} onClick={() => setMenuOpen(false)}>
                  <i className="fas fa-arrows-rotate" /> Change Status
                </button>
                <button type="button" className={styles.dropItem} onClick={() => setMenuOpen(false)}>
                  <i className="fas fa-user-tag" /> Assign To
                </button>
                <button type="button" className={styles.dropItem} onClick={() => setMenuOpen(false)}>
                  <i className="fas fa-tag" /> Add Label
                </button>
                {selectedLeads.size > 0 && (
                  <button type="button" className={`${styles.dropItem} ${styles.dropItemDanger}`} onClick={handleBulkDelete}>
                    <i className="fas fa-trash" /> Delete Lead ({selectedLeads.size})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.secondaryFilters}>
          <div className={styles.afGroup}>
            <label className={styles.afLabel} htmlFor="lead-filter-created">Created By</label>
            <div className={styles.selectWrap}>
              <select
                id="lead-filter-created"
                className={styles.filterSelect}
                value={filterCreatedBy}
                onChange={(e) => setFilterCreatedBy(e.target.value)}
              >
                <option value="">All Lead</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                  </option>
                ))}
              </select>
              <i className="fas fa-chevron-down" />
            </div>
          </div>

          <div className={styles.afGroup}>
            <label className={styles.afLabel} htmlFor="lead-filter-assign">Assign To</label>
            <div className={styles.selectWrap}>
              <select
                id="lead-filter-assign"
                className={styles.filterSelect}
                value={filterAssignTo}
                onChange={(e) => setFilterAssignTo(e.target.value)}
              >
                <option value="">All Assign</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                  </option>
                ))}
              </select>
              <i className="fas fa-chevron-down" />
            </div>
          </div>

          <div className={styles.afGroup}>
            <label className={styles.afLabel} htmlFor="lead-filter-label">Labels</label>
            <div className={styles.selectWrap}>
              <select
                id="lead-filter-label"
                className={styles.filterSelect}
                value={filterLabel}
                onChange={(e) => setFilterLabel(e.target.value)}
              >
                <option value="">All Labels</option>
                {["Hot", "Warm", "Cold", "VIP", "Enterprise"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <i className="fas fa-chevron-down" />
            </div>
          </div>

          <div className={styles.afGroup}>
            <label className={styles.afLabel} htmlFor="lead-filter-source">Source</label>
            <div className={styles.selectWrap}>
              <select
                id="lead-filter-source"
                className={styles.filterSelect}
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="">Source</option>
                {SOURCE_ITEMS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <i className="fas fa-chevron-down" />
            </div>
          </div>
        </div>

        <div className={styles.statusStrip} role="tablist" aria-label="Filter by status">
            {STATUSES.map((st) => {
              const n = statusCount(st.key);
              const active = filterStatus === st.key;
              return (
                <button
                  key={st.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.statusChip} ${active ? styles.statusChipActive : ""}`}
                  style={{ background: st.color }}
                  onClick={() => toggleStatusFilter(st.key)}
                >
                  <span className={styles.statusChipLabel}>{st.label}</span>
                  <span className={styles.statusChipCount}>{n}</span>
                </button>
              );
            })}
          </div>
      </div>

      {/* ── KANBAN VIEW ───────────────────────────────────────────────────── */}
      {viewMode === "kanban" && (
        <div className={styles.kanban}>
          {STATUSES.map((st) => {
            const cols = leadsForStatus(st.key);
            return (
              <div key={st.key} className={styles.kanbanCol}>
                <div
                  className={styles.kanbanHeader}
                  style={{ background: st.color }}
                >
                  <span>{st.label}</span>
                  <span className={styles.kanbanCount}>{cols.length}</span>
                </div>
                <div className={styles.kanbanBody}>
                  {loading ? (
                    <div className={styles.kanbanLoading}>
                      <div className={styles.spinner} />
                    </div>
                  ) : cols.length === 0 ? (
                    <div className={styles.kanbanEmpty}>No leads</div>
                  ) : (
                    cols.map((lead) => (
                      <KanbanCard
                        key={lead.id}
                        lead={lead}
                        statuses={STATUSES}
                        onStatusChange={handleStatusSelect}
                        onDelete={handleDelete}
                        onOpenAction={(type, l) => setActionModal({ type, lead: l })}
                        onMenuAction={handleLeadMenuAction}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className={styles.listPanel}>
          {loading ? (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <span>Loading leads…</span>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="fas fa-filter" style={{ fontSize: 48, opacity: 0.15 }} />
              <span>There are no records to display</span>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th />
                    <th>No.</th>
                    <th>Customer Name</th>
                    <th>Date</th>
                    <th>Assign To</th>
                    <th>Mobile</th>
                    <th>Follow Up Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((lead, idx) => (
                    <ListRow
                      key={lead.id}
                      lead={lead}
                      idx={idx}
                      statuses={STATUSES}
                      selected={selectedLeads.has(lead.id)}
                      onToggle={() => toggleSelect(lead.id)}
                      onStatusChange={handleStatusSelect}
                      onDelete={handleDelete}
                      onOpenAction={(type, l) => setActionModal({ type, lead: l })}
                      onMenuAction={handleLeadMenuAction}
                    />
                  ))}
                </tbody>
              </table>

              {/* pagination info */}
              <div className={styles.paginationRow}>
                <span className={styles.rowsLabel}>Rows per page:</span>
                <select className={styles.rowsSelect} defaultValue={10}>
                  {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
                </select>
                <span className={styles.pageInfo}>
                  1 – {Math.min(10, filteredLeads.length)} of {filteredLeads.length}
                </span>
                <button className={styles.pageBtn} disabled><i className="fas fa-angles-left" /></button>
                <button className={styles.pageBtn} disabled><i className="fas fa-angle-left" /></button>
                <span className={styles.pageCurrent}>1</span>
                <span className={styles.pageInfo}>of {Math.ceil(filteredLeads.length / 10) || 1}</span>
                <button className={styles.pageBtn}><i className="fas fa-angle-right" /></button>
                <button className={styles.pageBtn}><i className="fas fa-angles-right" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      <LeadDateRangeModal
        open={dateRangeOpen}
        onClose={() => setDateRangeOpen(false)}
        initialFrom={filterFollowUpFrom}
        initialTo={filterFollowUpTo} onApply={({ from, to }) => {
          setFilterFollowUpFrom(from);
          setFilterFollowUpTo(to);
          setFilterDate("");
          showToast(`Filter: follow-ups ${from} → ${to}`);
        }}
      />

      {/* ── Add Lead Modal ─────────────────────────────────────────────── */}
      <AddLeadModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(newLead) => {
          if (newLead) setLeads((prev) => [newLead, ...prev]);
          else fetchLeads();
          setAddOpen(false);
          showToast("Lead added successfully!");
        }}
      />

      <LeadQuickModals
        modal={actionModal}
        onClose={() => setActionModal(null)}
        users={users}
        statuses={STATUSES}
        onDone={fetchLeads}
        onLeadPatch={mergeLead}
        onConvertLead={openConvertFromStatus}
      />

      {changeLogLeadId && (
        <LeadChangeLogModal
          leadId={changeLogLeadId}
          onClose={() => setChangeLogLeadId(null)}
        />
      )}
    </div>
  );
}

function LeadStatusSelect({ lead, statuses, className, style, onChange }) {
  const converted = isLeadConverted(lead);
  return (
    <select
      className={className}
      value={lead.status}
      onChange={(e) => {
        const v = e.target.value;
        onChange(lead, v);
        if (v === CONVERT_OPTION_VALUE) {
          e.target.value = lead.status;
        }
      }}
      style={style}
      aria-label="Lead status"
    >
      {statuses.map((s) => (
        <option key={s.key} value={s.key}>{s.label}</option>
      ))}
      {!converted && (
        <optgroup label="Opportunity">
          <option value={CONVERT_OPTION_VALUE}>Convert to Opportunity…</option>
        </optgroup>
      )}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Card
// ─────────────────────────────────────────────────────────────────────────────
const CARD_TOOLBAR = [
  { key: "delete",   icon: "fa-trash",        title: "Delete",    danger: true },
  { key: "label",    icon: "fa-tag",          title: "Label" },
  { key: "assign",   icon: "fa-user",         title: "Assign" },
  { key: "convert",  icon: "fa-right-left",   title: "Convert to opportunity" },
  { key: "status",   icon: "fa-chart-line",   title: "Change status" },
  { key: "followup", icon: "fa-calendar-plus", title: "Follow-up" },
];

const MENU_ITEMS = [
  { key: "whatsapp", icon: "fa-whatsapp", label: "Whatsapp", fab: true },
  { key: "reminder", icon: "fa-bell", label: "Set Reminder" },
  { key: "meeting", icon: "fa-briefcase", label: "Set Meeting" },
  { key: "copy", icon: "fa-copy", label: "Copy Lead" },
  { key: "duplicate", icon: "fa-clone", label: "Duplicate Lead" },
  { key: "link-client", icon: "fa-link", label: "Link Client" },
  { key: "change-log", icon: "fa-history", label: "Change Log" },
  { key: "task", icon: "fa-list-check", label: "Create Task" },
  { key: "quotation", icon: "fa-file-invoice", label: "Create Quotation" },
  { key: "invoice", icon: "fa-file-invoice-dollar", label: "Create Invoice" },
];

function KanbanCard({ lead, statuses, onStatusChange, onDelete, onOpenAction, onMenuAction }) {
  const st = statuses.find((s) => s.key === lead.status) || statuses[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function close(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const createdBy = lead.created_by_name || "—";
  const assignedTo = lead.assigned_name || "—";
  const cd = new Date(lead.created_at).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={styles.kanbanCard}>
      <div className={styles.kcTop}>
        <Link href={`/leads/${lead.id}`} className={styles.kcName}>{lead.name}</Link>
        <span className={styles.kcLabel}>{lead.label || "No Labels"}</span>
      </div>
      <div className={styles.kcMeta}>
        <span><i className="fas fa-phone" /> {lead.phone}</span>
        {lead.source && <span className={styles.kcSource}>{lead.source}</span>}
      </div>
      <div className={styles.kcDetailLines}>
        <div className={styles.kcDetailLine}><strong>CN:</strong> {lead.company_name || "—"}</div>
        <div className={styles.kcDetailLine}><strong>CD:</strong> {cd}</div>
        <div className={styles.kcDetailLine}><strong>BY:</strong> {createdBy}</div>
        <div className={styles.kcDetailLine}><strong>TO:</strong> {assignedTo}</div>
        {lead.address && (
          <div className={styles.kcDetailLine}><strong>AD:</strong> {lead.address}</div>
        )}
      </div>
      <div className={styles.kcIconRow}>
        {CARD_TOOLBAR.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`${styles.kcIconBtn} ${a.danger ? styles.kcIconDanger : ""}`}
            title={a.title}
            onClick={() => {
              if (a.key === "delete") onDelete(lead);
              else onOpenAction(a.key, lead);
            }}
          >
            <i className={`fas ${a.icon}`} />
          </button>
        ))}
        <div className={styles.kcMoreWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.kcIconBtn}
            title="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <i className="fas fa-ellipsis-vertical" />
          </button>
          {menuOpen && (
            <div className={styles.kcCardMenu}>
              {MENU_ITEMS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={styles.kcCardMenuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onMenuAction(m.key, lead);
                  }}
                >
                  <i className={`${m.fab ? "fab" : "fas"} ${m.icon}`} />
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.kcFooter}>
        <LeadStatusSelect
          lead={lead}
          statuses={statuses}
          className={styles.kcStatusSel}
          style={{ color: st.color, borderColor: st.color }}
          onChange={onStatusChange}
        />
        <Link href={`/leads/${lead.id}`} className={styles.kcActionBtn} title="View">
          <i className="fas fa-eye" />
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List Row
// ─────────────────────────────────────────────────────────────────────────────
function ListRow({ lead, idx, statuses, selected, onToggle, onStatusChange, onDelete, onOpenAction, onMenuAction }) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function close(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <>
      <tr className={`${styles.tableRow} ${selected ? styles.tableRowSelected : ""}`}>
        <td>
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </td>
        <td>
          <button
            className={styles.expandBtn}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse" : "Expand"}
          >
            <i className={`fas fa-chevron-${expanded ? "down" : "right"}`} />
          </button>
        </td>
        <td className={styles.tdNum}>{idx + 1}</td>
        <td>
          <Link href={`/leads/${lead.id}`} className={styles.leadName}>
            {lead.name}
          </Link>
          {lead.company_name && (
            <span className={styles.leadCompany}>{lead.company_name}</span>
          )}
        </td>
        <td className={styles.tdMuted}>
          {new Date(lead.created_at).toLocaleDateString("en-IN", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
        </td>
        <td className={styles.tdMuted}>{lead.assigned_name || "—"}</td>
        <td className={styles.tdPhone}>{lead.phone}</td>
        <td className={styles.tdMuted}>
          {lead.follow_up_date
            ? new Date(lead.follow_up_date).toLocaleDateString("en-IN")
            : "—"}
        </td>
        <td>
          <LeadStatusSelect
            lead={lead}
            statuses={statuses}
            className={styles.statusSel}
            style={{
              color: statuses.find((s) => s.key === lead.status)?.color,
              borderColor: statuses.find((s) => s.key === lead.status)?.color,
            }}
            onChange={onStatusChange}
          />
        </td>
        <td>
          <div className={styles.actionRow}>
            {CARD_TOOLBAR.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`${styles.actionBtn} ${a.danger ? styles.actionBtnDanger : ""}`}
                title={a.title}
                onClick={() => {
                  if (a.key === "delete") onDelete(lead);
                  else onOpenAction(a.key, lead);
                }}
              >
                <i className={`fas ${a.icon}`} />
              </button>
            ))}
            <div className={styles.kcMoreWrap} ref={menuRef} style={{ position: "relative" }}>
              <button
                type="button"
                className={styles.actionBtn}
                title="More"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <i className="fas fa-ellipsis-vertical" />
              </button>
              {menuOpen && (
                <div className={styles.kcCardMenu} style={{ right: 0, left: "auto" }}>
                  {MENU_ITEMS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={styles.kcCardMenuItem}
                      onClick={() => {
                        setMenuOpen(false);
                        onMenuAction(m.key, lead);
                      }}
                    >
                      <i className={`${m.fab ? "fab" : "fas"} ${m.icon}`} />
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={10}>
            <div className={styles.expandedGrid}>
              <div><strong>Email:</strong> {lead.email || "—"}</div>
              <div><strong>Source:</strong> {lead.source || "—"}</div>
              <div><strong>Label:</strong>  {lead.label  || "—"}</div>
              <div><strong>Reference:</strong> {lead.reference || "—"}</div>
              {lead.address && <div style={{ gridColumn: "1/-1" }}><strong>Address:</strong> {lead.address}</div>}
              {lead.notes   && <div style={{ gridColumn: "1/-1" }}><strong>Notes:</strong> {lead.notes}</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}