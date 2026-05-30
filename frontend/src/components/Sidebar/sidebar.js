"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { useTodayFeed } from "@/lib/useTodayFeed";
import { APP_NAME, LOGO_SRC } from "@/lib/branding";
import styles from "./sidebar.module.css";
import Image from "next/image";

const NAV = [
  {
    section: "Main",
    items: [
      {
        label: "Today",
        icon: "fa-calendar-day",
        href: "/today",
        color: "#eab308",
        bg: "rgba(234,179,8,0.18)",
        badge: true,
      },
      { label: "Dashboard", icon: "fa-gauge-high",   href: "/dashboard",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
      {
        label: "Lead",
        icon: "fa-filter",
        href: "/leads",
        color: "#f59e0b",
        bg: "rgba(245,158,11,0.15)",
      },
      { label: "Task",      icon: "fa-list-check",    href: "/tasks",      color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
      {
        label: "Opportunities",
        icon: "fa-briefcase",
        href: "/opportunities",
        color: "#16a34a",
        bg: "rgba(22,163,74,0.15)",
      },
      { label: "Tickets",   icon: "fa-ticket",        href: "/tickets",    color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
      { label: "Reminder",  icon: "fa-bell",          href: "/reminders",  color: "#f5c400", bg: "rgba(245,196,0,0.18)" },
      { label: "Meeting",   icon: "fa-video",         href: "/meetings",   color: "#06b6d4", bg: "rgba(6,182,212,0.15)" },
      { label: "To Do",     icon: "fa-clipboard-list", href: "/todos",     color: "#0ea5e9", bg: "rgba(14,165,233,0.15)" },
      {
        label: "Collections",
        icon: "fa-hand-holding-dollar",
        href: "/collections",
        color: "#059669",
        bg: "rgba(5,150,105,0.15)",
        collectionsBadge: true,
      },
      {
        label: "Invoices",
        icon: "fa-file-invoice-dollar",
        href: "/invoice/sales",
        color: "#ca8a04",
        bg: "rgba(234,179,8,0.15)",
      },
    ],
  },
  {
    section: "Fitness CRM",
    items: [
      { label: "Clients", icon: "fa-users", href: "/clients", color: "#10b981", bg: "rgba(16,185,129,0.15)" },
      { label: "Business Tracker", icon: "fa-chart-line", href: "/business-tracker", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
      { label: "External / walk-in", icon: "fa-store", href: "/external-sales", color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
      { label: "Consultations", icon: "fa-stethoscope", href: "/consultations", color: "#0ea5e9", bg: "rgba(14,165,233,0.15)" },
      { label: "Analytics", icon: "fa-chart-pie", href: "/analytics", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)" },
      { label: "Meal Plans", icon: "fa-utensils", href: "/meal-plans", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { label: "Notes",    icon: "fa-note-sticky",   href: "/notes",     color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
      { label: "Calendar", icon: "fa-calendar-days",  href: "/calendar",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)"  },
      { label: "Companies", icon: "fa-building",      href: "/companies", color: "#a855f7", bg: "rgba(168,85,247,0.15)" },
      { label: "Contacts", icon: "fa-address-book",   href: "/contacts",  color: "#0ea5e9", bg: "rgba(14,165,233,0.15)"  },
      { label: "Storage",  icon: "fa-hard-drive",     href: "/storage",   color: "#14b8a6", bg: "rgba(20,184,166,0.15)"  },
      { label: "Reports",  icon: "fa-chart-bar",      href: "/reports",   color: "#6366f1", bg: "rgba(99,102,241,0.15)"  },
    ],
  },
];

export default function Sidebar({ collapsed, mobileOpen, onToggle }) {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const { isLoaded } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [openMenus, setOpenMenus] = useState({});
  const [reportsCount, setReportsCount] = useState(0);
  const [collectionsOpen, setCollectionsOpen] = useState(0);
  const { todayCount } = useTodayFeed({ enabled: isLoaded });

  const navSections = useMemo(() => NAV, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/reports/pipeline");
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !Array.isArray(json.data)) return;
        const total = json.data.reduce((acc, row) => acc + Number(row.count || 0), 0);
        if (!cancelled) setReportsCount(total);
      } catch {
        if (!cancelled) setReportsCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, pathname]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/collections/summary");
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) return;
        const n = Number(json.data?.open_count ?? 0);
        if (!cancelled) setCollectionsOpen(n);
      } catch {
        if (!cancelled) setCollectionsOpen(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, pathname]);

  const toggleMenu = (label) =>
    setOpenMenus((prev) => ({ ...prev, [label]: !prev[label] }));

  const isActive       = (href)     => pathname === href || pathname.startsWith(href + "/");
  const isParentActive = (children) => children?.some((c) => isActive(c.href));

  const logoSrc = LOGO_SRC;
  const collapsedLogoSrc = LOGO_SRC;

  const renderItem = (item) => {
    if (item.children) {
      const open         = openMenus[item.label] || isParentActive(item.children);
      const parentActive = isParentActive(item.children);

      return (
        <div key={item.label} className={styles.group}>
          <button
            className={`${styles.navItem} ${parentActive ? styles.active : ""}`}
            onClick={() => !collapsed && toggleMenu(item.label)}
            title={item.label}
            aria-expanded={!collapsed && open}
          >
            <span
              className={styles.iconBadge}
              style={{ background: item.bg, color: item.color }}
            >
              <i className={`fas ${item.icon}`} />
            </span>

            <span className={styles.label}>{item.label}</span>
            <i
              className={`fas fa-chevron-right ${styles.arrow} ${open && !collapsed ? styles.arrowOpen : ""}`}
            />
          </button>

          {!collapsed && (
            <div className={`${styles.subMenu} ${open ? styles.subMenuOpen : ""}`}>
              {item.children.map((child) => (
                <Link
                  key={child.href}
                  href={child.href}
                  className={`${styles.subItem} ${isActive(child.href) ? styles.subItemActive : ""}`}
                >
                  <span className={styles.subDot} />
                  {child.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navItem} ${isActive(item.href) ? styles.active : ""}`}
        title={item.label}
      >
        <span
          className={styles.iconBadge}
          style={{ background: item.bg, color: item.color }}
        >
          <i className={`fas ${item.icon}`} />
        </span>

        <span className={styles.label}>{item.label}</span>
        {!collapsed && item.href === "/reports" && reportsCount > 0 ? (
          <span className={styles.countPill}>{reportsCount}</span>
        ) : null}
        {!collapsed && item.badge && item.href === "/today" && todayCount > 0 ? (
          <span className={`${styles.countPill} ${styles.todayBadge}`}>{todayCount}</span>
        ) : null}
        {!collapsed && item.collectionsBadge && item.href === "/collections" && collectionsOpen > 0 ? (
          <span className={styles.countPill}>{collectionsOpen}</span>
        ) : null}
        {isActive(item.href) && <span className={styles.activePip} />}
      </Link>
    );
  };

  return (
    <aside
      className={[
        styles.sidebar,
        collapsed  ? styles.collapsed  : "",
        mobileOpen ? styles.mobileOpen : "",
      ].filter(Boolean).join(" ")}
    >
      <div className={styles.logoArea}>
        {!collapsed ? (
          <Link href="/dashboard" className={styles.brand}>
            <Image
              src={logoSrc}
              alt={APP_NAME}
              width={160}
              height={44}
              className={styles.logo}
              priority
              unoptimized
              key={resolvedTheme}
            />
          </Link>
        ) : (
          <Link href="/dashboard" className={styles.brandIcon} title="Dashboard">
            <span className={styles.collapsedLogoWrap}>
              <Image
                src={collapsedLogoSrc}
                alt={APP_NAME}
                width={36}
                height={36}
                className={styles.logoCollapsed}
                sizes="36px"
                priority
                unoptimized
                key={resolvedTheme}
              />
            </span>
          </Link>
        )}

        <button
          className={styles.collapseBtn}
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <i className={`fas ${collapsed ? "fa-chevron-right" : "fa-chevron-left"}`} />
        </button>
      </div>

      <div className={styles.sidebarBody}>
        <nav className={styles.nav} aria-label="Sidebar navigation">
          {navSections.map((group) => (
            <div key={group.section} className={styles.section}>
              {!collapsed && (
                <div className={styles.navSection}>{group.section}</div>
              )}
              {collapsed && <div className={styles.sectionDivider} />}

              {group.items.map(renderItem)}
            </div>
          ))}
        </nav>

      </div>
    </aside>
  );
}