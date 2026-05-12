"use client";

import styles from "./DashboardCharts.module.css";

/** Keys match API `byStatus`; colours from globals.css (--lead-status-*). */
const STATUS_META = [
  { key: "new", label: "New", cssVar: "--lead-status-new" },
  { key: "processing", label: "Processing", cssVar: "--lead-status-processing" },
  { key: "close_by", label: "Close-by", cssVar: "--lead-status-close-by" },
  { key: "confirm", label: "Confirm", cssVar: "--lead-status-confirm" },
  { key: "cancel", label: "Cancel", cssVar: "--lead-status-cancel" },
];

const SOURCE_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#64748b",
];

/**
 * Clear at-a-glance breakdown: proportional bar + rows with count / %.
 * Easier to read than a donut when one status dominates the pipeline.
 */
export function LeadStatusDonut({ byStatus }) {
  const rows = STATUS_META.map((m) => ({
    ...m,
    count: Math.max(0, Number(byStatus?.[m.key]) || 0),
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const active = rows.filter((r) => r.count > 0);

  const barLabel =
    total === 0
      ? "No leads in this date range"
      : `Lead status mix: ${total} total — ${active.map((r) => `${r.label} ${r.count}`).join(", ")}`;

  return (
    <div className={styles.statusChart}>
      <div className={styles.statusChartMeta}>
        <span className={styles.statusTotalValue}>{total}</span>
        <span className={styles.statusTotalLabel}>leads in range</span>
      </div>

      {total > 0 ? (
        <div
          className={styles.stackedBar}
          role="img"
          aria-label={barLabel}
        >
          {active.map((r) => (
            <div
              key={r.key}
              className={styles.stackedSeg}
              style={{
                flexGrow: r.count,
                background: `var(${r.cssVar})`,
              }}
              title={`${r.label}: ${r.count} (${Math.round((r.count / total) * 100)}%)`}
            />
          ))}
        </div>
      ) : (
        <div className={styles.statusEmptyBar} role="status">
          No data for this period
        </div>
      )}

      <ul className={styles.statusList} aria-label="Lead counts by status">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <li key={r.key} className={styles.statusRow}>
              <span
                className={styles.statusDot}
                style={{ background: `var(${r.cssVar})` }}
                aria-hidden="true"
              />
              <span className={styles.statusLabel}>{r.label}</span>
              <span className={styles.statusTrack} aria-hidden>
                <span
                  className={styles.statusTrackFill}
                  style={{
                    width: `${pct}%`,
                    background: `var(${r.cssVar})`,
                  }}
                />
              </span>
              <span className={styles.statusCount}>{r.count}</span>
              <span className={styles.statusPct}>{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function buildStackedAreaPaths(bySourceByDay, sources, width, height, pad) {
  if (!bySourceByDay?.length || !sources?.length) {
    return { paths: [], maxY: 1, legend: [] };
  }

  const n = bySourceByDay.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xAt = (i) => pad + (innerW * (n === 1 ? 0.5 : i / (n - 1)));

  let maxY = 0;
  const stacks = bySourceByDay.map((row) => {
    const layer = {};
    let t = 0;
    for (const s of sources) {
      const v = Number(row[s]) || 0;
      layer[s] = { base: t, top: t + v };
      t += v;
    }
    maxY = Math.max(maxY, t);
    return layer;
  });

  const denom = maxY <= 0 ? 1 : maxY;
  const scaleY = (v) => pad + innerH - (v / denom) * innerH;

  const paths = [];
  for (let si = 0; si < sources.length; si++) {
    const s = sources[si];
    const color = SOURCE_PALETTE[si % SOURCE_PALETTE.length];
    let d = "";
    for (let i = 0; i < n; i++) {
      const seg = stacks[i][s];
      const x = xAt(i);
      const y = scaleY(seg.top);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    for (let i = n - 1; i >= 0; i--) {
      const seg = stacks[i][s];
      const x = xAt(i);
      const y = scaleY(seg.base);
      d += ` L ${x} ${y}`;
    }
    d += " Z";
    paths.push({ key: s, d, color, label: s });
  }

  return { paths, maxY, legend: sources.map((s, i) => ({ key: s, color: SOURCE_PALETTE[i % SOURCE_PALETTE.length] })) };
}

export function LeadSourceArea({ bySourceByDay, sources }) {
  const W = 420;
  const H = 200;
  const pad = 24;
  const innerH = H - pad * 2;
  const cappedSources = (sources || []).slice(0, 10);
  const { paths, maxY, legend } = buildStackedAreaPaths(bySourceByDay, cappedSources, W, H, pad);

  return (
    <div className={styles.areaWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.areaSvg} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad + innerH * (1 - t);
          return (
            <g key={t}>
              <line x1={pad} y1={y} x2={W - pad} y2={y} stroke="var(--border, #ebebeb)" strokeWidth="1" />
            </g>
          );
        })}
        {paths.map((p) => (
          <path key={p.key} d={p.d} fill={p.color} fillOpacity={0.45} stroke={p.color} strokeWidth={1} />
        ))}
        <text x={pad} y={14} className={styles.axisLabel}>
          {maxY}
        </text>
        <text x={pad} y={H - 4} className={styles.axisLabel}>
          0
        </text>
      </svg>
      <div className={styles.legendWrap}>
        {legend.map((l) => (
          <span key={l.key} className={styles.legendItem}>
            <i className={styles.dot} style={{ background: l.color }} />
            <span className={styles.legendKey}>{l.key.replace(/_/g, " ")}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChartCardMenu() {
  return (
    <button type="button" className={styles.cardMenu} aria-label="Chart options">
      <i className="fas fa-bars" />
    </button>
  );
}
