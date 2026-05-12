"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";

export default function NewReminderPage() {
  const router = useRouter();
  const { open } = useQuickCreate();

  useEffect(() => {
    open("reminder");
    router.replace("/reminders");
  }, [open, router]);

  return null;
}
