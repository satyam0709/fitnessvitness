const { mainPool } = require("../config/database");

async function listTenants(req, res) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT t.id, t.company_name, t.status, t.trial_ends_at, t.created_at,
              o.email AS owner_email, s.status AS subscription_status, p.name AS package_name
       FROM tenants t
       LEFT JOIN users o ON o.id = t.owner_user_id
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.tenant_id = t.id
         ORDER BY s2.created_at DESC LIMIT 1
       )
       LEFT JOIN subscription_packages p ON p.id = s.package_id
       ORDER BY t.created_at DESC`
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error("listTenants:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateTenantStatus(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: "Invalid tenant id." });
    if (!["active", "trial", "suspended", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }
    const [r] = await mainPool.execute("UPDATE tenants SET status = ?, updated_at = NOW() WHERE id = ?", [
      status,
      id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "Tenant not found." });
    res.json({ success: true });
  } catch (err) {
    console.error("updateTenantStatus:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listSubscriptions(req, res) {
  try {
    const status = String(req.query?.status || "").trim().toLowerCase();
    const conditions = ["1=1"];
    const params = [];
    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    }
    const [rows] = await mainPool.execute(
      `SELECT s.id, s.tenant_id, s.status, s.starts_at, s.ends_at, s.payment_gateway,
              t.company_name, p.name AS package_name
       FROM subscriptions s
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN subscription_packages p ON p.id = s.package_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.created_at DESC`,
      params
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error("listSubscriptions:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getSuperadminAnalytics(req, res) {
  try {
    const [[tenants]] = await mainPool.execute("SELECT COUNT(*) AS c FROM tenants");
    const [[activeSubs]] = await mainPool.execute(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trial')"
    );
    const [[expiredSubs]] = await mainPool.execute(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('expired','cancelled','suspended')"
    );
    const [[addons]] = await mainPool.execute("SELECT COALESCE(SUM(price_paid),0) AS total FROM tenant_addons");
    const [[mrr]] = await mainPool.execute(
      `SELECT COALESCE(SUM(CASE WHEN s.status = 'active' THEN
        CASE
          WHEN LOWER(COALESCE(p.billing_period, 'month')) = 'year' THEN p.price_inr / 12
          ELSE p.price_inr
        END
      ELSE 0 END), 0) AS mrr
       FROM subscriptions s
       LEFT JOIN subscription_packages p ON p.id = s.package_id`
    );
    const [[newSignups]] = await mainPool.execute(
      "SELECT COUNT(*) AS c FROM tenants WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    );
    const [[activeTrials]] = await mainPool.execute(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'trial'"
    );
    const [[trialConverted]] = await mainPool.execute(
      `SELECT COUNT(*) AS c
       FROM subscriptions
       WHERE status = 'active'
         AND starts_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    const [[cancelled]] = await mainPool.execute(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('cancelled','expired') AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    );
    const conversionRate =
      Number(activeTrials.c) + Number(trialConverted.c) > 0
        ? (Number(trialConverted.c) / (Number(activeTrials.c) + Number(trialConverted.c))) * 100
        : 0;
    const churnRate =
      Number(activeSubs.c) + Number(cancelled.c) > 0
        ? (Number(cancelled.c) / (Number(activeSubs.c) + Number(cancelled.c))) * 100
        : 0;
    res.json({
      success: true,
      data: {
        total_tenants: Number(tenants.c) || 0,
        active_subscriptions: Number(activeSubs.c) || 0,
        inactive_subscriptions: Number(expiredSubs.c) || 0,
        addons_revenue: Number(addons.total) || 0,
        mrr_inr: Number(mrr.mrr) || 0,
        new_signups_30d: Number(newSignups.c) || 0,
        trial_conversion_rate: Number(conversionRate.toFixed(2)),
        churn_rate_30d: Number(churnRate.toFixed(2)),
      },
    });
  } catch (err) {
    console.error("getSuperadminAnalytics:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listTenants,
  updateTenantStatus,
  listSubscriptions,
  getSuperadminAnalytics,
};

