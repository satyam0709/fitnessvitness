"use client";

import { RevenuePieCard } from "@/components/Dashboard/RevenuePieCard";
import styles from "./FitnessTransactionPies.module.css";

const TYPE_COLORS = {
  Membership: "#0ea5e9",
  Supplement: "#10b981",
  Other: "#64748b",
};
const PAY_PALETTE = ["#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#eab308", "#14b8a6", "#94a3b8"];

function fmtInr(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function buildSlices(rows, totalKey, tooltipBuilder) {
  const total = (rows || []).reduce((a, r) => a + (Number(r[totalKey]) || 0), 0);
  return (rows || []).map((r) => {
    const value = Number(r[totalKey]) || 0;
    const share = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
    return {
      name: r.key_label || "—",
      value,
      count: Number(r.cnt) || 0,
      tooltipLines: tooltipBuilder(r, share),
    };
  });
}

/**
 * @param {{ data: object | null, loading: boolean, embedded?: boolean, wrapClassName?: string }} props
 */
export function FitnessTransactionPies({ data, loading, embedded = false, wrapClassName = "" }) {
  const byTypeRaw = data?.byType || [];
  const byPayRaw = data?.byPayMode || [];
  const typeSlices = buildSlices(byTypeRaw, "received", (r, share) => [
    `Received: ${fmtInr(r.received)}`,
    `Pending: ${fmtInr(r.pending)}`,
    `Profit: ${fmtInr(r.profit)}`,
    `${Number(r.cnt) || 0} transaction(s)`,
    `Share: ${share}%`,
  ]);
  const paySlices = buildSlices(byPayRaw, "received", (r, share) => [
    `Received: ${fmtInr(r.received)}`,
    `Pending: ${fmtInr(r.pending)}`,
    `${Number(r.cnt) || 0} transaction(s)`,
    `Share: ${share}%`,
  ]);

  const range = data?.range;
  const rangeLabel =
    range?.from && range?.to
      ? `${new Date(range.from + "T12:00:00").toLocaleDateString("en-IN")} – ${new Date(range.to + "T12:00:00").toLocaleDateString("en-IN")}`
      : "";

  const grid = (
    <div className={styles.grid}>
      <RevenuePieCard
        title="Revenue by transaction type"
        subtitle={rangeLabel || undefined}
        loading={loading}
        slices={typeSlices}
        emptyLabel="No transactions in this range"
        colorForSlice={(name) => TYPE_COLORS[name] || "#94a3b8"}
      />
      <RevenuePieCard
        title="Payments by mode"
        loading={loading}
        slices={paySlices}
        emptyLabel="No transactions in this range"
        colorForSlice={(_, i) => PAY_PALETTE[i % PAY_PALETTE.length]}
      />
    </div>
  );

  if (embedded) {
    return (
      <div className={[styles.embeddedWrap, wrapClassName].filter(Boolean).join(" ")}>
        <div className={styles.embeddedHead}>
          <span className={styles.embeddedTitle}>
            <i className="fas fa-chart-pie" aria-hidden />
            Fitness revenue mix
          </span>
          {rangeLabel ? <span className={styles.embeddedMeta}>Received · {rangeLabel}</span> : null}
        </div>
        {grid}
      </div>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          <i className="fas fa-chart-pie" aria-hidden />
          Fitness revenue mix
        </h2>
        {rangeLabel ? <div className={styles.sectionMeta}>Received · {rangeLabel}</div> : null}
      </div>
      {grid}
    </section>
  );
}
