"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./analytics.module.css";

export default function AnalyticsPage() {
  const [sources, setSources] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [referrers, setReferrers] = useState([]);
  const [financial, setFinancial] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    try {
      const [sRes, tRes, rRes, fRes] = await Promise.all([
        apiFetch("/fitness/analytics/sources"),
        apiFetch("/fitness/analytics/tiers"),
        apiFetch("/fitness/analytics/referrers"),
        apiFetch("/fitness/analytics/financial"),
      ]);
      const [s, t, r, f] = await Promise.all([sRes.json(), tRes.json(), rRes.json(), fRes.json()]);

      if (s.success) setSources(s.data);
      if (t.success) setTiers(t.data);
      if (r.success) setReferrers(r.data);
      if (f.success) setFinancial(f.data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className={styles.loading}>Loading analytics...</div>;

  const totalClients = tiers.reduce((sum, t) => sum + t.client_count, 0);
  const topSource = sources[0];

  return (
    <div className={styles.container}>
      <h1>Analytics</h1>

      {/* Source Breakdown */}
      <div className={styles.section}>
        <h2>Source Breakdown</h2>
        {sources.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Source</th><th>Clients</th><th>% of Total</th><th>Avg Tier</th><th>Action Tip</th></tr></thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={s.source} className={i === 0 ? styles.highlight : ""}>
                  <td><strong>{s.source}</strong></td>
                  <td>{s.client_count}</td>
                  <td>{s.pct_of_total}%</td>
                  <td>{s.avg_tier} ★</td>
                  <td>{i === 0 ? "📈 Top performing - invest more" : "💡 Test this channel"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className={styles.empty}>No source data</div>}
      </div>

      {/* Tier Distribution */}
      <div className={styles.section}>
        <h2>Tier Distribution</h2>
        {tiers.length > 0 ? (
          <div className={styles.tierGrid}>
            {[5,4,3,2,1].map(tier => {
              const tierData = tiers.find(t => t.tier === tier);
              const count = tierData?.client_count || 0;
              const pct = totalClients ? Math.round((count / totalClients) * 100) : 0;
              return (
                <div key={tier} className={styles.tierCard}>
                  <div className={styles.tierStars}>
                    {[...Array(tier)].map((_, i) => <span key={i}>★</span>)}
                  </div>
                  <div className={styles.tierCount}>{count}</div>
                  <div className={styles.tierPct}>{pct}%</div>
                  <div className={styles.tierTip}>
                    {tier >= 4 ? "VIP - Personal attention" : tier >= 3 ? "Regular - Maintain engagement" : "Needs outreach"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className={styles.empty}>No tier data</div>}
      </div>

      {/* Top Referrers */}
      <div className={styles.section}>
        <h2>Top Referrers</h2>
        {referrers.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Client</th><th>Tier</th><th>Source</th><th>Referrals</th><th>Action</th></tr></thead>
            <tbody>
              {referrers.map(r => (
                <tr key={r.client_id}>
                  <td>{r.full_name} ({r.client_id})</td>
                  <td>{"★".repeat(r.tier)}{"☆".repeat(5-r.tier)}</td>
                  <td>{r.source}</td>
                  <td><strong>{r.referral_count}</strong></td>
                  <td>🎁 Thank them personally</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className={styles.empty}>No referrals yet</div>}
      </div>

      {/* Financial Snapshot */}
      <div className={styles.section}>
        <h2>Financial Snapshot (Last 3 Months)</h2>
        {financial.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Month</th><th>Received</th><th>Pending</th><th>Cost</th><th>Profit</th></tr></thead>
            <tbody>
              {financial.map(f => (
                <tr key={f.month}>
                  <td>{f.month}</td>
                  <td>₹{Number(f.received || 0).toLocaleString()}</td>
                  <td>₹{Number(f.pending || 0).toLocaleString()}</td>
                  <td>₹{Number(f.cost || 0).toLocaleString()}</td>
                  <td className={Number(f.profit || 0) > 0 ? styles.profit : styles.loss}>₹{Number(f.profit || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className={styles.empty}>No financial data</div>}
        <div className={styles.financialLink}>
          <a href="/business-tracker">View full Business Tracker →</a>
        </div>
      </div>
    </div>
  );
}