"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function AddPackageLayout({ children }) {
  const router = useRouter();
  const { logout } = useAuth();

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--border)",
          padding: "10px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/add-package?onboarding=1" style={{ textDecoration: "none", color: "var(--text-main)", fontWeight: 800 }}>
          Package Setup
        </Link>
        <button
          type="button"
          onClick={() => void onLogout()}
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-hover)",
            color: "var(--text-main)",
            borderRadius: 8,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </header>
      {children}
    </div>
  );
}
