"use client";

import { useAuth } from "@/contexts/AuthContext";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { subscriptionGrantedFromOrdersPayload, trialEndMsFromCreated } from "@/lib/trialAccess";
import { isPlatformSuperAdmin } from "@/lib/platformUser";
import { resolvePostLoginTarget } from "@/lib/authRouting";
import { subscribeWorkspaceAccess } from "@/lib/workspaceRealtime";
import styles from "./subscriptionGate.module.css";

const SubscriptionPayloadContext = createContext(null);

const SESSION_SUB_KEY = "crm_sub_gate";

function readSubscriptionSession(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const raw = sessionStorage.getItem(SESSION_SUB_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    return o?.userId === userId && o.v === 1;
  } catch {
    return false;
  }
}

function writeSubscriptionSession(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    sessionStorage.setItem(SESSION_SUB_KEY, JSON.stringify({ userId, v: 1, t: Date.now() }));
  } catch {
    /* quota / private mode */
  }
}

function clearSubscriptionSession() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_SUB_KEY);
  } catch {
    /* ignore */
  }
}

/** Latest GET /orders JSON for dashboard (trial countdown, refresh). Only set when access is granted. */
export function useSubscriptionPayload() {
  return useContext(SubscriptionPayloadContext);
}

const UNGATED = ["/add-package"];
/** Enough retries for transient errors; 429 uses longer waits between attempts. */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 600;
const TRIAL_POLL_MS = 45_000;
/** After rate-limit responses, wait before retrying (Render / express-rate-limit). */
const RATE_LIMIT_BACKOFF_MS = 10_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function SubscriptionGate({ children }) {
  // In the new single-user architecture, subscriptions/orders are not required.
  // We bypass the gate completely to prevent 404 errors on /api/orders.
  return (
    <SubscriptionPayloadContext.Provider value={null}>
      {children}
    </SubscriptionPayloadContext.Provider>
  );
}
