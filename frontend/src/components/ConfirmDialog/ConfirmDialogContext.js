"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./ConfirmDialog.module.css";

const ConfirmDialogContext = createContext(null);

/**
 * Copy for deleting one or many entities (tasks, leads, etc.).
 * @param {{ singular: string, plural?: string, name?: string | null, count?: number }} p
 */
export function buildDeleteMessage({ singular, plural, name, count }) {
  const pl = plural || `${singular}s`;
  if (count != null && count > 1) {
    return {
      title: `Delete ${count} ${pl}?`,
      description: `Are you sure you want to permanently delete ${count} ${pl}? This action cannot be undone.`,
    };
  }
  const trimmed = name != null ? String(name).trim() : "";
  const quoted =
    trimmed.length > 0
      ? ` “${trimmed.slice(0, 200)}${trimmed.length > 200 ? "…" : ""}”`
      : "";
  return {
    title: `Delete ${singular}?`,
    description: `Are you sure you want to delete the ${singular}${quoted}? This action cannot be undone.`,
  };
}

export function ConfirmDialogProvider({ children }) {
  const resolveRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [dialog, setDialog] = useState({
    open: false,
    title: "",
    description: "",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback((result) => {
    const r = resolveRef.current;
    resolveRef.current = null;
    setDialog((s) => ({ ...s, open: false }));
    r?.(result);
  }, []);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        open: true,
        title: opts.title ?? "Confirm",
        description: opts.description ?? "",
        confirmLabel: opts.confirmLabel ?? "Delete",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        destructive: opts.destructive !== false,
      });
    });
  }, []);

  useEffect(() => {
    if (!dialog.open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [dialog.open, close]);

  const modal =
    dialog.open && mounted ? (
      <div
        className={styles.overlay}
        role="presentation"
        onClick={() => close(false)}
      >
        <div
          className={styles.panel}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.header}>
            <h2 id="confirm-dialog-title" className={styles.title}>
              {dialog.title}
            </h2>
          </div>
          <p id="confirm-dialog-desc" className={styles.body}>
            {dialog.description}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.cancel}`}
              onClick={() => close(false)}
            >
              {dialog.cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              className={`${styles.btn} ${
                dialog.destructive ? styles.confirmDanger : styles.confirmNeutral
              }`}
              onClick={() => close(true)}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      {mounted && modal ? createPortal(modal, document.body) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error(
      "useConfirmDialog must be used within ConfirmDialogProvider"
    );
  }
  return ctx;
}
