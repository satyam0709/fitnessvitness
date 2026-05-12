"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function WorkspacePendingPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@365rnd.com";
  const { me } = useAuth();
  const workspaceUrl = me?.tenant_url || null;
  const loginEmail = me?.user?.email || null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f4f6f8",
        padding: "24px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "640px",
          background: "#fff",
          borderRadius: "14px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 6px 24px rgba(0,0,0,0.06)",
          padding: "28px 24px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <h1 style={{ margin: "0 0 10px", color: "#111827", fontSize: "26px" }}>
          Workspace pending verification
        </h1>
        <p style={{ margin: "0 0 12px", color: "#374151", lineHeight: 1.6 }}>
          Your payment and registration are complete. Your workspace is currently locked until the super admin
          verifies database setup and security checks.
        </p>
        <p style={{ margin: "0 0 20px", color: "#4b5563", lineHeight: 1.6 }}>
          You will receive an email confirmation when your workspace URL is ready to use.
        </p>

        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "14px",
            color: "#1e3a8a",
            marginBottom: "18px",
          }}
        >
          Status: Waiting for super-admin DB verification
        </div>

        {workspaceUrl ? (
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "14px",
              color: "#374151",
              marginBottom: "18px",
              wordBreak: "break-word",
            }}
          >
            <strong>Reserved workspace URL:</strong> {workspaceUrl}
            {loginEmail ? (
              <>
                <br />
                <strong>Login email after activation:</strong> {loginEmail}
              </>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link
            href="/login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "180px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              color: "#111827",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Go to login
          </Link>
          <a
            href={`mailto:${supportEmail}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "180px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid #bfdbfe",
              color: "#1d4ed8",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Contact support
          </a>
        </div>
      </section>
    </main>
  );
}
