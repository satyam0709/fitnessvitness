"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { RevenuePieCard } from "@/components/Dashboard/RevenuePieCard";
import { apiFetch, getApiBase } from "@/lib/api";
import styles from "./reports.module.css";

const TABS = [
  { id: "pipeline", label: "Pipeline", exportType: "leads" },
  { id: "conversion", label: "Conversion", exportType: "leads" },
  { id: "activity", label: "Activity", exportType: "tasks" },
  { id: "revenue", label: "Revenue", exportType: "invoices" },
];

function formatNum(n) {
  return Number(n || 0).toLocaleString("en-IN");
}

function formatInr(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

function labelPretty(s) {
  return String(s || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPct(n) {
  return `${Number(n || 0).toFixed(2)}%`;
}

function growthPct(thisMonth, lastMonth) {
  const a = Number(thisMonth || 0);
  const b = Number(lastMonth || 0);
  if (b === 0) return a > 0 ? 100 : 0;
  return Number((((a - b) / b) * 100).toFixed(2));
}

export default function ReportsPage() {
  const { isLoaded } = useAuth();
  const [activeTab, setActiveTab] = useState("pipeline");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState({
    pipeline: [],
    conversion: [],
    activity: [],
    revenue: [],
    invoiceMix: null,
  });

  const loadReports = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError("");
    try {
      const qp = new URLSearchParams();
      if (dateFrom) qp.set("date_from", dateFrom);
      if (dateTo) qp.set("date_to", dateTo);
      const q = qp.toString();
      const suffix = q ? `?${q}` : "";
      const [pipelineRes, conversionRes, activityRes, revenueRes, invoiceMixRes] = await Promise.all([
        apiFetch(`/reports/pipeline${suffix}`),
        apiFetch(`/reports/conversion${suffix}`),
        apiFetch(`/reports/activity${suffix}`),
        apiFetch(`/reports/revenue${suffix}`),
        apiFetch(`/reports/invoice-mix${suffix}`),
      ]);

      const responses = [pipelineRes, conversionRes, activityRes, revenueRes, invoiceMixRes];
      for (const res of responses) {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `Failed to load reports (${res.status})`);
        }
      }

      const [pipeline, conversion, activity, revenue, invoiceMixBody] = await Promise.all([
        pipelineRes.json(),
        conversionRes.json(),
        activityRes.json(),
        revenueRes.json(),
        invoiceMixRes.json(),
      ]);

      setData({
        pipeline: pipeline.data || [],
        conversion: conversion.data || [],
        activity: activity.data || [],
        revenue: revenue.data || [],
        invoiceMix: invoiceMixBody.data || null,
      });
    } catch (e) {
      setError(e.message || "Could not load reports");
      setData({ pipeline: [], conversion: [], activity: [], revenue: [], invoiceMix: null });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, isLoaded]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const summary = useMemo(() => {
    const pipelineTotal = data.pipeline.reduce((acc, r) => acc + Number(r.count || 0), 0);

    const convNow = data.conversion[data.conversion.length - 1] || {};
    const convPrev = data.conversion[data.conversion.length - 2] || {};

    const activitySorted = [...data.activity].sort((a, b) => Number(b.total_activity || 0) - Number(a.total_activity || 0));
    const activityTop = activitySorted[0] || {};
    const activitySecond = activitySorted[1] || {};

    const revNow = data.revenue[data.revenue.length - 1] || {};
    const revPrev = data.revenue[data.revenue.length - 2] || {};

    return {
      pipeline: {
        total: pipelineTotal,
        thisMonth: pipelineTotal,
        change: 0,
      },
      conversion: {
        total: convNow.total_leads || 0,
        thisMonth: convNow.conversion_rate || 0,
        change: growthPct(convNow.conversion_rate || 0, convPrev.conversion_rate || 0),
      },
      activity: {
        total: data.activity.reduce((acc, r) => acc + Number(r.total_activity || 0), 0),
        thisMonth: activityTop.total_activity || 0,
        change: growthPct(activityTop.total_activity || 0, activitySecond.total_activity || 0),
      },
      revenue: {
        total: data.revenue.reduce((acc, r) => acc + Number(r.revenue_total || 0), 0),
        thisMonth: revNow.revenue_total || 0,
        change: growthPct(revNow.revenue_total || 0, revPrev.revenue_total || 0),
      },
    };
  }, [data]);

  const invoicePieSlices = useMemo(() => {
    const mix = data.invoiceMix;
    if (!mix) return { status: [], type: [] };
    const tot = Number(mix.totals?.amount) || 0;
    const mapRow = (r) => {
      const v = Number(r.amount) || 0;
      const share = tot > 0 ? ((v / tot) * 100).toFixed(1) : "0.0";
      return {
        name: labelPretty(r.key_label),
        value: v,
        count: r.cnt,
        tooltipLines: [
          `Total: ${formatInr(v)}`,
          `${Number(r.cnt) || 0} invoice(s)`,
          `Share of range: ${share}%`,
        ],
      };
    };
    return {
      status: (mix.byStatus || []).map(mapRow),
      type: (mix.byType || []).map(mapRow),
    };
  }, [data.invoiceMix]);

  const activeMeta = TABS.find((t) => t.id === activeTab) || TABS[0];

  async function exportCsv(type) {
    try {
      const qp = new URLSearchParams();
      if (dateFrom) qp.set("date_from", dateFrom);
      if (dateTo) qp.set("date_to", dateTo);
      const q = qp.toString();
      const res = await fetch(`${getApiBase()}/reports/export/${type}${q ? `?${q}` : ""}`, { credentials: "include", 
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reports-${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not export CSV");
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headRow}>
        <h1 className={styles.title}>Reports</h1>
        <button type="button" className={styles.btnPrimary} onClick={() => exportCsv(activeMeta.exportType)}>
          Export CSV
        </button>
      </div>

      <div className={styles.tabRow}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.filterRow}>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>From</span>
          <input type="date" className={styles.filterInput} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <span className={styles.filterLabel}>To</span>
          <input type="date" className={styles.filterInput} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button type="button" className={styles.btnGhost} onClick={() => { setDateFrom(""); setDateTo(""); }}>
          Clear dates
        </button>
      </div>

      {error ? (
        <div className={styles.errorBox}>
          {error}{" "}
          <button type="button" className={styles.btnGhost} onClick={loadReports}>
            Try again
          </button>
        </div>
      ) : null}

      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total</span>
          <strong className={styles.metricValue}>{formatNum(summary[activeTab].total)}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>This month</span>
          <strong className={styles.metricValue}>
            {activeTab === "conversion" ? formatPct(summary[activeTab].thisMonth) : formatNum(summary[activeTab].thisMonth)}
          </strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Change vs last month</span>
          <strong className={styles.metricValue}>{formatPct(summary[activeTab].change)}</strong>
        </div>
      </div>

      {loading ? (
        <div className={styles.chartCard}>
          <div className={styles.empty}>Loading report...</div>
        </div>
      ) : (
        <>
          <div className={styles.chartCard}>
            {activeTab === "pipeline" ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={data.pipeline}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="status" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#f5c400" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : activeTab === "conversion" ? (
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={data.conversion}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total_leads" stroke="#f59e0b" strokeWidth={2} />
                  <Line type="monotone" dataKey="won_leads" stroke="#16a34a" strokeWidth={2} />
                  <Line type="monotone" dataKey="conversion_rate" stroke="#2563eb" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : activeTab === "activity" ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={data.activity}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="user_name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="tasks_completed" fill="#f59e0b" />
                  <Bar dataKey="notes_added" fill="#22c55e" />
                  <Bar dataKey="calls_logged" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={data.revenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue_total" stroke="#f5c400" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {activeTab === "revenue" ? (
            <>
              <div className={styles.pieRow}>
                <RevenuePieCard
                  title="Invoice totals by status"
                  slices={invoicePieSlices.status}
                  emptyLabel="No invoices in this range"
                />
                <RevenuePieCard
                  title="Invoice totals by type"
                  slices={invoicePieSlices.type}
                  emptyLabel="No invoices in this range"
                />
              </div>
              {data.invoiceMix?.totals ? (
                <div className={styles.invoiceMixSummary}>
                  In selected range: <strong>{formatInr(data.invoiceMix.totals.amount)}</strong> total across{" "}
                  {formatNum(data.invoiceMix.totals.count)} invoice(s).
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
