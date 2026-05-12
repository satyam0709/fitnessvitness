"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";

export default function NewMeetingPage() {
  const router = useRouter();
  const { open } = useQuickCreate();

  useEffect(() => {
    open("meeting");
    router.replace("/meetings");
  }, [open, router]);

  return null;
}
