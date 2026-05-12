"use client";

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

const TenantContext = createContext({
  tenantSubdomain: null,
  tenantUrl: null,
  setFromMe: () => {},
});

/**
 * Call `setFromMe` from a client effect after loading `/api/me` with
 * `data.tenant_subdomain` and `data.tenant_url`.
 */
export function TenantProvider({ children }) {
  const [tenantSubdomain, setTenantSubdomain] = useState(null);
  const [tenantUrl, setTenantUrl] = useState(null);
  const setFromMe = useCallback((data) => {
    setTenantSubdomain(data?.tenant_subdomain || data?.tenantSubdomain || null);
    setTenantUrl(data?.tenant_url || data?.tenantUrl || null);
  }, []);
  const v = useMemo(
    () => ({ tenantSubdomain, tenantUrl, setFromMe }),
    [tenantSubdomain, tenantUrl, setFromMe]
  );
  return <TenantContext.Provider value={v}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  return useContext(TenantContext);
}
