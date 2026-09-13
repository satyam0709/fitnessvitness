"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./InvoiceCustomerPicker.module.css";

const PANEL_ESTIMATE = 280;

function productMatches(item, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(item?.product_name || "").toLowerCase();
  const hsn = String(item?.hsn || "").toLowerCase();
  return name.includes(q) || hsn.includes(q);
}

export default function InvoiceProductPicker({ items = [], value = "", onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);

  const filtered = useMemo(
    () => items.filter((item) => productMatches(item, search)),
    [items, search]
  );

  function close() {
    setOpen(false);
    setSearch("");
  }

  function openDropdown() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      setOpenUp(below < PANEL_ESTIMATE && above > below);
    }
    setOpen(true);
  }

  function pick(item) {
    onPick?.(item);
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (!rootRef.current?.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const containerClass = open ? `${styles.lookupContainer} ${styles.lookupContainerOpen}` : styles.lookupContainer;
  const panelClass = openUp ? `${styles.dropdownPanel} ${styles.dropdownPanelUp}` : styles.dropdownPanel;

  return (
    <div className={containerClass} ref={rootRef}>
      <input
        type="text"
        className={styles.lookupInput}
        placeholder="Select or type item"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => {
          if (!open) openDropdown();
        }}
        onClick={() => {
          if (!open) openDropdown();
        }}
      />
      <span className={styles.lookupIcons}>
        <button
          type="button"
          className={styles.lookupIconBtn}
          onClick={() => (open ? close() : openDropdown())}
          title="Search products"
        >
          <i className="fas fa-search" />
        </button>
      </span>
      {open ? (
        <div className={panelClass}>
          <div className={styles.dropdownSearch}>
            <input
              type="text"
              className={styles.dropdownSearchInput}
              placeholder="Search product or HSN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.dropdownList}>
            {filtered.length === 0 ? (
              <div className={styles.dropdownEmpty}>No matching products — keep typing to add</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={`${item.product_name}-${item.hsn || ""}`}
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => pick(item)}
                >
                  <strong>{item.product_name}</strong>
                  {item.hsn || item.cost != null ? (
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {[item.hsn ? `HSN ${item.hsn}` : null, item.cost != null ? String(item.cost) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
