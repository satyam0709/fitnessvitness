"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";

export default function NewTaskPage() {
  const router = useRouter();
  const { open } = useQuickCreate();

  useEffect(() => {
    open("task");
    router.replace("/tasks");
  }, [open, router]);

  return null;
}
