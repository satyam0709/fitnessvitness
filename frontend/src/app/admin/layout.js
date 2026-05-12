"use client";

import { useAuth, useUser, UserButton } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import ThemeToggle from "../../components/Navbar/ThemeToggle";
import { apiFetch } from "@/lib/api";
import AdminRealtimeProvider, { useAdminRealtime } from "./AdminRealtimeProvider";
import styles from "./layout.module.css";

const SHOW_PLATFORM_USERS = false;

function AdminLivePill() {
  const { live } = useAdminRealtime();
  return (
    <span
      className={`${styles.livePill} ${live ? styles.livePillOn : ""}`}
      title={
        live
          ? "Connected — admin lists refresh when data changes on the server"
          : "Live sync offline — ensure API is running; sockets use your session cookie."
      }
    >
      {live ? "Live" : "Offline"}
    </span>
  );
}

const NAV = [
  { label: "Overview", href: "/admin", icon: "fa-gauge-high" },
  { label: "Tenants", href: "/admin/tenants", icon: "fa-building" },
  { label: "DB requests", href: "/admin/tenant-db-requests", icon: "fa-database" },
  { label: "Workspace admins", href: "/admin/workspace-admins", icon: "fa-user-tie" },
  { label: "Platform users", href: "/admin/platform-users", icon: "fa-user-shield" },
  { label: "Users & roles", href: "/admin/users", icon: "fa-users" },
  { label: "Packages", href: "/admin/packages", icon: "fa-box-open" },
  { label: "Coupons", href: "/admin/coupons", icon: "fa-ticket" },
  { label: "Subscriptions", href: "/admin/order", icon: "fa-receipt" },
  { label: "Contact inbox", href: "/admin/contacts", icon: "fa-envelope" },
];

export default function AdminLayout({ children }) {
  const { isLoaded } = useAuth();
  const { user } = useUser();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const logoSrc =
    resolvedTheme === "dark"
      ? "/assets/365-rnd-crm-logo-dark.svg"
      : "/assets/365-rnd-crm-logo-transparent.svg";

  useEffect(() => {
    if (!isLoaded) return;
    async function check() {
      try {
        const res = await apiFetch("/users/me");
        const data = await res.json();
        const row = data.data;
        const platform =
          Number(row?.is_platform_admin) === 1 ||
          (row?.role === "admin" && (row?.tenant_id == null || row?.tenant_id === ""));
        if (data.success && platform) {
          setAuthorized(true);
        } else {
          router.replace("/dashboard");
        }
      } catch {
        router.replace("/dashboard");
      } finally {
        setChecking(false);
      }
    }
    check();
  }, [isLoaded, router]);

  useEffect(() => {
    if (!SHOW_PLATFORM_USERS && pathname?.startsWith("/admin/platform-users")) {
      router.replace("/admin/users");
    }
  }, [pathname, router]);

  if (checking) {
    return (
      <div className={styles.loading}>
        <i className="fas fa-spinner fa-spin" style={{ color: "#F5C400", fontSize: 24 }} />
        <span>Verifying admin access...</span>
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <AdminRealtimeProvider>
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/admin" className={styles.logoArea}>
          <div className={styles.logoMark}>
            <Image
              src={logoSrc}
              alt="RND CRM Logo"
              width={220}
              height={80}
              className={styles.navLogo}
              style={{ height: "auto" }}
              priority
              unoptimized
              key={logoSrc}
            />
          </div>
          <span className={styles.logoSub}>Control center</span>
        </Link>

        <nav className={styles.nav}>
          <p className={styles.navLabel}>Management</p>
          {NAV.filter((item) => SHOW_PLATFORM_USERS || item.href !== "/admin/platform-users").map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`${styles.navItem} ${active ? styles.active : ""}`}>
                <span className={styles.iconWrap}>
                  <i className={`fas ${item.icon}`} />
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/dashboard" className={styles.backBtn}>
            <i className="fas fa-arrow-left" /> Back to CRM
          </Link>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <div className={styles.topbarTitleWrap}>
              <h1 className={styles.topbarTitle}>365 RND CRM — Admin</h1>
              <AdminLivePill />
            </div>
            <nav className={styles.topbarNav} aria-label="Quick links">
              <Link href="/dashboard" className={styles.topbarLink}>
                CRM app
              </Link>
              <span className={styles.topbarSep}>|</span>
              <Link href="/add-package" className={styles.topbarLink}>
                Plans
              </Link>
            </nav>
          </div>
          <div className={styles.topbarRight}>
            <ThemeToggle />
            <div className={styles.userArea}>
              <span className={styles.userName}>{user?.firstName || "Admin"}</span>
              <UserButton />
            </div>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
    </AdminRealtimeProvider>
  );
}