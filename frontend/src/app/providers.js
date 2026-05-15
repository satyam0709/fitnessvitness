"use client";
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { TenantProvider } from "../contexts/TenantContext";
import { AuthProvider } from "../contexts/AuthContext";

export default function Providers({ children }) {
  useEffect(() => {
    function onUnhandledRejection(event) {
      const reason = event?.reason;
      const name = reason?.name || "";
      const message = String(reason?.message || "");
      // Browser media autoplay races can throw AbortError ("play() request was interrupted by pause()").
      if (name === "AbortError" && /play\(\).*interrupted.*pause/i.test(message)) {
        event.preventDefault();
      }
    }
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="rnd-crm-theme"
      enableColorScheme
    >
      <AuthProvider>
        <TenantProvider>{children}</TenantProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}