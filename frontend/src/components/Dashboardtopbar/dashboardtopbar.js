"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserButton, useAuth, useUser } from "@/contexts/AuthContext";
import ThemeToggle from "../Navbar/ThemeToggle";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { useTenantFeatures } from "@/contexts/TenantFeaturesContext";
import { displayNameFromClerkUser, displayNameFromDbUser } from "@/lib/userDisplayName";
import { apiFetch } from "@/lib/api";
import { subscribeNotificationEvents } from "@/lib/notificationsRealtime";
import TrialTopbarPill from "./TrialTopbarPill";
import styles from "./dashboardtopbar.module.css";

const QUICK_ACTIONS = [
  { key: "prospect", label: "Prospect", icon: "fa-user-plus" },
  { key: "lead",     label: "Lead",     icon: "fa-filter" },
  { key: "task",     label: "Task",     icon: "fa-list-check" },
  { key: "reminder", label: "Reminder", icon: "fa-bell" },
  { key: "meeting",  label: "Meeting",  icon: "fa-video" },
  { key: "todo",     label: "To Do",    icon: "fa-clipboard-list" },
  { key: "collection", label: "Collection", icon: "fa-hand-holding-dollar" },
  { key: "note",     label: "Note",     icon: "fa-note-sticky" },
];

const INVOICE_MENU = [
  { label: "Record payment", icon: "fa-hand-holding-dollar", href: "/collections?create=1" },
  { label: "All invoices & receipts", icon: "fa-list", href: "/invoice/sales" },
  { label: "New sales invoice", icon: "fa-plus", href: "/invoice/sales/new" },
  { label: "Invoice settings", icon: "fa-gear", href: "/settings/invoice" },
];

const QUICK_CREATE_KEYS = new Set([
  "lead",
  "task",
  "reminder",
  "meeting",
  "todo",
  "note",
]);


