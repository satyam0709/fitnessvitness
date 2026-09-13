"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./InvoiceCustomerPicker.module.css";
import { partyMatchesQuery, partyOptionLabel, partySourceLabel } from "./invoiceCustomer";

const PANEL_ESTIMATE = 280;

export default function InvoiceCustomerPicker({
  items = [],
  extraItems = [],
  displayValue = "",
  onPick,
  onClear,
  onSearchChange,
  placeholder = "Search gym clients, contacts, or customers",
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);

  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const item of [...(extraItems || []), ...(items || [])]) {
      if (!item?.key || seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
    return out;
  }, [items, extraItems]);

  const filtered = useMemo(
    () => merged.filter((item) => partyMatchesQuery(item, search)),
    [merged, search]
  );

  function close() {
    setOpen(false);
    setSearch("");
    onSearchChange?.("");
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

  function setQuery(value) {
    setSearch(value);
    onSearchChange?.(value);
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
        readOnly
        placeholder={placeholder}
        value={displayValue}
        onClick={() => (open ? close() : openDropdown())}
      />
      <span className={styles.lookupIcons}>
        <button type="button" className={styles.lookupIconBtn} onClick={() => (open ? close() : openDropdown())} title="Search customers">
          <i className="fas fa-search" />
        </button>
        {displayValue ? (
          <button
            type="button"
            className={styles.lookupIconBtn}
            onClick={() => onClear?.()}
            title="Clear selected client"
          >
            <i className="fas fa-trash-alt" />
          </button>
        ) : null}
      </span>
      {open ? (
        <div className={panelClass}>
          <div className={styles.dropdownSearch}>
            <input
              type="text"
              className={styles.dropdownSearchInput}
              placeholder="Search name, email, phone, client ID"
              autoFocus
              value={search}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.dropdownList}>
            {filtered.length === 0 ? (
              <div className={styles.dropdownEmpty}>No match — type details in the fields below</div>
            ) : (
              filtered.map((item) => (
                <button key={item.key} type="button" className={styles.dropdownItem} onClick={() => pick(item)}>
                  <strong>{partyOptionLabel(item)}</strong>
                  <span className={styles.sourceTag}>{partySourceLabel(item)}</span>
                  {item.email || item.phone ? (
                    <span className={styles.metaLine}>
                      {[item.email, item.phone].filter(Boolean).join(" · ")}
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
