"use client";

import LeadForm from "./LeadForm";
import styles from "./AddLeadModal.module.css";

export default function AddLeadModal({ open, onClose, onCreated }) {
  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="add-lead-title">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="add-lead-title" className={styles.title}>
            Add Lead
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <LeadForm
          mode="create"
          onCancel={onClose}
          onSuccess={(data) => {
            onCreated?.(data);
            onClose?.();
          }}
        />
      </div>
    </div>
  );
}
