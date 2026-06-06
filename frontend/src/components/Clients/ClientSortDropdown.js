"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./ClientSortDropdown.module.css";

/**
 * Custom sort picker — matches CRM reference (green trigger, list with active highlight).
 * @param {{ value: string, onChange: (v: string) => void, options: Array<{ value: string, label: string }> }} props
 */
export default function ClientSortDropdown({ value, onChange, options = [] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort order: ${selected?.label || "Select sort"}`}
      >
        <span className={styles.triggerLabel}>{selected?.label || "Sort…"}</span>
        <i className={`fa-solid fa-chevron-down ${styles.chevron} ${open ? styles.chevronUp : ""}`} />
      </button>

      {open && (
        <ul className={styles.menu} role="listbox" aria-label="Sort clients">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.option} ${active ? styles.optionActive : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
