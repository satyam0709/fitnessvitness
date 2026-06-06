"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import LeadForm from "@/components/Leads/LeadForm";
import styles from "../leads.module.css";

export default function CreateLeadPage() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <Link href="/leads" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>
        ← Back to leads
      </Link>
      <h1 style={{ marginTop: 12, marginBottom: 20 }}>Create Lead</h1>
      <div className={styles.panel} style={{ padding: 0, overflow: "hidden" }}>
        <LeadForm
          mode="create"
          onCancel={() => router.push("/leads")}
          onSuccess={(data) => {
            if (data?.id) router.push(`/leads/${data.id}`);
            else router.push("/leads");
          }}
        />
      </div>
    </div>
  );
}
