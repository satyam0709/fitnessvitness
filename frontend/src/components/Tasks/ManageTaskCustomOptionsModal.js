"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import styles from "@/components/Leads/ManageCustomOptionsModal.module.css";

const TABS = [
  { key: "task_category", label: "Categories", singular: "Category" },
];

function ConfirmDeleteOptionModal({ fieldMeta, optionValue, onCancel, onConfirm, saving }) {
  const [typed, setTyped] = useState("");
  const canDelete = typed === "DELETE";
  const singular = fieldMeta?.singular || "option";

  return (
    <div
      className={`${styles.overlay} ${styles.confirmOverlay}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-option-title"
      onClick={onCancel}
    >
      <div className={styles.dangerModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dangerHeader}>
          <h2 id="confirm-delete-option-title" className={styles.dangerTitle}>
            <i className="fas fa-triangle-exclamation" aria-hidden />
            Confirm delete
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onCancel} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className={styles.dangerBody}>
          <p className={styles.dangerLead}>
            Deleting the custom {singular.toLowerCase()} <strong>&apos;{optionValue}&apos;</strong>{" "}
            is a destructive action.
          </p>
          <div className={styles.dangerAlert}>
            <strong>
              Warning: All tasks currently using this category will be reverted to "General".
            </strong>
          </div>
          <label className={styles.dangerLabel} htmlFor="confirm-delete-option">
            Type DELETE to confirm:
          </label>
          <input
            id="confirm-delete-option"
            className={styles.dangerInput}
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type DELETE"
            disabled={saving}
          />
        </div>
        <div className={styles.dangerFooter}>
          <button type="button" className={styles.btnCancel} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            disabled={!canDelete || saving}
            onClick={onConfirm}
          >
            {saving ? "Deleting…" : "Permanently Delete Option"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManageTaskCustomOptionsModal({ onClose, onDone }) {
  const [mounted, setMounted] = useState(false);
  const [registry, setRegistry] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeField, setActiveField] = useState("task_category");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (deleteTarget) {
        setDeleteTarget(null);
        return;
      }
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTarget, onClose]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/tasks/custom-options");
      const json = await res.json();
      if (json.success) {
        setRegistry(json.registry || json.data || {});
      }
    } catch {
      setErr("Failed to load custom options");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const activeTab = TABS.find((t) => t.key === activeField) || TABS[0];
  const currentItems = registry[activeField] || [];

  async function handleRename(fieldName, oldValue) {
    const newVal = editValue.trim();
    if (!newVal || newVal === oldValue) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch("/tasks/custom-options/rename", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName, oldValue, newValue: newVal }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Rename failed");
        return;
      }
      showToast(`Renamed "${oldValue}" → "${newVal}"`);
      setEditingId(null);
      await fetchOptions();
      onDone?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(fieldName, optionValue) {
    setSaving(true);
    setErr("");
    try {
      const res = await apiFetch("/tasks/custom-options", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName, optionValue }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErr(json.message || "Delete failed");
        return;
      }
      showToast(`Deleted "${optionValue}"`);
      setDeleteTarget(null);
      await fetchOptions();
      onDone?.();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-custom-options-title"
        onClick={() => {
          if (!deleteTarget) onClose?.();
        }}
      >
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 id="manage-custom-options-title" className={styles.title}>
              Manage Task Options
            </h2>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <i className="fas fa-times" />
            </button>
          </div>

          <div className={styles.tabs}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`${styles.tab} ${activeField === tab.key ? styles.tabActive : ""}`}
                onClick={() => {
                  setActiveField(tab.key);
                  setEditingId(null);
                  setErr("");
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.body}>
            <p className={styles.hint}>
              All custom task categories you have created are listed here.
            </p>

            {err && <p className={styles.err}>{err}</p>}
            {toast && <p className={styles.toast}>{toast}</p>}

            {loading ? (
              <div className={styles.empty}>
                <i className="fas fa-spinner fa-spin" />
                <span>Loading…</span>
              </div>
            ) : currentItems.length === 0 ? (
              <div className={styles.empty}>
                <i className="fas fa-inbox" />
                <span>No custom {activeTab.label.toLowerCase()} yet.</span>
                <small>Create one by picking &quot;Other&quot; when creating a task.</small>
              </div>
            ) : (
              <ul className={styles.list}>
                {currentItems.map((item) => {
                  const isEditing = editingId === item.id;
                  return (
                    <li key={item.id} className={styles.row}>
                      {isEditing ? (
                        <>
                          <input
                            autoFocus
                            className={styles.editInput}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename(activeField, item.value);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <button
                            type="button"
                            className={styles.iconSave}
                            disabled={saving}
                            onClick={() => handleRename(activeField, item.value)}
                            title="Save"
                          >
                            <i className="fas fa-check" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconCancel}
                            onClick={() => setEditingId(null)}
                            title="Cancel"
                          >
                            <i className="fas fa-times" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={styles.optionLabel}>{item.label}</span>
                          <button
                            type="button"
                            className={styles.iconEdit}
                            title="Rename"
                            onClick={() => {
                              setEditingId(item.id);
                              setEditValue(item.label);
                            }}
                          >
                            <i className="fas fa-pencil" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconDelete}
                            title="Delete"
                            onClick={() =>
                              setDeleteTarget({
                                fieldName: activeField,
                                optionValue: item.value,
                              })
                            }
                          >
                            <i className="fas fa-trash" />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.btnClose} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDeleteOptionModal
          fieldMeta={TABS.find((t) => t.key === deleteTarget.fieldName)}
          optionValue={deleteTarget.optionValue}
          saving={saving}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget.fieldName, deleteTarget.optionValue)}
        />
      )}
    </>,
    document.body
  );
}
