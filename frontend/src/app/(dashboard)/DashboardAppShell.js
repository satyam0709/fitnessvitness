"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "../../components/Sidebar/sidebar";
import DashboardTopbar from "../../components/Dashboardtopbar/dashboardtopbar";
import QuickCreateLayer from "../../components/Dashboard/QuickCreateLayer";
import { QuickCreateProvider } from "../../components/Dashboard/QuickCreateContext";
import { UserRoleProvider } from "../../components/Dashboard/UserRoleContext";
import SubscriptionGate from "../../components/SubscriptionGate/subscriptionGate";
import { TenantFeaturesProvider } from "@/contexts/TenantFeaturesContext";
import { ConfirmDialogProvider } from "../../components/ConfirmDialog/ConfirmDialogContext";
import { ToastProvider } from "../../components/Toast/ToastContext";
import styles from "./layout.module.css";


export default function DashboardAppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isWorkspaceAdminRoute = pathname?.startsWith("/dashboard/admin");

  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setMobileOpen((v) => !v);
    } else {
      setCollapsed((v) => !v);
    }
  };

  return (
    <SubscriptionGate>
      <TenantFeaturesProvider>
      <QuickCreateProvider>
        <UserRoleProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              {isWorkspaceAdminRoute ? (
                <div className={styles.workspaceAdminRoot}>{children}</div>
              ) : (
                <div className={styles.shell}>
                  {mobileOpen && (
                    <div className={styles.overlay} onClick={() => setMobileOpen(false)} />
                  )}

                  <Sidebar
                    collapsed={collapsed}
                    mobileOpen={mobileOpen}
                    onToggle={() => setCollapsed((v) => !v)}
                  />

                  <div className={`${styles.main} ${collapsed ? styles.mainCollapsed : ""}`}>
                    <DashboardTopbar onMenuToggle={toggleSidebar} sidebarCollapsed={collapsed} />
                    <QuickCreateLayer />
                    <main className={styles.content}>{children}</main>
                  </div>
                </div>
              )}
            </ConfirmDialogProvider>
          </ToastProvider>
        </UserRoleProvider>
      </QuickCreateProvider>
      </TenantFeaturesProvider>
    </SubscriptionGate>
  );
}
