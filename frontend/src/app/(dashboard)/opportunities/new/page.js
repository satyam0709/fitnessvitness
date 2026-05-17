"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewProspectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/opportunities?create=1");
  }, [router]);

  return null;
}
