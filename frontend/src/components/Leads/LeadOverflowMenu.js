"use client";

import { useState, useEffect, useRef } from "react";

const DEFAULT_ITEMS = [
  { key: "whatsapp", icon: "fa-whatsapp", label: "Whatsapp", fab: true },
  { key: "reminder", icon: "fa-bell", label: "Set Reminder" },
  { key: "meeting", icon: "fa-briefcase", label: "Set Meeting" },
  { key: "copy", icon: "fa-copy", label: "Copy Lead" },
  { key: "duplicate", icon: "fa-clone", label: "Duplicate Lead" },
  { key: "link-client", icon: "fa-link", label: "Link Client" },
  { key: "change-log", icon: "fa-history", label: "Change Log" },
  { key: "task", icon: "fa-list-check", label: "Create Task" },
  { key: "quotation", icon: "fa-file-invoice", label: "Create Quotation" },
  { key: "invoice", icon: "fa-file-invoice-dollar", label: "Create Invoice" },
];

/**
 * 3-dot overflow menu for lead rows/cards.
 * @param {{ items?: Array, onSelect: (key: string) => void, className?: string, menuClassName?: string }} props
 */
export default function LeadOverflowMenu({
  items = DEFAULT_ITEMS,
  onSelect,
  className = "",
  menuClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function close(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className={className} style={{ position: "relative" }}>
      <button
        type="button"
        title="More"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <i className="fas fa-ellipsis-vertical" />
      </button>
      {open && (
        <div className={menuClassName} role="menu">
          {items.map((m) => (
            <button
              key={m.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(m.key);
              }}
            >
              <i className={`${m.fab ? "fab" : "fas"} ${m.icon}`} />
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
