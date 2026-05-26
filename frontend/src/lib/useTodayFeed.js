"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeTodayLive } from "@/lib/chatRealtime";

/**
 * Shared Today Command Center feed (`GET /today`) with debounced realtime refresh.
 */
export function useTodayFeed({ enabled = true, debounceMs = 250 } = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [date, setDate] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(
    async (silent = false) => {
      if (!enabled) return;
      if (!silent) setLoading(true);
      setError("");
      try {
        const res = await apiFetch("/today");
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to load today");
        }
        setSummary(json.summary || null);
        setItems(Array.isArray(json.items) ? json.items : []);
        setUpcoming(Array.isArray(json.upcoming) ? json.upcoming : []);
        setDate(json.date || null);
      } catch (e) {
        if (!silent) setError(e.message || "Failed to load");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [enabled]
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  const refreshQuiet = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void loadRef.current(true);
    }, debounceMs);
  }, [enabled, debounceMs]);

  useEffect(() => {
    if (!enabled) return undefined;
    void load(false);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const unsub = subscribeTodayLive(refreshQuiet);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, refreshQuiet]);

  const markDone = useCallback(async (item) => {
    const res = await apiFetch(
      `/today/${encodeURIComponent(item.source_type)}/${encodeURIComponent(
        item.source_id ?? item.id
      )}/done`,
      { method: "PATCH" }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.message || "Could not mark done");
    }
    void loadRef.current(true);
    return json;
  }, []);

  return {
    loading,
    error,
    summary,
    items,
    upcoming,
    date,
    load,
    refreshQuiet,
    markDone,
    todayCount: Number(summary?.total ?? 0),
  };
}
