"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, getApiOrigin } from "@/lib/api";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import styles from "./notes.module.css";

function fmt(dt) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(dt);
  }
}

function noteTypeLabel(n) {
  return n.lead_id ? "Lead note" : "Note";
}

function previewText(content, max = 140) {
  const s = String(content || "").replace(/\s+/g, " ").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const ROWS_PER_PAGE_OPTS = [5, 10, 25, 50];

export default function NotesPage() {
  const { confirm } = useConfirmDialog();
  const { open: openQuickCreate } = useQuickCreate();
  const { isLoaded, isSignedIn } = useAuth();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [pageInput, setPageInput] = useState("1");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [viewNote, setViewNote] = useState(null);
  const [editNote, setEditNote] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  const [liveConnected, setLiveConnected] = useState(false);
  const [realtimeToast, setRealtimeToast] = useState(null);
  const toastClearRef = useRef(null);
  const loadRef = useRef(() => {});

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced, limit]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("page", String(page));
    if (searchDebounced) p.set("search", searchDebounced);
    return p.toString();
  }, [limit, page, searchDebounced]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/v2/notes?${queryString}`);
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const d = await res.json();
      setItems(Array.isArray(d.notes) ? d.notes : []);
      setTotal(Number(d.total) || 0);
    } catch (e) {
      setErr(e.message || "Failed to load notes");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, queryString]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (!isLoaded) {
      setLiveConnected(false);
      return;
    }
    if (isSignedIn === false) {
      setLiveConnected(false);
      return;
    }
    let cancelled = false;
    const sockRef = { current: null };
    let retryTimer;

    function cleanupSocket() {
      if (sockRef.current) {
        try {
          sockRef.current.removeAllListeners();
          sockRef.current.disconnect();
        } catch {
          /* ignore */
        }
        sockRef.current = null;
      }
    }

    function showRealtimeToast(msg) {
      if (cancelled) return;
      if (toastClearRef.current) clearTimeout(toastClearRef.current);
      setRealtimeToast(msg);
      toastClearRef.current = setTimeout(() => {
        setRealtimeToast(null);
        toastClearRef.current = null;
      }, 4000);
    }

    async function connectOnce() {
      if (cancelled || !isSignedIn) return false;

      try {
        const { io } = await import("socket.io-client");
        cleanupSocket();
        const s = io(getApiOrigin(), {
          path: "/socket.io",
          auth: {},
          transports: ["websocket", "polling"],
          withCredentials: true,
          reconnection: true,
          reconnectionAttempts: 12,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
        });
        sockRef.current = s;

        s.io.on("reconnect_attempt", async () => {
          /* cookie session */
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
        s.on("notes:changed", () => {
          if (cancelled) return;
          showRealtimeToast("Notes updated in real time.");
          loadRef.current?.();
        });
        return true;
      } catch {
        if (!cancelled) setLiveConnected(false);
        return false;
      }
    }

    async function connectLoop(attempt = 0) {
      if (cancelled) return;
      const ok = await connectOnce();
      if (cancelled) return;
      if (!ok && attempt < 30) {
        retryTimer = setTimeout(() => connectLoop(attempt + 1), 400);
      }
    }

    connectLoop();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (toastClearRef.current) clearTimeout(toastClearRef.current);
      setLiveConnected(false);
      cleanupSocket();
    };
  }, [isLoaded, isSignedIn]);

  const totalPages = Math.max(1, Math.ceil((total || 0) / limit) || 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(page * limit, total);

  function openEdit(n) {
    setEditErr("");
    setEditNote(n);
    setEditTitle(n.title?.trim() || "");
    setEditContent(String(n.content || ""));
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editNote) return;
    setEditErr("");
    const body = editContent.trim();
    if (!body) {
      setEditErr("Content is required.");
      return;
    }
    setEditSaving(true);
    try {
      const res = await apiFetch(`/v2/notes/${editNote.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editTitle.trim() || null,
          content: body,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setEditErr(j.message || "Could not save");
        return;
      }
      setEditNote(null);
      await load();
    } catch {
      setEditErr("Network error");
    } finally {
      setEditSaving(false);
    }
  }

  async function remove(n) {
    const msg = buildDeleteMessage({
      singular: "note",
      name: n.title?.trim() || previewText(n.content, 40),
    });
    if (!(await confirm({ title: msg.title, description: msg.description }))) return;
    try {
      const res = await apiFetch(`/v2/notes/${n.id}`, { method: "DELETE" });
      if (!res.ok) {
        setErr("Could not delete note");
        return;
      }
      const wasLastOnPage = items.length === 1 && page > 1;
      if (wasLastOnPage) setPage((p) => Math.max(1, p - 1));
      else await load();
    } catch {
      setErr("Could not delete note");
    }
  }

  function commitPageInput() {
    const n = Math.max(1, Math.min(totalPages, parseInt(pageInput, 10) || 1));
    setPage(n);
    setPageInput(String(n));
  }

  return (
    <div className={styles.wrap}>
      {realtimeToast ? (
        <div className={styles.realtimeToast} role="status" aria-live="polite">
          {realtimeToast}
        </div>
      ) : null}

      <div className={styles.headRow}>
        <div>
          <h1 className={styles.title}>
            Notes
            </h1>
        </div>
      </div>

      <div className={styles.toolbarRow}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            placeholder="Search notes, titles, linked lead…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search notes"
          />
        </div>
        <div className={styles.iconGroup}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
            title="Add note"
            aria-label="Add note"
            onClick={() => openQuickCreate("note")}
          >
            <i className="fas fa-plus" aria-hidden />
          </button>
        </div>
      </div>

      {err ? (
        <div className={styles.errorBox}>
          {err}{" "}
          <button type="button" className={styles.backLink} onClick={load}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          No notes match your filters.{" "}
          <button type="button" className={styles.backLink} onClick={() => openQuickCreate("note")}>
            Add a note
          </button>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.mono} style={{ width: 56 }}>
                  No.
                </th>
                <th>Note</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n, idx) => (
                <tr key={n.id}>
                  <td className={styles.mono}>{(page - 1) * limit + idx + 1}</td>
                  <td className={styles.noteCell}>
                    <strong>{n.title?.trim() || "Untitled"}</strong>
                    <div className={styles.muted} style={{ marginTop: 4 }}>
                      {previewText(n.content)}
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.typeBadge} ${n.lead_id ? styles.typeLead : ""}`}>
                      {noteTypeLabel(n)}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actionsCell}>
                      <button
                        type="button"
                        className={`${styles.actionIcon} ${styles.actionEdit}`}
                        title="Edit"
                        aria-label="Edit note"
                        onClick={() => openEdit(n)}
                      >
                        <i className="fas fa-pen" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionIcon} ${styles.actionDel}`}
                        title="Delete"
                        aria-label="Delete note"
                        onClick={() => remove(n)}
                      >
                        <i className="fas fa-trash" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionIcon} ${styles.actionView}`}
                        title="View"
                        aria-label="View note"
                        onClick={() => setViewNote(n)}
                      >
                        <i className="fas fa-eye" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading ? (
        <div className={styles.paginationBar}>
          <div className={styles.perPage}>
            <span>Rows per page</span>
            <select
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value) || 10)}
              aria-label="Rows per page"
            >
              {ROWS_PER_PAGE_OPTS.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <span className={styles.mono}>
            {rangeStart} – {rangeEnd} of {total}
          </span>
          <div className={styles.pageNav}>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage(1)}
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              ‹
            </button>
            <input
              className={styles.pageInput}
              aria-label="Page number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPageInput();
                }
              }}
            />
            <span className={styles.muted}>of {totalPages}</span>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              ›
            </button>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      ) : null}

      <p className={styles.footerCopy}>Copyright © {new Date().getFullYear()} FitnessVitness CRM. All rights reserved.</p>

      {viewNote ? (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal
          aria-labelledby="note-view-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewNote(null);
          }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="note-view-title" className={styles.modalTitle}>
              {viewNote.title?.trim() || "Note"}
            </h2>
            <div className={styles.modalBody}>{viewNote.content || "—"}</div>
            <div className={styles.modalMeta}>
              <div>Type: {noteTypeLabel(viewNote)}</div>
              {viewNote.lead_name ? <div>Lead: {viewNote.lead_name}</div> : null}
              <div>Created: {fmt(viewNote.created_at)}</div>
              <div>Updated: {fmt(viewNote.updated_at)}</div>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnCancel} onClick={() => setViewNote(null)}>
                Close
              </button>
              <button
                type="button"
                className={styles.btnSubmit}
                onClick={() => {
                  setViewNote(null);
                  openEdit(viewNote);
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editNote ? (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal
          aria-labelledby="note-edit-heading"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditNote(null);
          }}
        >
          <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={submitEdit}>
            <h2 id="note-edit-heading" className={styles.modalTitle}>
              Edit note
            </h2>
            {editErr ? <p className={styles.modalErr}>{editErr}</p> : null}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="note-edit-title-input">
                Title (optional)
              </label>
              <input
                id="note-edit-title-input"
                className={styles.input}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="note-edit-content">
                Content
              </label>
              <textarea
                id="note-edit-content"
                className={styles.textarea}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                required
              />
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnCancel} onClick={() => setEditNote(null)} disabled={editSaving}>
                Cancel
              </button>
              <button type="submit" className={styles.btnSubmit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
