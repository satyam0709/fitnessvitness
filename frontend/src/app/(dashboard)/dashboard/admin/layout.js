"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getApiBase } from "@/lib/api";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";
import styles from "./layout.module.css";

const LINKS = [
  { href: "/dashboard/admin/users", label: "Users & roles" },
  { href: "/dashboard", label: "Team dashboard" },
];

export default function TenantAdminLayout({ children }) {
  const { isLoaded } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading: roleLoading } = useUserRole();
  const [ok, setOk] = useState(false);
  const [tenantTitle, setTenantTitle] = useState("");
  const [subSummary, setSubSummary] = useState(null);

  const loadPlan = useCallback(async () => {
    try {
      const pr = await fetch(`${getApiBase()}/tenant-admin/plan`, { credentials: "include", 
        headers: { "Content-Type": "application/json" },
      });
      const pj = await pr.json().catch(() => ({}));
      if (pj.success && pj.data) {
        if (pj.data.tenant_name) setTenantTitle(pj.data.tenant_name);
        setSubSummary(pj.data.subscription_summary || null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || roleLoading) return;
    (async () => {
      try {
        const tid = me?.tenant_id;
        const roleOk = me?.role === "admin" || me?.role === "manager";
        const isPlatform = Number(me?.is_platform_admin) === 1;
        const isInvitedWorkspaceUser =
          Boolean(tid) && (me?.invited_by != null || me?.is_workspace_owner === false);
        const canUseWorkspaceAdmin = Boolean(tid) && !isInvitedWorkspaceUser && (roleOk || isPlatform);

        if (canUseWorkspaceAdmin) {
          if (
            pathname.startsWith("/dashboard/admin/plan") ||
            pathname.startsWith("/dashboard/admin/integrations")
          ) {
            router.replace("/dashboard/admin/users");
            return;
          }
          setOk(true);
          await loadPlan();
        } else {
          router.replace("/dashboard");
        }
      } catch {
        router.replace("/dashboard");
      }
    })();
  }, [isLoaded, roleLoading, me, pathname, router, loadPlan]);

  useEffect(() => {
    if (!isLoaded || !me?.id) return undefined;
    return subscribeWorkspaceAccess(() => {
      void loadPlan();
    });
  }, [isLoaded, me?.id, loadPlan]);

  if (!isLoaded || roleLoading || !ok) {
    return (
      <div className={styles.loading}>
        <i className="fas fa-spinner fa-spin" /> Checking workspace admin access…
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.aside}>
        <h2 className={styles.title}>Workspace Admin{tenantTitle ? ` — ${tenantTitle}` : ""}</h2>
        <p className={styles.muted}>Add users, assign roles, and monitor subscription time remaining.</p>
        {subSummary && subSummary.days_left != null ? (
          <div className={styles.subBanner} role="status">
            <strong>{subSummary.days_left}</strong> day{subSummary.days_left === 1 ? "" : "s"} left
            {subSummary.status ? (
              <>
                {" "}
                · <span className={styles.subMuted}>{String(subSummary.status)}</span>
              </>
            ) : null}
          </div>
        ) : null}
        <nav className={styles.nav}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`${styles.navItem} ${pathname === l.href ? styles.navActive : ""}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href="/dashboard" className={styles.back}>
          ← Back to CRM
        </Link>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <h1 className={styles.topbarTitle}>365 RND CRM — Workspace Admin</h1>
            <p className={styles.topbarSub}>Tenant administration console</p>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
