"use client";

import { useState, useEffect } from "react";
import { getAllAnalytics } from "@/lib/fitnessApi";
import styles from "./analytics.module.css";

export default function AnalyticsPage() {
  const [data, setData] = useState({
    sources: [],
    tiers: [],
    referrers: [],
    financial: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    try {
      setLoading(true);
      const results = await getAllAnalytics();
      setData(results);
    } catch (err) {
      setError("Failed to synchronize analytics engine");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Crunching real-time business data...</p>
      </div>
    );
  }

  const { sources, tiers, referrers, financial } = data;
  const totalClients = tiers.reduce((sum, t) => sum + t.client_count, 0);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Business Intelligence</h1>
        <p>Real-time performance metrics and client acquisition insights</p>
      </header>

      <div className={styles.grid}>
        {/* Source Breakdown */}
        <div className={`${styles.card} ${styles.span6}`}>
          <h2 className={styles.cardTitle}>
            <i className="fa-solid fa-chart-pie"></i> Client Acquisition Channels
          </h2>
          {sources.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Clients</th>
                  <th>Share</th>
                  <th>Avg Quality</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={s.source} className={i === 0 ? styles.highlightRow : ""}>
                    <td><strong>{s.source}</strong></td>
                    <td>{s.client_count}</td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <div style={{flex: 1, height: '4px', background: '#f1f5f9', borderRadius: '2px', overflow: 'hidden'}}>
                          <div style={{width: `${s.pct_of_total}%`, height: '100%', background: '#f5c400'}}></div>
                        </div>
                        <span style={{fontSize: '11px', fontWeight: 700}}>{s.pct_of_total}%</span>
                      </div>
                    </td>
                    <td>{s.avg_tier} ★</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No acquisition data available</div>
          )}
        </div>

        {/* Financial Snapshot */}
        <div className={`${styles.card} ${styles.span6}`}>
          <h2 className={styles.cardTitle}>
            <i className="fa-solid fa-vault"></i> Revenue Performance
          </h2>
          {financial.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Inflow</th>
                  <th>Cost</th>
                  <th>Net Profit</th>
                </tr>
              </thead>
              <tbody>
                {financial.map(f => (
                  <tr key={f.month}>
                    <td><strong>{f.month}</strong></td>
                    <td>₹{Number(f.received || 0).toLocaleString()}</td>
                    <td>₹{Number(f.cost || 0).toLocaleString()}</td>
                    <td className={Number(f.profit || 0) > 0 ? styles.profit : styles.loss}>
                      ₹{Number(f.profit || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No financial history recorded</div>
          )}
          <div className={styles.financialLink}>
            <a href="/business-tracker">Advanced Financial Analytics <i className="fa-solid fa-arrow-right"></i></a>
          </div>
        </div>

        {/* Tier Distribution */}
        <div className={`${styles.card} ${styles.span12}`}>
          <h2 className={styles.cardTitle}>
            <i className="fa-solid fa-crown"></i> Client Tier Distribution
          </h2>
          <div className={styles.tierGrid}>
            {[5, 4, 3, 2, 1].map(tier => {
              const tierData = tiers.find(t => t.tier === tier);
              const count = tierData?.client_count || 0;
              const pct = totalClients ? Math.round((count / totalClients) * 100) : 0;
              return (
                <div key={tier} className={styles.tierCard}>
                  <div className={styles.tierStars}>
                    {[...Array(tier)].map((_, i) => <i key={i} className="fa-solid fa-star"></i>)}
                  </div>
                  <div className={styles.tierCount}>{count}</div>
                  <div className={styles.tierPct}>{pct}% of base</div>
                  <div className={styles.tierTip}>
                    {tier === 5 ? "Elite Advocates" : tier === 4 ? "High Engagement" : tier === 3 ? "Standard Value" : "At Risk / Early Stage"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Referrers */}
        <div className={`${styles.card} ${styles.span12}`}>
          <h2 className={styles.cardTitle}>
            <i className="fa-solid fa-people-arrows"></i> Viral Referrers (Top Advocates)
          </h2>
          {referrers.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Advocate Name</th>
                  <th>Client Tier</th>
                  <th>Acquisition Source</th>
                  <th>Success Referrals</th>
                  <th>Influence Status</th>
                </tr>
              </thead>
              <tbody>
                {referrers.map(r => (
                  <tr key={r.client_id}>
                    <td><strong>{r.full_name}</strong> <span style={{fontSize: '11px', color: '#94a3b8'}}>{r.client_id}</span></td>
                    <td>
                      <span style={{color: '#f5c400'}}>
                        {[...Array(r.tier)].map((_, i) => <i key={i} className="fa-solid fa-star" style={{fontSize: '10px'}}></i>)}
                      </span>
                    </td>
                    <td>{r.source}</td>
                    <td><strong style={{fontSize: '16px', color: '#1e293b'}}>{r.referral_count}</strong></td>
                    <td>
                      <span style={{
                        padding: '4px 10px', 
                        borderRadius: '8px', 
                        fontSize: '11px', 
                        fontWeight: 700,
                        background: r.referral_count > 2 ? '#fef3c7' : '#f1f5f9',
                        color: r.referral_count > 2 ? '#92400e' : '#475569'
                      }}>
                        {r.referral_count > 5 ? "MEGA INFLUENCER" : r.referral_count > 2 ? "KEY ADVOCATE" : "GROWING"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No referral network detected yet</div>
          )}
        </div>
      </div>
    </div>
  );
}