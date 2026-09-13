"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./LeadOverflowMenu.module.css";

const DEFAULT_GROUPS = [
  {
    label: "Communicate",
    items: [
      { key: "whatsapp", icon: "fa-whatsapp", label: "WhatsApp", fab: true, tone: "whatsapp" },
      { key: "reminder", icon: "fa-bell", label: "Set Reminder", tone: "green" },
      { key: "meeting", icon: "fa-video", label: "Set Meeting", tone: "black" },
    ],
  },
  {
    label: "Lead",
    items: [
      { key: "copy", icon: "fa-copy", label: "Copy Lead", tone: "black" },
      { key: "duplicate", icon: "fa-clone", label: "Duplicate Lead", tone: "black" },
      { key: "link-client", icon: "fa-link", label: "Link Client", tone: "green" },
      { key: "change-log", icon: "fa-clock-rotate-left", label: "Change Log", tone: "black" },
    ],
  },
  {
    label: "Create",
    items: [
      { key: "task", icon: "fa-list-check", label: "Create Task", tone: "create" },
      { key: "quotation", icon: "fa-file-invoice", label: "Create Quotation", tone: "create" },
      { key: "invoice", icon: "fa-file-invoice-dollar", label: "Create Invoice", tone: "create" },
    ],
  },
];

function toneClass(tone) {
  if (tone === "whatsapp") return styles.toneWhatsapp;
  if (tone === "green") return styles.toneGreen;
  if (tone === "black") return styles.toneBlack;
  if (tone === "create") return styles.toneCreate;
  return "";
}

function inferTone(item) {
  if (item.tone) return item.tone;
  if (item.key === "whatsapp" || item.fab) return "whatsapp";
  if (item.key === "reminder") return "green";
  if (["task", "quotation", "invoice"].includes(item.key)) return "create";
  return "black";
}

function groupsFromItems(items) {
  if (!items?.length) return DEFAULT_GROUPS;
  return [{ label: "", items }];
}

/**
 * 3-dot overflow menu for lead rows/cards.
 * Renders in a portal so table overflow cannot clip it.
 */
export default function LeadOverflowMenu({
  items,
  onSelect,
  className = "",
  triggerClassName = "",
  title = "More actions",
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, ready: false });
  const wrapRef = useRef(null);
  const panelRef = useRef(null);

  const groups = items?.length ? groupsFromItems(items) : DEFAULT_GROUPS;

  function place() {
    const btn = wrapRef.current?.querySelector("button");
    const panel = panelRef.current;
    if (!btn || !panel) return;
    const r = btn.getBoundingClientRect();
    const pw = panel.offsetWidth || 248;
    const ph = panel.offsetHeight || 280;
    const gap = 8;
    let left = r.right - pw;
    let top = r.bottom + gap;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    if (top + ph > window.innerHeight - 8) {
      top = Math.max(8, r.top - ph - gap);
    }
    setCoords({ top, left, ready: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (
        wrapRef.current?.contains(e.target) ||
        panelRef.current?.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      place();
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const menu = open
    ? createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          role="menu"
          style={{
            top: coords.top,
            left: coords.left,
            visibility: coords.ready ? "visible" : "hidden",
          }}
        >
          <div className={styles.header}>
            <span className={styles.title}>More actions</span>
          </div>
          {groups.map((group) => (
            <div key={group.label || "all"} className={styles.group}>
              {group.label ? <div className={styles.groupLabel}>{group.label}</div> : null}
              {group.items.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    setOpen(false);
                    onSelect(m.key);
                  }}
                >
                  <span className={`${styles.icon} ${toneClass(inferTone(m))}`}>
                    <i className={`${m.fab ? "fab" : "fas"} ${m.icon}`} />
                  </span>
                  <span className={styles.label}>{m.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${className}`.trim()}>
      <button
        type="button"
        title={title}
        className={`${styles.trigger} ${triggerClassName} ${open ? styles.triggerOpen : ""}`.trim()}
        onClick={() => setOpen((v) => {
          if (v) return false;
          setCoords((c) => ({ ...c, ready: false }));
          return true;
        })}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <i className="fas fa-ellipsis-vertical" />
      </button>
      {menu}
    </div>
  );
}
