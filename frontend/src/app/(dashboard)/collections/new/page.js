"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CollectionsNewPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/collections?create=1");
  }, [router]);
  return null;
}
