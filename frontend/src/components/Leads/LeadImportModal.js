"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeCrmLive } from "@/lib/chatRealtime";
import { LEAD_IMPORT_FIELDS, leadImportTemplateCsv } from "@/components/Leads/leadConstants";
import styles from "./LeadImportModal.module.css";

const STEPS = [
  { id: "upload", label: "Upload" },
  { id: "preview", label: "Preview" },
  { id: "map", label: "Map" },
  { id: "validate", label: "Validate" },
  { id: "run", label: "Import" },
  { id: "done", label: "Done" },
];

const MODES = [
  { value: "upsert", label: "Upsert (recommended)", recommended: true },
  { value: "create_only", label: "Create only" },
  { value: "update_only", label: "Update only" },
];

export default function LeadImportModal({ open, onClose, onComplete }) {
  const [step, setStep] = useState("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState("upsert");
  const [validation, setValidation] = useState(null);
  const [history, setHistory] = useState([]);
  const [uploadPct, setUploadPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const importJobIdRef = useRef(null);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiFetch("/leads/import/jobs?limit=10");
      const json = await res.json();
      if (json.success) setHistory(json.jobs || []);
    } catch {
      /* ignore */
    }
  }, []);

  const reset = useCallback(() => {
    setStep("upload");
    setBusy(false);
    setError("");
    setJob(null);
    setHeaders([]);
    setPreviewRows([]);
    setMapping({});
    setMode("upsert");
    setValidation(null);
    setUploadPct(0);
    importJobIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    fetchHistory();
  }, [open, reset, fetchHistory]);

  useEffect(() => {
    if (!open || !job?.id) return;
    importJobIdRef.current = job.id;
    return subscribeCrmLive(["leads:import:progress"], (_event, payload) => {
      if (!payload) return;
      if (payload.jobId && payload.jobId !== importJobIdRef.current) return;
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: payload.status || prev.status,
              progress_pct: payload.progress_pct ?? prev.progress_pct,
              processed_rows: payload.summary?.processed ?? prev.processed_rows,
              created_count: payload.summary?.created ?? prev.created_count,
              updated_count: payload.summary?.updated ?? prev.updated_count,
              skipped_count: payload.summary?.skipped ?? prev.skipped_count,
              failed_count: payload.summary?.failed ?? prev.failed_count,
            }
          : prev
      );
      if (payload.status === "completed") {
        setStep("done");
        setBusy(false);
        onComplete?.();
      }
      if (payload.status === "failed" || payload.status === "cancelled") {
        setBusy(false);
        if (payload.status === "cancelled") setError("Import cancelled");
      }
    });
  }, [open, job?.id, onComplete]);

  async function refreshJob(jobId) {
    const res = await apiFetch(`/leads/import/jobs/${jobId}`);
    const json = await res.json();
    if (json.success && json.job) setJob(json.job);
    return json.job;
  }

  async function handleUpload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    setUploadPct(10);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setUploadPct(40);
      const res = await apiFetch("/leads/import/upload", { method: "POST", body: fd });
      setUploadPct(90);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Upload failed");
      setJob(json.job);
      setHeaders(json.headers || []);
      setPreviewRows(json.previewRows || []);
      setMapping(json.suggestedMapping || json.job?.column_mapping || {});
      importJobIdRef.current = json.job.id;
      setUploadPct(100);
      setStep("preview");
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function onFileInput(e) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  async function saveMapping() {
    if (!job?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/leads/import/jobs/${job.id}/mapping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column_mapping: mapping, mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to save mapping");
      setJob(json.job);
      setStep("validate");
    } catch (e) {
      setError(e.message || "Failed to save mapping");
    } finally {
      setBusy(false);
    }
  }

  async function runValidate() {
    if (!job?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/leads/import/jobs/${job.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Validation failed");
      setJob(json.job);
      setValidation(json.summary);
      setStep("run");
    } catch (e) {
      setError(e.message || "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function startImport() {
    if (!job?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/leads/import/jobs/${job.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, job_id: job.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Import failed");
      setJob(json.job);
    } catch (e) {
      setError(e.message || "Import failed");
      setBusy(false);
    }
  }

  async function cancelImport() {
    if (!job?.id) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/leads/import/jobs/${job.id}/cancel`, { method: "POST" });
      const json = await res.json();
      if (json.success) setJob(json.job);
    } catch (e) {
      setError(e.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function retryImport() {
    if (!job?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/leads/import/jobs/${job.id}/retry`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Retry failed");
      setJob(json.job);
      importJobIdRef.current = json.job.id;
      setValidation(null);
      setStep("validate");
    } catch (e) {
      setError(e.message || "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([leadImportTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lead-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadErrors() {
    if (!job?.id) return;
    apiFetch(`/leads/import/jobs/${job.id}/errors.csv`)
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `lead-import-errors-${job.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError("Failed to download errors"));
  }

  const previewColumns = useMemo(() => headers.slice(0, 8), [headers]);
  const isProcessing = job?.status === "processing" || job?.status === "validating";

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h2 className={styles.title}>Import Leads</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className={styles.stepBar}>
          {STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`${styles.stepItem} ${idx <= stepIndex ? styles.stepItemActive : ""}`}
            >
              <span className={styles.stepNum}>{idx + 1}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className={styles.body}>
          {step === "upload" && (
            <>
              <div
                className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <i className="fas fa-cloud-upload-alt" />
                <p>Drag & drop CSV or XLSX here</p>
                <button type="button" className={styles.btnSecondary} onClick={() => fileRef.current?.click()}>
                  Choose file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className={styles.hiddenInput}
                  onChange={onFileInput}
                />
              </div>
              {busy && (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${uploadPct}%` }} />
                </div>
              )}
              <button type="button" className={styles.linkBtn} onClick={downloadTemplate}>
                Download CSV template
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <p className={styles.meta}>
                {job?.file_name} — {job?.total_rows} rows detected
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {previewColumns.map((h, hi) => (
                        <th key={`col-${hi}`}>{h || `Column ${hi + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {previewColumns.map((h, hi) => (
                          <td key={`cell-${ri}-${hi}`}>{row[h] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === "map" && (
            <>
              <div className={styles.modeRow}>
                <label htmlFor="lead-import-mode">Import mode</label>
                <select id="lead-import-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.mappingGrid}>
                {LEAD_IMPORT_FIELDS.map((field) => (
                  <label key={field.key} className={styles.mappingRow}>
                    <span className={field.required ? styles.requiredLabel : ""}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </span>
                    <select
                      value={mapping[field.key] || ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))
                      }
                    >
                      <option value="">— Skip —</option>
                      {headers.map((h, hi) => (
                        <option key={`map-${hi}`} value={h}>
                          {h || `Column ${hi + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}

          {step === "validate" && (
            <>
              <p className={styles.meta}>Run validation to check rows before importing.</p>
              {validation && (
                <div className={styles.summaryGrid}>
                  <div>Valid: {validation.valid}</div>
                  <div>Invalid: {validation.invalid}</div>
                  <div>Duplicate/skipped: {validation.duplicate}</div>
                  <div>New: {validation.new}</div>
                  <div>Updates: {validation.update}</div>
                </div>
              )}
            </>
          )}

          {step === "run" && (
            <>
              {validation && (
                <div className={styles.summaryGrid}>
                  <div>Valid: {validation.valid ?? job?.valid_rows}</div>
                  <div>Invalid: {validation.invalid ?? job?.invalid_rows}</div>
                  <div>New: {validation.new ?? job?.new_rows}</div>
                  <div>Updates: {validation.update ?? job?.update_rows}</div>
                </div>
              )}
              {(isProcessing || busy) && (
                <div className={styles.progressWrap}>
                  <div
                    className={styles.progressBar}
                    style={{ width: `${job?.progress_pct || 0}%` }}
                  />
                  <span className={styles.progressLabel}>{job?.progress_pct || 0}%</span>
                </div>
              )}
              <div className={styles.summaryGrid}>
                <div>Processed: {job?.processed_rows ?? 0}</div>
                <div>Created: {job?.created_count ?? 0}</div>
                <div>Updated: {job?.updated_count ?? 0}</div>
                <div>Skipped: {job?.skipped_count ?? 0}</div>
                <div>Failed: {job?.failed_count ?? 0}</div>
              </div>
              {(job?.invalid_rows > 0 || job?.failed_count > 0) && (
                <button type="button" className={styles.linkBtn} onClick={downloadErrors}>
                  Download errors CSV
                </button>
              )}
            </>
          )}

          {step === "done" && (
            <>
              <div className={styles.doneBanner}>
                <i className="fas fa-check-circle" />
                <span>Import {job?.status === "cancelled" ? "cancelled" : "completed"}</span>
              </div>
              <div className={styles.summaryGrid}>
                <div>Created: {job?.created_count ?? 0}</div>
                <div>Updated: {job?.updated_count ?? 0}</div>
                <div>Skipped: {job?.skipped_count ?? 0}</div>
                <div>Failed: {job?.failed_count ?? 0}</div>
              </div>
              {job?.failed_count > 0 && (
                <button type="button" className={styles.btnSecondary} onClick={retryImport} disabled={busy}>
                  Retry failed rows
                </button>
              )}
              <div className={styles.historyBlock}>
                <h3>Recent imports</h3>
                <ul className={styles.historyList}>
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => {
                          setJob(h);
                          refreshJob(h.id);
                          setStep("done");
                        }}
                      >
                        {h.file_name} — {h.status} ({h.created_count}/{h.updated_count})
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {error ? <div className={styles.errorBox}>{error}</div> : null}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Close
          </button>
          <div className={styles.footerActions}>
            {step === "preview" && (
              <button type="button" className={styles.btnPrimary} onClick={() => setStep("map")}>
                Next: Map columns
              </button>
            )}
            {step === "map" && (
              <button type="button" className={styles.btnPrimary} onClick={saveMapping} disabled={busy}>
                Next: Validate
              </button>
            )}
            {step === "validate" && (
              <button type="button" className={styles.btnPrimary} onClick={runValidate} disabled={busy}>
                {busy ? "Validating..." : "Validate"}
              </button>
            )}
            {step === "run" && !isProcessing && job?.status !== "completed" && (
              <button type="button" className={styles.btnPrimary} onClick={startImport} disabled={busy}>
                Start import
              </button>
            )}
            {step === "run" && isProcessing && (
              <button type="button" className={styles.btnDanger} onClick={cancelImport} disabled={busy}>
                Cancel import
              </button>
            )}
            {step === "done" && (
              <button type="button" className={styles.btnPrimary} onClick={reset}>
                Import another file
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
