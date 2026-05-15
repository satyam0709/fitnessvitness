"use client";

import { useMemo, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Sector,
} from "recharts";
import styles from "./RevenuePieCard.module.css";

const RADIAN = Math.PI / 180;

function fmtInr(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/** Spectrum similar to reference: warm to cool, enough for 10+ slices */
const DEFAULT_PALETTE = [
  "#f97316",
  "#ef4444",
  "#facc15",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#2dd4bf",
  "#22d3ee",
  "#38bdf8",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function pctSliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  const ir = innerRadius ?? 0;
  const or = outerRadius ?? 0;
  const r = ir + (or - ir) * 0.52;
  const x = cx + r * Math.cos(-RADIAN * midAngle);
  const y = cy + r * Math.sin(-RADIAN * midAngle);
  const n = Math.round((percent || 0) * 100);
  if (n === 0 && (percent || 0) < 0.005) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      className={styles.sliceLabel}
    >
      {n}
    </text>
  );
}

function PieTooltip({ active, payload, valueFormat }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const fmt = valueFormat === "inr" ? fmtInr : (v) => String(Number(v).toFixed(2));
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{p.name}</div>
      {Array.isArray(p.tooltipLines) && p.tooltipLines.length > 0 ? (
        p.tooltipLines.map((line, i) => (
          <div key={i} className={styles.tooltipLine}>
            {line}
          </div>
        ))
      ) : (
        <>
          <div className={styles.tooltipLine}>Amount: {fmt(p.value)}</div>
          {p.count != null ? (
            <div className={styles.tooltipLine}>Count: {p.count}</div>
          ) : null}
          <div className={styles.tooltipLine}>Share: {p.pct}%</div>
        </>
      )}
    </div>
  );
}

/**
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   loading?: boolean,
 *   slices: Array<{ name: string, value: number, count?: number, tooltipLines?: string[] }>,
 *   emptyLabel?: string,
 *   height?: number,
 *   valueFormat?: "inr" | "plain",
 *   colorForSlice?: string[] | ((name: string, index: number) => string),
 * }} props
 */
export function RevenuePieCard({
  title,
  subtitle,
  loading = false,
  slices,
  emptyLabel = "No data in this range",
  height = 280,
  valueFormat = "inr",
  colorForSlice,
}) {
  const { rows, explodeIdx } = useMemo(() => {
    const total = (slices || []).reduce((a, s) => a + (Number(s.value) || 0), 0);
    const list = (slices || [])
      .map((s, idx) => {
        const value = Number(s.value) || 0;
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
        return {
          name: s.name,
          value,
          count: s.count,
          pct,
          tooltipLines: s.tooltipLines,
          _i: idx,
        };
      })
      .filter((s) => s.value > 0);

    if (list.length < 2) return { rows: list, explodeIdx: undefined };
    let max = -Infinity;
    let idx = 0;
    list.forEach((r, i) => {
      if (r.value > max) {
        max = r.value;
        idx = i;
      }
    });
    return { rows: list, explodeIdx: idx };
  }, [slices]);

  const sectorShape = useCallback(
    (props) => {
      const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, midAngle, index } = props;
      const ma = midAngle ?? (startAngle + endAngle) / 2;
      const pull = explodeIdx !== undefined && index === explodeIdx;
      const dx = pull ? 12 * Math.cos(-RADIAN * ma) : 0;
      const dy = pull ? 12 * Math.sin(-RADIAN * ma) : 0;
      return (
        <Sector
          cx={cx + dx}
          cy={cy + dy}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      );
    },
    [explodeIdx]
  );

  const cellFill = (name, i) => {
    if (typeof colorForSlice === "function") return colorForSlice(name, i);
    if (Array.isArray(colorForSlice)) return colorForSlice[i % colorForSlice.length];
    return DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
      </div>
      <div className={styles.body}>
        {loading ? (
          <div className={styles.state}>
            <div className={styles.spinner} />
            <span>Loading…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.state}>{emptyLabel}</div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart margin={{ top: 16, right: 108, left: 8, bottom: 16 }}>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                cx="42%"
                cy="50%"
                innerRadius={0}
                outerRadius={92}
                paddingAngle={0.5}
                labelLine={false}
                label={pctSliceLabel}
                shape={sectorShape}
              >
                {rows.map((entry, i) => (
                  <Cell key={`${entry.name}-${i}`} fill={cellFill(entry.name, i)} stroke="none" />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip valueFormat={valueFormat} />} />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="square"
                wrapperStyle={{ top: "10%", right: 0, lineHeight: "1.35" }}
                formatter={(value) => <span className={styles.legend}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
