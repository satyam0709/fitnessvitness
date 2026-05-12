"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionPayload } from "@/components/SubscriptionGate/subscriptionGate";
import { apiFetch } from "@/lib/api";
import { remainingPartsFromTrialEndsAt } from "@/lib/trialAccess";
import styles from "./dashboardtopbar.module.css";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Shows live trial countdown (days / hours / minutes / seconds) from backend end time. */
export default function TrialTopbarPill() {
  const { userId } = useAuth();
  const ctx = useSubscriptionPayload();
  const [, bump] = useState(0);
  const [fallbackEndsAt, setFallbackEndsAt] = useState(null);
  const [fallbackPlan, setFallbackPlan] = useState(null);

  const te = ctx?.payload?.trialEligibility;
  const endsAt = te?.trialEndsAt || fallbackEndsAt;
  const planName = te?.planName || fallbackPlan || "CRM";

  useEffect(() => {
    const id = setInterval(() => bump((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (te?.reason === "on_trial" && te.trialEndsAt) {
      setFallbackEndsAt(null);
      setFallbackPlan(null);
      return;
    }
    if (!userId || ctx?.payload) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/orders");
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data.success) return;
        const t = data.trialEligibility;
        if (t?.reason === "on_trial" && t.trialEndsAt) {
          setFallbackEndsAt(t.trialEndsAt);
          setFallbackPlan(t.planName || null);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, te?.reason, te?.trialEndsAt, ctx?.payload]);

  if (!endsAt || te?.reason === "subscribed") return null;

  const parts = remainingPartsFromTrialEndsAt(endsAt);
  if (parts.expired) return null;

  const label = `${parts.days}d ${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)} left · ${planName} trial`;

  return (
    <Link
      href="/add-package"
      className={styles.trialPill}
      title="Upgrade or subscribe before your trial ends"
    >
      <i className="fas fa-hourglass-half" aria-hidden />
      <span className={styles.trialPillText}>{label}</span>
    </Link>
  );
}
