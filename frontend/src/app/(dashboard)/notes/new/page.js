"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuickCreate } from "@/components/Dashboard/QuickCreateContext";

export default function NewNotePage() {
  const router = useRouter();
  const { open } = useQuickCreate();

  useEffect(() => {
    open("note");
    router.replace("/notes");
  }, [open, router]);

  return null;
}
