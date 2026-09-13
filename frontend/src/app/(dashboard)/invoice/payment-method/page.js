"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import styles from "../invoicePages.module.css";

const PAGE_SIZES = [10, 25, 50];

export default function InvoicePaymentMethodPage() {
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/payment-methods");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load payment methods");
      setRows(Array.isArray(d.methods) ? d.methods : []);
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
    return subscribeCrmLive(["invoices:changed"], () => load());
  }, [isLoaded, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.method || "").toLowerCase().includes(q));
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
    setName("");
    setModal({ mode: "add" });
  }

  function openEdit(row) {
    setName(row.method || "");
    setModal({ mode: "edit", id: row.id });
  }

  async function saveMethod(e) {
    e.preventDefault();
    const method = name.trim();
    if (!method) {
      setErr("Method name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isEdit = modal?.mode === "edit";
      const res = await apiFetch(isEdit ? `/v2/payment-methods/${modal.id}` : "/v2/payment-methods", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify({ method }),
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
    const msg = buildDeleteMessage({ singular: "payment method", name: row.method });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    setErr(null);
    try {
      const res = await apiFetch(`/v2/payment-methods/${row.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Delete failed");
      await load();
    } catch (ex) {
      setErr(ex.message || "Delete failed");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pmHead}>
        <h1 className={styles.title}>Payment Method</h1>
        <div className={styles.pmHeadActions}>
          {searchOpen ? (
            <input
              className={styles.input}
              autoFocus
              placeholder="Search method"
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
            + Add Payment Method
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
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className={styles.empty}>
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
                      </div>
                    </td>
                    <td>{row.method}</td>
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
              <h2>{modal.mode === "edit" ? "Edit Payment Method" : "Add Payment Method"}</h2>
              <button type="button" className={styles.payClose} onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <form onSubmit={saveMethod} className={styles.payModalBody}>
              <label className={styles.label}>Method</label>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Google Pay"
                autoFocus
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
