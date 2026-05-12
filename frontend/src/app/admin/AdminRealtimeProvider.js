"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { connectGlobalSocket } from "@/lib/api";

const AdminRealtimeContext = createContext({
  refreshNonce: 0,
  live: false,
  bumpRefresh: () => {},
  tenantActivationEvent: null,
  clearTenantActivationEvent: () => {},
});

export function useAdminRealtime() {
  return useContext(AdminRealtimeContext);
}

/**
 * Socket.io `admin:changed` → increments refreshNonce so admin pages refetch from REST.
 * Tenant workspace activations (paid or trial) set `tenantActivationEvent` for toasts.
 * Only platform operators (`is_platform_admin`) join the `admin` room (see backend realtime).
 */
export default function AdminRealtimeProvider({ children }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [live, setLive] = useState(false);
  const [tenantActivationEvent, setTenantActivationEvent] = useState(null);

  const bumpRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const clearTenantActivationEvent = useCallback(() => {
    setTenantActivationEvent(null);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLive(false);
      return;
    }

    let cancelled = false;
    let cleanupFn;

    async function initSocket() {
      const s = await connectGlobalSocket(true);
      if (cancelled || !s) return;

      setLive(s.connected);

      const onConnect = () => {
        if (!cancelled) setLive(true);
      };
      const onDisconnect = () => {
        if (!cancelled) setLive(false);
      };
      const onChanged = (payload) => {
        if (cancelled) return;
        setRefreshNonce((n) => n + 1);
        if (payload?.scope === "tenants" && payload?.action === "workspace_activated") {
          setTenantActivationEvent({ ...payload, receivedAt: Date.now() });
        }
      };

      s.on("connect", onConnect);
      s.on("disconnect", onDisconnect);
      s.on("admin:changed", onChanged);

      return () => {
        s.off("connect", onConnect);
        s.off("disconnect", onDisconnect);
        s.off("admin:changed", onChanged);
      };
    }

    initSocket().then((fn) => {
      cleanupFn = fn;
    });

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
      setLive(false);
    };
  }, [isLoaded, isSignedIn]);

  const value = useMemo(
    () => ({
      refreshNonce,
      live,
      bumpRefresh,
      tenantActivationEvent,
      clearTenantActivationEvent,
    }),
    [refreshNonce, live, bumpRefresh, tenantActivationEvent, clearTenantActivationEvent]
  );

  return <AdminRealtimeContext.Provider value={value}>{children}</AdminRealtimeContext.Provider>;
}
