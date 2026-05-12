"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import styles from "./Toast.module.css";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <div
          className={`${styles.toast} ${
            toast.type === "error" ? styles.toastErr : styles.toastOk
          }`}
          role="status"
        >
          <i
            className={`fas ${
              toast.type === "error" ? "fa-circle-exclamation" : "fa-circle-check"
            }`}
            aria-hidden
          />
          <span>{toast.msg}</span>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
