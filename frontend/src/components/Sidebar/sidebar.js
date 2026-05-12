"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { useTenantFeatures } from "@/contexts/TenantFeaturesContext";
import { apiFetch } from "@/lib/api";
import styles from "./sidebar.module.css";
import Image from "next/image";

const NAV = [
  {
    section: "Main",
    items: [
      { label: "Dashboard", icon: "fa-gauge-high",   href: "/dashboard",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
      {
        label: "Lead",
        icon: "fa-filter",
        href: "/leads",
        color: "#f59e0b",
        bg: "rgba(245,158,11,0.15)",
        requiresFeature: "lead_management",
      },
      { label: "Task",      icon: "fa-list-check",    href: "/tasks",      color: "#22c55e", bg: "rgba(34,197,94,0.15)", requiresFeature: "tasks" },
      {
        label: "Opportunities",
        icon: "fa-briefcase",
        href: "/opportunities",
        color: "#16a34a",
        bg: "rgba(22,163,74,0.15)",
        requiresFeature: "opportunities",
      },
      { label: "Tickets",   icon: "fa-ticket",        href: "/tickets",    color: "#ef4444", bg: "rgba(239,68,68,0.15)", requiresFeature: "tickets" },
      { label: "Reminder",  icon: "fa-bell",          href: "/reminders",  color: "#f5c400", bg: "rgba(245,196,0,0.18)", requiresFeature: "reminders" },
      { label: "Meeting",   icon: "fa-video",         href: "/meetings",   color: "#06b6d4", bg: "rgba(6,182,212,0.15)", requiresFeature: "meetings" },
      { label: "To Do",     icon: "fa-clipboard-list", href: "/todos",     color: "#0ea5e9", bg: "rgba(14,165,233,0.15)", requiresFeature: "tasks" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { label: "Notes",    icon: "fa-note-sticky",   href: "/notes",     color: "#ef4444", bg: "rgba(239,68,68,0.15)"   },
      { label: "Chat",     icon: "fa-comments",       href: "/chat",      color: "#8b5cf6", bg: "rgba(139,92,246,0.15)"  },
      { label: "Calendar", icon: "fa-calendar-days",  href: "/calendar",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)"  },
      { label: "Companies", icon: "fa-building",      href: "/companies", color: "#a855f7", bg: "rgba(168,85,247,0.15)", requiresFeature: "companies" },
      { label: "Contacts", icon: "fa-address-book",   href: "/contacts",  color: "#0ea5e9", bg: "rgba(14,165,233,0.15)"  },
      { label: "Storage",  icon: "fa-hard-drive",     href: "/storage",   color: "#14b8a6", bg: "rgba(20,184,166,0.15)"  },
      { label: "Reports",  icon: "fa-chart-bar",      href: "/reports",   color: "#6366f1", bg: "rgba(99,102,241,0.15)"  },
    ],
  },
  {
    section: "Finance",
    items: [
      {
        label: "Invoice", icon: "fa-file-invoice-dollar", color: "#22c55e", bg: "rgba(34,197,94,0.15)",
        children: [
          { label: "List",           href: "/invoice/sales"          },
          { label: "Add",            href: "/invoice/sales/new"      },
          { label: "Quotation",      href: "/invoice/quotation"      },
          { label: "Payment Method", href: "/invoice/payment-method" },
          { label: "Brochure",       href: "/invoice/brochure"       },
          { label: "Purchase",       href: "/invoice/purchase"       },
          { label: "Proforma",       href: "/invoice/proforma"       },
        ],
      },
    ],
  },
  {
    section: "People",
    items: [
      {
        label: "HR", icon: "fa-user-tie", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)",
        children: [
          { label: "Employees",  href: "/hr/employees"  },
          { label: "Attendance", href: "/hr/attendance" },
          { label: "Leave",      href: "/hr/leave"      },
        ],
      },
      {
        label: "HR Operations", icon: "fa-people-group", color: "#f97316", bg: "rgba(249,115,22,0.15)",
        children: [
          { label: "Payroll",    href: "/hr-ops/payroll"    },
          { label: "Appraisals", href: "/hr-ops/appraisals" },
        ],
      },
    ],
  },
  {
    section: "System",
    items: [
      {
        label: "General Settings", icon: "fa-gear", color: "#64748b", bg: "rgba(100,116,139,0.15)",
        children: [
          { label: "Profile",           href: "/settings/profile"      },
          { label: "Company",           href: "/settings/company"      },
          { label: "Web settings",      href: "/settings/web"          },
          { label: "Invoice settings",  href: "/settings/invoice"      },
          { label: "Integrations",      href: "/settings/integrations" },
        ],
      },
    ],
  },
];

export default function Sidebar({ collapsed, mobileOpen, onToggle }) {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const { isLoaded } = useAuth();
  const { me, loading: roleLoading } = useUserRole();
  const { featureMap } = useTenantFeatures();
  const [mounted, setMounted] = useState(false);
  const [openMenus, setOpenMenus] = useState({});
  const [reportsCount, setReportsCount] = useState(0);

  const navSections = useMemo(() => NAV, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const reportsEnabled = Boolean(
      featureMap?.reports || featureMap?.basic_reports || featureMap?.advanced_reports
    );
    if (!reportsEnabled) {
      setReportsCount(0);
      return;
    }
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
  }, [isLoaded, pathname, featureMap]);

  const toggleMenu = (label) =>
    setOpenMenus((prev) => ({ ...prev, [label]: !prev[label] }));

  const isActive       = (href)     => pathname === href || pathname.startsWith(href + "/");
  const isParentActive = (children) => children?.some((c) => isActive(c.href));

  const logoSrc = mounted && resolvedTheme === "dark"
    ? "/assets/365-rnd-crm-logo-dark.svg"
    : "/assets/365-rnd-crm-logo-transparent.svg";

  const collapsedLogoSrc = mounted && resolvedTheme === "dark"
    ? "/assets/365-rnd-crm-sidebar-compressed-logo-dark.svg"
    : "/assets/365-rnd-crm-sidebar-compressed-logo-light.svg";

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
              alt="RND CRM"
              width={160}
              height={44}
              className={styles.logo}
              style={{ width: "auto", height: "auto" }}
              priority
              key={resolvedTheme}
            />
          </Link>
        ) : (
          <Link href="/dashboard" className={styles.brandIcon} title="Dashboard">
            <span className={styles.collapsedLogoWrap}>
              <Image
                src={collapsedLogoSrc}
                alt="RND CRM"
                width={40}
                height={40}
                className={styles.logoCollapsed}
                sizes="36px"
                priority
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

        {!roleLoading && me && (
          <div className={styles.adminBar}>
            {(() => {
              const isPlatform =
                Number(me.is_platform_admin) === 1 ||
                (me.role === "admin" && (me.tenant_id == null || me.tenant_id === ""));
              const isInvitedWorkspaceUser =
                Boolean(me.tenant_id) &&
                (me.invited_by != null || me.is_workspace_owner === false);
              const canUseWorkspaceAdmin =
                !!me.tenant_id &&
                !isInvitedWorkspaceUser &&
                (me.role === "admin" || me.role === "manager" || Number(me.is_platform_admin) === 1);
              return (
                <>
                  {isPlatform ? (
                    <Link
                      href="/admin"
                      className={`${styles.adminBarLink} ${pathname.startsWith("/admin") ? styles.adminBarLinkActive : ""}`}
                      title="Admin panel"
                    >
                      <span className={styles.adminBarIcon}>
                        <i className="fas fa-shield-halved" />
                      </span>
                      {!collapsed && <span className={styles.adminBarLabel}>Admin panel</span>}
                    </Link>
                  ) : null}
                  {!isPlatform && canUseWorkspaceAdmin ? (
                    <Link
                      href="/dashboard/admin/users"
                      className={`${styles.adminBarLink} ${pathname.startsWith("/dashboard/admin") ? styles.adminBarLinkActive : ""}`}
                      title="Workspace admin"
                    >
                      <span className={styles.adminBarIcon}>
                        <i className="fas fa-building" />
                      </span>
                      {!collapsed && <span className={styles.adminBarLabel}>Workspace Admin</span>}
                    </Link>
                  ) : null}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </aside>
  );
}