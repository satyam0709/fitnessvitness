"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeTodayLive } from "@/lib/chatRealtime";

/**
 * Module-level shared Today feed so Sidebar + /today + /dashboard
 * share one GET /today and one live subscription (no duplicate waterfalls).
 */
const store = {
  loading: true,
  error: "",
  summary: null,
  items: [],
  upcoming: [],
  date: null,
  listeners: new Set(),
  inFlight: null,
  subCount: 0,
  unsubLive: null,
  debounceTimer: null,
};

function emit() {
  for (const l of store.listeners) l();
}

function getSnapshot() {
  return store;
}

function subscribe(listener) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

async function fetchToday(silent = false) {
  if (store.inFlight) return store.inFlight;
  if (!silent) {
    store.loading = true;
    store.error = "";
    emit();
  }
  store.inFlight = (async () => {
    try {
      const localDate = new Date().toLocaleDateString("en-CA");
      const res = await apiFetch(`/today?date=${localDate}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load today");
      }
      store.summary = json.summary || null;
      store.items = Array.isArray(json.items) ? json.items : [];
      store.upcoming = Array.isArray(json.upcoming) ? json.upcoming : [];
      store.date = json.date || null;
      store.error = "";
    } catch (e) {
      if (!silent) store.error = e.message || "Failed to load";
    } finally {
      store.loading = false;
      store.inFlight = null;
      emit();
    }
  })();
  return store.inFlight;
}

function ensureLive(debounceMs) {
  store.subCount += 1;
  if (store.subCount === 1) {
    store.unsubLive = subscribeTodayLive(() => {
      if (store.debounceTimer) clearTimeout(store.debounceTimer);
      store.debounceTimer = setTimeout(() => {
        void fetchToday(true);
      }, debounceMs);
    });
  }
  return () => {
    store.subCount = Math.max(0, store.subCount - 1);
    if (store.subCount === 0) {
      if (store.unsubLive) {
        store.unsubLive();
        store.unsubLive = null;
      }
      if (store.debounceTimer) {
        clearTimeout(store.debounceTimer);
        store.debounceTimer = null;
      }
    }
  };
}

/**
 * Shared Today Command Center feed (`GET /today`) with debounced realtime refresh.
 */
export function useTodayFeed({ enabled = true, debounceMs = 250 } = {}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const markDoneInFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    void fetchToday(false);
    return ensureLive(debounceMs);
  }, [enabled, debounceMs]);

  const load = useCallback(async (silent = false) => {
    if (!enabled) return;
    await fetchToday(silent);
  }, [enabled]);

  const refreshQuiet = useCallback(() => {
    if (!enabled) return;
    void fetchToday(true);
  }, [enabled]);

  const markDone = useCallback(async (item) => {
    if (markDoneInFlight.current) return;
    markDoneInFlight.current = true;
    try {
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
      void fetchToday(true);
      return json;
    } finally {
      markDoneInFlight.current = false;
    }
  }, []);

  return {
    loading: enabled ? snap.loading : false,
    error: enabled ? snap.error : "",
    summary: snap.summary,
    items: snap.items,
    upcoming: snap.upcoming,
    date: snap.date,
    load,
    refreshQuiet,
    markDone,
    todayCount: Number(snap.summary?.total ?? 0),
  };
}
