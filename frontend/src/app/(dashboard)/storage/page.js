"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import {
  useConfirmDialog,
  buildDeleteMessage,
} from "@/components/ConfirmDialog/ConfirmDialogContext";
import inv from "../invoice/invoicePages.module.css";
import dash from "../dashboard/dashboard.module.css";
import styles from "./storage.module.css";

const MODULE_META = {
  lead: { icon: "fa-user", color: "#3b82f6", label: "Lead" },
  lead_followup: { icon: "fa-phone", color: "#0ea5e9", label: "Lead Followup" },
  todo: { icon: "fa-clipboard-list", color: "#0ea5e9", label: "To Do" },
  brochure: { icon: "fa-book-open", color: "#f59e0b", label: "Brochure" },
  company_assets: { icon: "fa-image", color: "#a855f7", label: "Company Assets" },
  chat: { icon: "fa-comments", color: "#8b5cf6", label: "Chat" },
};

const MODULE_OPTIONS = [{ key: "all", label: "All" }, ...Object.entries(MODULE_META).map(([key, m]) => ({ key, label: m.label }))];
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

function formatMb(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

function fileExt(file) {
  const fromApi = String(file?.ext || "").toLowerCase().replace(/^\./, "");
  if (fromApi) return fromApi;
  const name = String(file?.file_name || file?.file_url || "");
  const m = name.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return m ? m[1] : "file";
}

function typeColor(ext) {
  if (IMAGE_EXTS.has(ext)) return "#f59e0b";
  if (["pdf", "doc", "docx"].includes(ext)) return "#3b82f6";
  if (["csv", "xls", "xlsx"].includes(ext)) return "#22c55e";
  return "#64748b";
}

function typeIcon(ext) {
  if (IMAGE_EXTS.has(ext)) return "fa-image";
  if (ext === "pdf") return "fa-file-pdf";
  if (["doc", "docx"].includes(ext)) return "fa-file-word";
  if (["csv", "xls", "xlsx"].includes(ext)) return "fa-file-csv";
  return "fa-file";
}

function UsageGauge({ percent }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const offset = c - (p / 100) * c;
  const hot = p >= 90;
  const stroke = hot ? "#ef4444" : "var(--yellow, var(--brand-primary))";
  return (
    <div className={styles.gaugeWrap}>
      <svg viewBox="0 0 140 140" className={styles.gaugeSvg} aria-hidden>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--bg-hover, #eef1f7)" strokeWidth="12" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
        />
      </svg>
      <div className={styles.gaugeLabel}>
        <span className={styles.gaugePct}>{`${Math.round(p)}%`}</span>
        <span className={styles.gaugeHint}>Used</span>
      </div>
    </div>
  );
}

function FileThumb({ file }) {
  const ext = fileExt(file);
  return (
    <div className={styles.thumb}>
      <i className={`fas ${typeIcon(ext)} ${styles.thumbIcon}`} />
    </div>
  );
}

function PreviewBody({ file }) {
  const ext = fileExt(file);
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let blobUrl = null;
    let cancelled = false;
    setSrc(null);
    setErr(null);
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/v2/storage/content?path=${encodeURIComponent(file.file_url)}`);
        const type = String(res.headers.get("content-type") || "");
        if (!res.ok || type.includes("application/json")) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.message || "Could not open this file");
        }
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(blobUrl);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Could not open this file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file.file_url]);

  if (loading) return <p className={styles.lightboxStatus}>Loading preview…</p>;
  if (err) return <p className={styles.lightboxErr}>{err}</p>;
  if (ext === "pdf") {
    return <iframe className={styles.lightboxFrame} title={file.file_name || "PDF"} src={src} />;
  }
  return <img className={styles.lightboxImg} src={src} alt={file.file_name || "Preview"} />;
}

export default function StoragePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded } = useAuth();
  const { confirm } = useConfirmDialog();
  const moduleParam = String(searchParams.get("module") || "").trim();
  const typeParam = String(searchParams.get("type") || "").trim().toLowerCase();
  const validModule = moduleParam === "all" || MODULE_META[moduleParam] ? moduleParam : "";
  const inBrowser = Boolean(validModule);

  const [files, setFiles] = useState([]);
  const [modules, setModules] = useState([]);
  const [usage, setUsage] = useState({
    used_mb: 0,
    total_mb: 1024,
    free_mb: 1024,
    percent_used: 0,
    active_modules: 0,
    used_bytes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [previewMounted, setPreviewMounted] = useState(false);

  useEffect(() => {
    setPreviewMounted(true);
  }, []);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [preview]);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/v2/storage");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Failed to load storage");
      setFiles((d.files || []).filter((f) => f.module !== "storage_files"));
      setModules((d.modules || []).filter((m) => m.key !== "storage_files"));
      setUsage(
        d.usage || {
          used_mb: 0,
          total_mb: 1024,
          free_mb: 1024,
          percent_used: 0,
          active_modules: 0,
          used_bytes: 0,
        }
      );
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
    if (!isLoaded) return undefined;
    return subscribeCrmLive(
      [
        "storage:changed",
        "brochures:changed",
        "invoices:changed",
        "todos:changed",
        "notes:changed",
        "meetings:changed",
      ],
      () => load()
    );
  }, [isLoaded, load]);

  const goBrowser = useCallback(
    (modKey, typeKey) => {
      const params = new URLSearchParams();
      if (modKey) params.set("module", modKey);
      if (typeKey) params.set("type", typeKey);
      const q = params.toString();
      router.push(q ? `/storage?${q}` : "/storage");
    },
    [router]
  );

  const moduleFiles = useMemo(() => {
    if (!validModule || validModule === "all") return files;
    return files.filter((f) => f.module === validModule);
  }, [files, validModule]);

  const typeCounts = useMemo(() => {
    const map = new Map();
    for (const f of moduleFiles) {
      const ext = fileExt(f);
      map.set(ext, (map.get(ext) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [moduleFiles]);

  const visibleFiles = useMemo(() => {
    if (!typeParam) return moduleFiles;
    return moduleFiles.filter((f) => fileExt(f) === typeParam);
  }, [moduleFiles, typeParam]);

  useEffect(() => {
    setSelected((prev) => {
      const urls = new Set(visibleFiles.map((f) => f.file_url));
      const next = new Set();
      prev.forEach((u) => {
        if (urls.has(u)) next.add(u);
      });
      return next;
    });
  }, [visibleFiles]);

  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((f) => selected.has(f.file_url));

  function toggleOne(url) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (allVisibleSelected) setSelected(new Set());
    else setSelected(new Set(visibleFiles.map((f) => f.file_url)));
  }

  async function deletePaths(paths) {
    const list = [...new Set(paths.filter(Boolean))];
    if (!list.length) return;
    const msg = buildDeleteMessage({
      singular: "file",
      plural: "files",
      count: list.length,
      name: list.length === 1 ? list[0].split("/").pop() : "",
    });
    const ok = await confirm({ title: msg.title, description: msg.description });
    if (!ok) return;
    const res = await apiFetch("/v2/storage/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ paths: list }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(d.message || "Failed to delete files");
      return;
    }
    setSelected(new Set());
    load();
  }

  function openFile(file) {
    const ext = fileExt(file);
    if (IMAGE_EXTS.has(ext) || ext === "pdf") {
      setPreview(file);
    }
  }

  async function downloadFile(file) {
    try {
      const res = await apiFetch(`/v2/storage/content?path=${encodeURIComponent(file.file_url)}&download=1`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name || "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || "Download failed");
    }
  }

  const metricCards = useMemo(() => {
    const used = formatMb(usage.used_mb);
    return [
      {
        label: "Total",
        value: `${formatMb(usage.total_mb)} MB`,
        sub: "Workspace quota",
        color: "#3b82f6",
        icon: "fa-database",
      },
      {
        label: "Used",
        value: `${used} MB`,
        sub: `${formatSize(usage.used_bytes)} on disk`,
        color: "#14b8a6",
        icon: "fa-hard-drive",
      },
      {
        label: "Free",
        value: `${formatMb(usage.free_mb)} MB`,
        sub: "Left in plan",
        color: "#22c55e",
        icon: "fa-box-open",
      },
      {
        label: "Active modules",
        value: String(usage.active_modules || 0),
        sub: `${modules.length} tracked`,
        color: "#a855f7",
        icon: "fa-cubes",
      },
    ];
  }, [modules.length, usage]);

  if (!isLoaded) {
    return (
      <div className={styles.page}>
        <p className={inv.sub}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {err && <p className={inv.err}>{err}</p>}

      {!inBrowser ? (
        <>
          <div className={inv.pageHead}>
            <div>
              <h1 className={inv.title}>Storage Overview</h1>
              <p className={inv.sub}>Files from leads, to-dos, brochures, and invoice branding.</p>
            </div>
            <button type="button" className={inv.btnGhost} onClick={load} disabled={loading}>
              Refresh
            </button>
          </div>

          <div className={styles.summary}>
            <button
              type="button"
              className={`${dash.statCard} ${styles.gaugeCard} ${styles.clickable}`}
              onClick={() => goBrowser("all")}
            >
              <UsageGauge percent={usage.percent_used} />
              <span className={dash.statLabel}>
                {`${formatMb(usage.used_mb)} of ${formatMb(usage.total_mb)} MB`}
              </span>
            </button>
            <div className={dash.statsGrid}>
              {metricCards.map((card) => (
                <button
                  type="button"
                  key={card.label}
                  className={`${dash.statCard} ${styles.clickable}`}
                  onClick={() => goBrowser("all")}
                >
                  <div className={dash.statTop}>
                    <div className={dash.statInfo}>
                      <span className={dash.statLabel}>{card.label}</span>
                      <span className={dash.statValue}>{card.value}</span>
                    </div>
                    <div className={dash.statIcon} style={{ color: card.color, background: `${card.color}18` }}>
                      <i className={`fas ${card.icon}`} />
                    </div>
                  </div>
                  <div className={dash.statMeta}>
                    <span className={dash.statSubBadge} style={{ background: `${card.color}22`, color: card.color }}>
                      {card.sub}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <h2 className={styles.sectionTitle}>Modules</h2>
          <div className={styles.moduleGrid}>
            {modules.length === 0 && !loading ? (
              <p className={inv.sub}>No files stored yet.</p>
            ) : null}
            {modules.map((mod) => {
              const meta = MODULE_META[mod.key] || { icon: "fa-folder", color: "#64748b", label: mod.label };
              return (
                <button
                  type="button"
                  key={mod.key}
                  className={`${inv.card} ${styles.moduleCard} ${styles.clickable}`}
                  onClick={() => goBrowser(mod.key)}
                >
                  <div className={styles.moduleTop}>
                    <div className={styles.moduleIcon} style={{ color: meta.color, background: `${meta.color}18` }}>
                      <i className={`fas ${meta.icon}`} />
                    </div>
                    <span className={styles.moduleCount}>{mod.file_count || 0}</span>
                  </div>
                  <div>
                    <div className={styles.moduleName}>{mod.label || meta.label || mod.key}</div>
                    <div className={styles.moduleMeta}>{formatMb(mod.used_mb)} MB</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className={styles.browserBar}>
            <div className={styles.browserLeft}>
              <button type="button" className={styles.backBtn} onClick={() => router.push("/storage")} aria-label="Back">
                <i className="fas fa-arrow-left" />
              </button>
              <select
                className={styles.moduleSelect}
                value={validModule}
                onChange={(e) => goBrowser(e.target.value)}
                aria-label="Storage module"
              >
                {MODULE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className={styles.totalBadge}>Total Attachments: {moduleFiles.length}</span>
            </div>
            <div className={styles.browserActions}>
              <label className={styles.selectAll}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={!visibleFiles.length} />
                Select all
              </label>
              <button
                type="button"
                className={styles.trashBtn}
                disabled={!selected.size}
                onClick={() => deletePaths([...selected])}
                aria-label="Delete selected"
              >
                <i className="fas fa-trash" />
              </button>
            </div>
          </div>

          {typeCounts.length > 0 ? (
            <div className={styles.typeRow}>
              {typeCounts.map(([ext, count]) => {
                const color = typeColor(ext);
                const active = typeParam === ext;
                return (
                  <button
                    type="button"
                    key={ext}
                    className={`${styles.typeChip} ${active ? styles.typeChipActive : ""}`}
                    style={{ background: `${color}22` }}
                    onClick={() => goBrowser(validModule, active ? "" : ext)}
                  >
                    <span className={styles.typeIcon} style={{ color }}>
                      <i className={`fas ${typeIcon(ext)}`} />
                    </span>
                    <span className={styles.typeMeta}>
                      <span className={styles.typeExt}>{ext}</span>
                      <span className={styles.typeCount}>{count} items</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {loading && visibleFiles.length === 0 ? (
            <p className={inv.sub}>Loading…</p>
          ) : visibleFiles.length === 0 ? (
            <div className={inv.empty}>No files in this section.</div>
          ) : (
            <div className={styles.fileGrid}>
              {visibleFiles.map((f) => (
                <article key={f.file_url} className={styles.fileCard}>
                  <input
                    type="checkbox"
                    className={styles.fileCheck}
                    checked={selected.has(f.file_url)}
                    onChange={() => toggleOne(f.file_url)}
                    aria-label={`Select ${f.file_name || "file"}`}
                  />
                  <FileThumb file={f} />
                  <div className={styles.fileBody}>
                    <div className={styles.fileName} title={f.file_name || f.file_url}>
                      {f.file_name || "file"}
                    </div>
                    <div className={styles.fileDate}>{formatDate(f.created_at)}</div>
                    <div className={styles.fileActions}>
                      <button type="button" className={styles.iconAction} onClick={() => openFile(f)} aria-label="View">
                        <i className="fas fa-eye" />
                      </button>
                      <button type="button" className={styles.iconAction} onClick={() => downloadFile(f)} aria-label="Download">
                        <i className="fas fa-download" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {preview && previewMounted
        ? createPortal(
            <div className={styles.lightbox} onClick={() => setPreview(null)} role="presentation">
              <div
                className={styles.lightboxDialog}
                role="dialog"
                aria-modal="true"
                aria-label={preview.file_name || "Preview"}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.lightboxHead}>
                  <span className={styles.lightboxTitle} title={preview.file_name || ""}>
                    {preview.file_name || "Preview"}
                  </span>
                  <button type="button" className={styles.lightboxClose} onClick={() => setPreview(null)} aria-label="Close">
                    <i className="fas fa-xmark" />
                  </button>
                </div>
                <div className={styles.lightboxBody}>
                  <PreviewBody file={preview} />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
