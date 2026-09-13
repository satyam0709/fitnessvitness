"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { openFileFromApi } from "@/lib/openPrintableHtml";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "../invoicePages.module.css";

const PAGE_SIZES = [10, 25, 50];
const TYPES = [
  { value: "quotation", label: "Quotation" },
  { value: "paid_invoice", label: "Paid Invoice" },
];

function emptyForm() {
  return { name: "", type: "paid_invoice", file: null };
}

export default function InvoiceBrochurePage() {
  const { isLoaded } = useAuth();
  const { confirm } = useConfirmDialog();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/brochures");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load brochures");
      setRows(Array.isArray(d.brochures) ? d.brochures : []);
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

  useEffect(() => {
    if (!isLoaded) return undefined;
    return subscribeCrmLive(["brochures:changed"], () => load());
  }, [isLoaded, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.type_label || r.type || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const from = filtered.length === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, filtered.length);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  function openAdd() {
    setForm(emptyForm());
    setModal({ mode: "add" });
  }

  function openEdit(row) {
    setForm({ name: row.name || "", type: row.type || "paid_invoice", file: null });
    setModal({ mode: "edit", id: row.id, hasFile: !!row.has_file });
  }

  async function saveBrochure(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setErr("Brochure name is required");
      return;
    }
    if (modal?.mode === "add" && !form.file) {
      setErr("A brochure file is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("type", form.type);
      if (form.file) fd.append("file", form.file);
      const isEdit = modal?.mode === "edit";
      const res = await apiFetch(isEdit ? `/v2/brochures/${modal.id}` : "/v2/brochures", {
        method: isEdit ? "PUT" : "POST",
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Save failed");
      setModal(null);
      await load();
    } catch (ex) {
      setErr(ex.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row) {
    const msg = buildDeleteMessage({ singular: "brochure", name: row.name });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    setErr(null);
    try {
      const res = await apiFetch(`/v2/brochures/${row.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Delete failed");
      await load();
    } catch (ex) {
      setErr(ex.message || "Delete failed");
    }
  }

  async function openFile(row) {
    if (!row?.has_file) return;
    try {
      await openFileFromApi(`/v2/brochures/${row.id}/file`);
    } catch (ex) {
      setErr(ex.message || "Could not open file");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pmHead}>
        <h1 className={styles.title}>Brochure</h1>
        <div className={styles.pmHeadActions}>
          {searchOpen ? (
            <input
              className={styles.input}
              autoFocus
              placeholder="Search brochure"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (!search.trim()) setSearchOpen(false);
              }}
            />
          ) : (
            <button type="button" className={styles.iconBtn} title="Search" onClick={() => setSearchOpen(true)}>
              <i className="fas fa-search" />
            </button>
          )}
          <button type="button" className={styles.btnPrimary} onClick={openAdd}>
            + Add Brochure
          </button>
        </div>
      </div>

      {err ? <p className={styles.err}>{err}</p> : null}

      {loading ? (
        <p className={styles.sub}>Loading…</p>
      ) : (
        <div className={`${styles.tableWrap} ${styles.pmTableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Actions</th>
                <th>Brochure Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    There are no records to display.
                  </td>
                </tr>
              ) : (
                pageRows.map((row, idx) => (
                  <tr key={row.id}>
                    <td>{start + idx + 1}</td>
                    <td>
                      <div className={styles.actionIcons}>
                        <button type="button" className={styles.actBtn} title="Edit" onClick={() => openEdit(row)}>
                          <i className="fas fa-pencil-alt" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actBtn} ${styles.actDanger}`}
                          title="Delete"
                          onClick={() => removeRow(row)}
                        >
                          <i className="fas fa-trash" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actBtn} ${styles.actClip} ${row.has_file ? "" : styles.actClipOff}`}
                          title={row.has_file ? "Open file" : "No file"}
                          onClick={() => openFile(row)}
                        >
                          <i className="fas fa-paperclip" />
                          <span className={styles.clipBadge}>{row.has_file ? 1 : 0}</span>
                        </button>
                      </div>
                    </td>
                    <td>{row.name}</td>
                    <td>{row.type_label || row.type}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className={styles.pmPager}>
            <div className={styles.pmPagerLeft}>
              <span>Rows per page:</span>
              <select className={styles.select} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>
                {from} - {to} of {filtered.length}
              </span>
            </div>
            <div className={styles.pmPagerRight}>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage(1)}>
                First
              </button>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span className={styles.pmPageBox}>
                {safePage} / {pageCount}
              </span>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next
              </button>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}>
                Last
              </button>
            </div>
          </div>
        </div>
      )}

      {modal ? (
        <div className={styles.modalOverlay} onClick={() => !busy && setModal(null)}>
          <div className={styles.payModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.payModalHead}>
              <h2>{modal.mode === "edit" ? "Edit Brochure" : "Add Brochure"}</h2>
              <button type="button" className={styles.payClose} onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <form onSubmit={saveBrochure} className={styles.payModalBody}>
              <label className={styles.label}>Brochure name</label>
              <input
                className={styles.input}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Product catalogue"
                autoFocus
              />
              <label className={styles.label}>Type</label>
              <select
                className={styles.select}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className={styles.label}>File {modal.mode === "edit" ? "(optional replacement)" : ""}</label>
              <input
                className={styles.input}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))}
              />
              <div className={styles.payActions}>
                <button type="submit" className={styles.btnPrimary} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => setModal(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
