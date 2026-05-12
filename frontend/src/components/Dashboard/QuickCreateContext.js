"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

const QuickCreateContext = createContext(null);

export function QuickCreateProvider({ children }) {
  const [active, setActive] = useState(null);

  const open = useCallback((key) => {
    setActive(key);
  }, []);

  const close = useCallback(() => {
    setActive(null);
  }, []);

  const value = useMemo(
    () => ({ active, open, close }),
    [active, open, close]
  );

  return (
    <QuickCreateContext.Provider value={value}>
      {children}
    </QuickCreateContext.Provider>
  );
}

export function useQuickCreate() {
  const ctx = useContext(QuickCreateContext);
  if (!ctx) {
    throw new Error("useQuickCreate must be used within QuickCreateProvider");
  }
  return ctx;
}
