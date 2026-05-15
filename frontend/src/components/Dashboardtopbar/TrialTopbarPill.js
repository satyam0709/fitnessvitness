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

export default function TrialTopbarPill() {
  return null;
}
