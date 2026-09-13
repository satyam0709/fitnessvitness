"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "@/components/Leads/ManageCustomOptionsModal.module.css";
import {
  FOLLOWUP_TYPES,
  LEAD_SOURCES,
  OPPORTUNITY_TYPES,
  PRODUCT_CATEGORIES,
  mergeOptionList,
} from "@/lib/opportunityConstants";

const TAB_CONFIG = [
  { key: "product_category", label: "Purpose of visit", singular: "purpose" },
  { key: "followup_type", label: "Follow-up types", singular: "follow-up type" },
  { key: "opportunity_type", label: "Opportunity types", singular: "opportunity type" },
  { key: "source", label: "Lead sources", singular: "lead source" },
];

const STANDARD_OPTIONS = {
  product_category: PRODUCT_CATEGORIES,
  followup_type: FOLLOWUP_TYPES,
  opportunity_type: OPPORTUNITY_TYPES,
  source: LEAD_SOURCES,
};

function ConfirmDeleteOptionModal({
  fieldMeta,
  optionValue,
  transferOptions,
  usage,
  usageError,
  loadingUsage,
  onCancel,
  onConfirm,
  saving,
}) {
  const [transferTo, setTransferTo] = useState("");
  const needsTransfer = Boolean(usage?.total > 0);
  const canDelete =
    !loadingUsage &&
    !usageError &&
    (!needsTransfer || (transferTo && transferTo !== optionValue));
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
            Remove the custom {singular} <strong>&apos;{optionValue}&apos;</strong>?
          </p>
          {loadingUsage ? (
            <p className={styles.dangerLead}>Checking usage…</p>
          ) : usageError ? (
            <div className={styles.dangerAlert}>
              <strong>{usageError}</strong>
            </div>
          ) : needsTransfer ? (
            <>
              <div className={styles.dangerAlert}>
                <strong>
                  {usage.total} opportunity record(s) use this value. They will be transferred,
                  not deleted.
                </strong>
              </div>
              <label className={styles.dangerLabel} htmlFor="opp-option-transfer">
                Transfer to
              </label>
              <select
                id="opp-option-transfer"
                className={styles.dangerInput}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                disabled={saving}
              >
                <option value="">Select target option</option>
                {transferOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label || opt.value}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className={styles.dangerLead}>No records use this option. It can be removed safely.</p>
          )}
        </div>
        <div className={styles.dangerFooter}>
          <button type="button" className={styles.btnCancel} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            disabled={!canDelete || saving}
            onClick={() => onConfirm(needsTransfer ? transferTo : undefined)}
          >
            {saving ? "Removing…" : needsTransfer ? "Transfer & Remove" : "Remove Option"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManageOpportunityCustomOptionsModal({
  open,
  onClose,
  customOptions,
  onRefresh,
}) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState("product_category");
  const [editingItem, setEditingItem] = useState(null);
  const [savingRename, setSavingRename] = useState(false);
  const [deletingItem, setDeletingItem] = useState(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [addValueError, setAddValueError] = useState("");
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState("");
  const [loadingUsage, setLoadingUsage] = useState(false);

  if (!open || typeof document === "undefined") return null;

  const currentOptions = customOptions[activeTab] || [];
  const transferOptions = mergeOptionList(
    STANDARD_OPTIONS[activeTab] || [],
    customOptions[activeTab] || []
  ).filter((opt) => opt.value !== deletingItem?.optionValue);
  const activeTabMeta = TAB_CONFIG.find((t) => t.key === activeTab) || TAB_CONFIG[0];

  const resetAdd = () => {
    setNewValue("");
    setNewLabel("");
    setAddValueError("");
  };

  const handleRename = async () => {
    if (!editingItem || !editingItem.newValue.trim()) return;
    setSavingRename(true);
    try {
      const res = await apiFetch("/opportunities/custom-options/rename", {
        method: "PUT",
        body: JSON.stringify({
          fieldName: activeTab,
          oldValue: editingItem.oldValue,
          newValue: editingItem.newValue.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Option renamed");
        setEditingItem(null);
        onRefresh?.();
      } else {
        showToast(data.message || "Failed to rename option", "error");
      }
    } catch {
      showToast("Error renaming option", "error");
    } finally {
      setSavingRename(false);
    }
  };

  const openDelete = async (optionValue) => {
    setDeletingItem({ fieldName: activeTab, optionValue });
    setShowConfirmDelete(true);
    setUsage(null);
    setUsageError("");
    setLoadingUsage(true);
    try {
      const params = new URLSearchParams({ fieldName: activeTab, optionValue });
      const res = await apiFetch(`/opportunities/custom-options/usage?${params.toString()}`);
      const data = await res.json();
      if (data.success) setUsage(data.data);
      else setUsageError(data.message || "Could not verify usage.");
    } catch {
      setUsageError("Could not verify usage.");
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleConfirmDelete = async (transferTo) => {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      const res = await apiFetch("/opportunities/custom-options", {
        method: "DELETE",
        body: JSON.stringify({
          fieldName: deletingItem.fieldName,
          optionValue: deletingItem.optionValue,
          ...(transferTo ? { transferTo } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || "Option removed");
        setShowConfirmDelete(false);
        setDeletingItem(null);
        onRefresh?.();
        return;
      }
      if (data.code === "TRANSFER_REQUIRED") {
        setUsage(data.usage || data.data);
        showToast(data.message || "Select a target option to transfer records", "error");
        return;
      }
      showToast(data.message || "Failed to delete option", "error");
    } catch {
      showToast("Error deleting option", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleAdd = async () => {
    const val = newValue.trim();
    if (!val) {
      setAddValueError("Value is required");
      return;
    }
    if (val.toLowerCase() === "other") {
      setAddValueError("Enter a real custom value");
      return;
    }
    setAddValueError("");
    setAdding(true);
    try {
      const res = await apiFetch("/opportunities/custom-options", {
        method: "POST",
        body: JSON.stringify({
          fieldName: activeTab,
          value: val,
          label: newLabel.trim() || val,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Option added");
        resetAdd();
        onRefresh?.();
      } else {
        showToast(data.message || "Failed to add option", "error");
      }
    } catch {
      showToast("Error adding option", "error");
    } finally {
      setAdding(false);
    }
  };

  return createPortal(
    <>
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-opp-options-title"
        onClick={() => {
          if (!showConfirmDelete) onClose?.();
        }}
      >
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 id="manage-opp-options-title" className={styles.title}>
              Manage Custom Options
            </h2>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <i className="fas fa-times" />
            </button>
          </div>

          <div className={styles.tabs}>
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setEditingItem(null);
                  resetAdd();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.body}>
            <p className={styles.hint}>
              Custom {activeTabMeta.label.toLowerCase()} are listed below. Removing an option
              transfers affected opportunities — records are never deleted.
            </p>

            {currentOptions.length === 0 ? (
              <div className={styles.empty}>
                <i className="fas fa-inbox" />
                <span>No custom {activeTabMeta.label.toLowerCase()} yet.</span>
              </div>
            ) : (
              <ul className={styles.list}>
                {currentOptions.map((opt) => {
                  const isEditing = editingItem && editingItem.oldValue === opt.value;
                  return (
                    <li key={opt.value} className={styles.row}>
                      {isEditing ? (
                        <>
                          <input
                            autoFocus
                            className={styles.editInput}
                            value={editingItem.newValue}
                            onChange={(e) =>
                              setEditingItem((prev) => ({ ...prev, newValue: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename();
                              if (e.key === "Escape") setEditingItem(null);
                            }}
                          />
                          <button
                            type="button"
                            className={styles.iconSave}
                            disabled={savingRename}
                            onClick={handleRename}
                            title="Save"
                          >
                            <i className="fas fa-check" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconCancel}
                            onClick={() => setEditingItem(null)}
                            title="Cancel"
                          >
                            <i className="fas fa-times" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={styles.optionLabel}>{opt.label || opt.value}</span>
                          <button
                            type="button"
                            className={styles.iconEdit}
                            title="Rename"
                            onClick={() =>
                              setEditingItem({ oldValue: opt.value, newValue: opt.label || opt.value })
                            }
                          >
                            <i className="fas fa-pencil" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconDelete}
                            title="Delete"
                            onClick={() => openDelete(opt.value)}
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

            <div className={styles.addRow}>
              <div className={styles.fieldStack}>
                <input
                  className={`${styles.editInput} ${addValueError ? styles.inputInvalid : ""}`}
                  placeholder="Custom value"
                  value={newValue}
                  onChange={(e) => {
                    setAddValueError("");
                    setNewValue(e.target.value);
                  }}
                />
                {addValueError ? <p className={styles.fieldError}>{addValueError}</p> : null}
              </div>
              <input
                className={styles.editInput}
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button type="button" className={styles.btnAdd} onClick={handleAdd} disabled={adding}>
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.btnClose} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {showConfirmDelete && deletingItem ? (
        <ConfirmDeleteOptionModal
          fieldMeta={activeTabMeta}
          optionValue={deletingItem.optionValue}
          transferOptions={transferOptions}
          usage={usage}
          usageError={usageError}
          loadingUsage={loadingUsage}
          saving={deleting}
          onCancel={() => {
            if (deleting) return;
            setShowConfirmDelete(false);
            setDeletingItem(null);
          }}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </>,
    document.body
  );
}
