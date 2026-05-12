"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";

/** Sidebar / deep link: open Add Lead overlay, then stay on leads list (no second page). */
export default function NewLeadPage() {
  const router = useRouter();
  const { open } = useQuickCreate();

  useEffect(() => {
    open("lead");
    router.replace("/leads");
  }, [open, router]);

  return null;
}