export default function DashboardTopbar({ onMenuToggle, sidebarCollapsed }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVal,  setSearchVal]  = useState("");
  const searchRef = useRef(null);
  const notifRef = useRef(null);
  const invoiceRef = useRef(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const router    = useRouter();
  const { user }  = useUser();
  useAuth();
  const { open: openQuickCreate } = useQuickCreate();
  const { me } = useUserRole();
  const { featureMap } = useTenantFeatures();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifCount, setNotifCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    let active = true;
    const notificationsEnabled = Boolean(
      featureMap?.notifications || featureMap?.dashboard || featureMap?.calendar
    );
    if (!notificationsEnabled) {
      setNotifications([]);
      setNotifCount(0);
      return () => {
        active = false;
      };
    }
    async function loadNotifications() {
      try {
        const res = await apiFetch("/notifications?limit=25");
        const json = await res.json().catch(() => ({}));
        if (!active || !res.ok || !json?.success) return;
        setNotifications(Array.isArray(json.notifications) ? json.notifications : []);
        setNotifCount(Number(json.unread) || 0);
      } catch {
        /* ignore */
      }
    }
    void loadNotifications();
    const unsub = subscribeNotificationEvents((type, payload) => {
      if (type === "new") {
        const n = payload?.notification;
        if (!n) return;
        setNotifications((prev) => [n, ...prev].slice(0, 25));
        setNotifCount((c) => c + 1);
      }
      if (type === "read") {
        const unread = Number(payload?.unread);
        if (Number.isFinite(unread)) setNotifCount(Math.max(0, unread));
        if (payload?.readAll || payload?.cleared) {
          setNotifications([]);
        }
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [featureMap]);

  useEffect(() => {
    function onDocClick(e) {
      if (!notifRef.current?.contains(e.target)) setNotifOpen(false);
      if (!invoiceRef.current?.contains(e.target)) setInvoiceOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function markAllRead() {
    if ((!notifCount && notifications.length === 0) || notifBusy) return;
    setNotifBusy(true);
    try {
      const res = await apiFetch("/notifications/read-all", { method: "PATCH" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        setNotifCount(0);
        setNotifications([]);
      }
    } catch {
      /* ignore */
    } finally {
      setNotifBusy(false);
    }
  }

  function formatWhen(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const diffSec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchVal.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchVal.trim())}`);
      setSearchOpen(false);
      setSearchVal("");
    }
  };

  const handleQuickAction = (key) => {
    if (QUICK_CREATE_KEYS.has(key)) {
      openQuickCreate(key);
      return;
    }
    if (key === "prospect") {
      router.push("/opportunities");
      return;
    }
    if (key === "collection") {
      router.push("/collections");
    }
  };

  function goInvoice(href) {
    setInvoiceOpen(false);
    router.push(href);
  }

  const cf = user?.firstName?.trim() || "";
  const cl = user?.lastName?.trim() || "";
  const clerkHasName = !!(cf || cl);
  const dbName = displayNameFromDbUser(me);
  const clerkFallback = displayNameFromClerkUser(user);
  const fullName = clerkHasName
    ? [cf, cl].filter(Boolean).join(" ")
    : dbName || clerkFallback || "User";
  const roleRaw = me?.role || user?.role || user?.publicMetadata?.role || "member";
  const role =
    String(roleRaw).charAt(0).toUpperCase() + String(roleRaw).slice(1).toLowerCase();

  return (
    <header
      className={[
        styles.topbar,
        sidebarCollapsed ? styles.sidebarCollapsed : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Left side */}
      <div className={styles.left}>
        {/*
          menuBtn is display:none on desktop (CSS).
          It only appears on mobile (<768px) to open the sidebar drawer.
          On desktop the sidebar has its own collapse button — no need for this.
        */}
        <button
          className={styles.menuBtn}
          onClick={onMenuToggle}
          aria-label="Open sidebar"
        >
          <i className="fas fa-bars" />
        </button>

        <div className={styles.quickActions}>
          <div className={styles.quickGroup}>
            {QUICK_ACTIONS.map((action, index) => (
              <span key={action.key} className={styles.quickItem}>
                {index > 0 ? <span className={styles.pipe} aria-hidden="true">|</span> : null}
                <button
                  type="button"
                  className={styles.quickBtn}
                  onClick={() => handleQuickAction(action.key)}
                >
                  <i className={`fas ${action.icon}`} aria-hidden="true" />
                  {action.label}
                </button>
              </span>
            ))}
            <span className={styles.quickItem}>
              <span className={styles.pipe} aria-hidden="true">|</span>
              <div className={styles.invoiceWrap} ref={invoiceRef}>
                <button
                  type="button"
                  className={`${styles.quickBtn} ${styles.invoiceTrigger} ${invoiceOpen ? styles.invoiceTriggerOpen : ""}`}
                  onClick={() => setInvoiceOpen((v) => !v)}
                  aria-expanded={invoiceOpen}
                  aria-haspopup="menu"
                >
                  <i className="fas fa-file-invoice-dollar" aria-hidden="true" />
                  Invoice
                  <i className={`fas fa-chevron-down ${styles.invoiceChevron}`} aria-hidden="true" />
                </button>
                {invoiceOpen ? (
                  <div className={styles.invoiceMenu} role="menu">
                    {INVOICE_MENU.map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        role="menuitem"
                        className={styles.invoiceMenuItem}
                        onClick={() => goInvoice(item.href)}
                      >
                        <i className={`fas ${item.icon}`} aria-hidden="true" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </span>
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className={styles.right}>
        <form
          className={`${styles.searchForm} ${searchOpen ? styles.searchOpen : ""}`}
          onSubmit={handleSearch}
        >
          <button
            type="button"
            className={styles.searchToggle}
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search"
          >
            <i className="fas fa-search" />
          </button>
          {searchOpen && (
            <input
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              placeholder="Search leads, tasks..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
          )}
        </form>


        <TrialTopbarPill />

        <ThemeToggle />

        <div className={styles.notifWrap} ref={notifRef}>
          <button
            className={styles.iconBtn}
            aria-label="Notifications"
            onClick={() => setNotifOpen((v) => !v)}
          >
            <i className="fas fa-bell" />
            {notifCount > 0 ? (
              <span className={styles.notifBadge}>{notifCount > 99 ? "99+" : notifCount}</span>
            ) : null}
          </button>
          {notifOpen ? (
            <div className={styles.notifPanel}>
              <div className={styles.notifHeader}>
                <span>Notifications</span>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={(notifications.length === 0 && notifCount === 0) || notifBusy}
                  className={styles.notifMarkBtn}
                >
                  Clear all
                </button>
              </div>
              <div className={styles.notifList}>
                {notifications.length === 0 ? (
                  <div className={styles.notifEmpty}>No notifications yet.</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`${styles.notifItem} ${n.is_read ? styles.notifRead : ""}`}
                    >
                      <div className={styles.notifTitle}>{n.title}</div>
                      {n.body ? <div className={styles.notifBody}>{n.body}</div> : null}
                      <div className={styles.notifMeta}>{formatWhen(n.created_at)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.userArea}>
          <div className={styles.userMeta}>
            <span className={styles.userName}>{fullName}</span>
            <span className={styles.userRole}>{String(role)}</span>
          </div>
          <UserButton
            appearance={{
              elements: { avatarBox: { width: 32, height: 32 } },
            }}
          />
        </div>
      </div>
    </header>
  );
}