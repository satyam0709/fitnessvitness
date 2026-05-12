"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";

const UserRoleContext = createContext({
  role: null,
  isAdmin: false,
  loading: true,
  me: null,
});

/**
 * Fetches `GET /api/users/me` for DB `role` and profile (`me`). Refetches when `workspace:access`
 * targets this user (e.g. role changed by an admin) so admin link and access stay live.
 */
export function UserRoleProvider({ children }) {
  const { isLoaded, userId } = useAuth();
  const { user } = useUser();
  const [role, setRole] = useState(null);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!isLoaded) return undefined;

    if (!userId) {
      setRole(null);
      setMe(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await apiFetch("/users/me");
        const json = await res.json();
        if (cancelled) return;
        if (json.success && json.data) {
          setMe(json.data);
          setRole(json.data.role ?? null);
        } else {
          setMe(null);
          setRole(null);
        }
      } catch {
        if (!cancelled) {
          setMe(null);
          setRole(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, refreshNonce]);

  useEffect(() => {
    if (!isLoaded || !userId) return undefined;
    if (Number(user?.is_platform_admin) === 1 || Number(user?.isPlatformAdmin) === 1) return undefined;
    if (Number(me?.is_platform_admin) === 1) return undefined;
    return subscribeWorkspaceAccess((payload) => {
      if (payload?.clerkUserId && payload.clerkUserId !== userId) return;
      setRefreshNonce((n) => n + 1);
    });
  }, [isLoaded, userId, user?.is_platform_admin, user?.isPlatformAdmin, me?.is_platform_admin]);

  const value = useMemo(
    () => ({
      role,
      isAdmin: role === "admin",
      loading,
      me,
      refreshNonce,
    }),
    [role, loading, me, refreshNonce]
  );

  return <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>;
}

export function useUserRole() {
  return useContext(UserRoleContext);
}
