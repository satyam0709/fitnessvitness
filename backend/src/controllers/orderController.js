const { mainPool } = require("../config/database");
const { isPlatformSuperAdmin } = require("../middleware/platformAdmin");
const { emitAdminChanged, emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");

/** Exact trial window: 7 × 24 × 60 × 60 seconds from `created_at` (not calendar days). */
const TRIAL_SECONDS = 7 * 24 * 60 * 60;
const TRIAL_MS = TRIAL_SECONDS * 1000;
const TRIAL_DAYS = 7;

const { resolveTrialPlanBySlug } = require("../services/packageCatalogService");
const { onTrialWorkspaceSubscription } = require("../services/workspacePurchaseHook");
const { getTenantContextForUser } = require("../services/tenantAccessService");

/** Same live/trial rules as `enforceSubscription` in tenantAccess middleware. */
function tenantSubscriptionGrantsAppAccess(ctx) {
  const sub = ctx?.subscription;
  if (!sub) return false;
  const status = String(sub.status || "").toLowerCase();
  if (!["trial", "active"].includes(status)) return false;
  if (sub.ends_at && new Date(sub.ends_at).getTime() < Date.now()) return false;
  return true;
}

function clerkId(req) {
  if (req.user?.clerkUserId) return String(req.user.clerkUserId);
  if (req.user?.id != null) return String(req.user.id);
  return req.auth?.userId || null;
}

function orderUserIdCandidates(reqOrId) {
  if (typeof reqOrId === "string" || typeof reqOrId === "number") {
    return [String(reqOrId)].filter(Boolean);
  }
  const req = reqOrId || {};
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(req.user?.clerkUserId);
  push(req.user?.clerk_user_id);
  push(req.user?.id);
  push(req.auth?.userId);
  return out;
}

function trialStartMs(createdAt) {
  const t = new Date(createdAt).getTime();
  return Number.isNaN(t) ? null : t;
}

function trialEndMs(createdAt) {
  const t = trialStartMs(createdAt);
  if (t == null) return null;
  return t + TRIAL_MS;
}

function trialEndIso(createdAt) {
  const end = trialEndMs(createdAt);
  if (end == null) return null;
  return new Date(end).toISOString();
}

function trialStartedIso(createdAt) {
  const t = trialStartMs(createdAt);
  if (t == null) return null;
  return new Date(t).toISOString();
}

/** Split remaining time from milliseconds until trial end. */
function splitRemaining(ms) {
  if (ms <= 0) {
    return { totalSeconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSeconds = Math.floor(ms / 1000);
  let s = totalSeconds;
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return { totalSeconds, days, hours, minutes, seconds };
}

/** Whole days left (ceil), for legacy UI. */
function trialDaysRemaining(createdAt, nowMs = Date.now()) {
  const end = trialEndMs(createdAt);
  if (end == null) return null;
  const ms = end - nowMs;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

/** True if this order row currently grants app access (trial not past wall-clock end). */
function isOrderGrantingAccess(row) {
  if (!row) return false;
  if (row.status === "active") return true;
  if (row.status !== "trial") return false;
  const end = trialEndMs(row.created_at);
  if (end == null) return false;
  return end > Date.now();
}

/** Mark trials past the exact 604800s window as expired so gates and eligibility stay accurate. */
async function expireStaleTrials(reqOrIds) {
  const ids = orderUserIdCandidates(reqOrIds);
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await mainPool.execute(
    `UPDATE orders SET status = 'expired', updated_at = NOW()
     WHERE user_id IN (${placeholders}) AND status = 'trial'
       AND TIMESTAMPADD(SECOND, ?, created_at) <= NOW()`,
    [...ids, TRIAL_SECONDS]
  );
}

function buildSubscriptionAccess(rows, serverNow) {
  const live = rows.find((r) => isOrderGrantingAccess(r));
  const serverIso = serverNow.toISOString();
  if (!live) {
    return { granted: false, source: null, serverNow: serverIso };
  }
  if (live.status === "active") {
    return { granted: true, source: "active", serverNow: serverIso };
  }
  const endMs = trialEndMs(live.created_at);
  const remainingMs = endMs - serverNow.getTime();
  return {
    granted: true,
    source: "trial",
    serverNow: serverIso,
    trial: {
      orderId: live.id,
      planName: live.package_name || null,
      startedAt: trialStartedIso(live.created_at),
      endsAt: trialEndIso(live.created_at),
      remaining: splitRemaining(remainingMs),
    },
  };
}

function buildTrialEligibility(rows, _orderCount, serverNow) {
  const live = rows.find((r) => isOrderGrantingAccess(r));
  if (live) {
    const out = {
      eligible: false,
      reason: live.status === "trial" ? "on_trial" : "subscribed",
      planName: live.package_name || null,
      serverNow: serverNow.toISOString(),
    };
    if (live.status === "trial") {
      const endMs = trialEndMs(live.created_at);
      const remainingMs = endMs - serverNow.getTime();
      out.trialStartedAt = trialStartedIso(live.created_at);
      out.trialEndsAt = trialEndIso(live.created_at);
      out.trialDaysTotal = TRIAL_DAYS;
      out.trialDaysRemaining = trialDaysRemaining(live.created_at, serverNow.getTime());
      out.remaining = splitRemaining(remainingMs);
    }
    return out;
  }
  const hadTrialBefore = rows.some((r) => {
    const status = String(r?.status || "").toLowerCase();
    return status === "trial" || status === "expired";
  });
  if (hadTrialBefore) {
    return {
      eligible: false,
      reason: "already_registered",
      message: "Your free trial was used. Subscribe to continue.",
      serverNow: serverNow.toISOString(),
    };
  }
  return { eligible: true, trialDays: TRIAL_DAYS, trialSeconds: TRIAL_SECONDS, serverNow: serverNow.toISOString() };
}

const startTrial = async (req, res) => {
  try {
    const clerkUserId = clerkId(req);
    if (!clerkUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const planId = String(req.body?.plan_id || req.body?.planId || "").toLowerCase().trim();
    const currency = String(req.body?.currency || "INR").toUpperCase().slice(0, 3) || "INR";

    const userIdCandidates = orderUserIdCandidates(req);
    await expireStaleTrials(userIdCandidates);

    const [priorOrders] = await mainPool.execute(
      `SELECT status, created_at
       FROM orders
       WHERE user_id IN (${userIdCandidates.map(() => "?").join(",")})
       ORDER BY created_at DESC`,
      userIdCandidates
    );
    const hasLiveAccess = priorOrders.some((o) => isOrderGrantingAccess(o));
    const usedTrialBefore = priorOrders.some((o) => {
      const s = String(o?.status || "").toLowerCase();
      return s === "trial" || s === "expired";
    });
    if (hasLiveAccess) {
      return res.status(409).json({
        success: false,
        message: "Your plan is already active or currently on trial.",
        code: "TRIAL_NOT_NEEDED",
      });
    }
    if (usedTrialBefore) {
      return res.status(409).json({
        success: false,
        message:
          "The free 7-day trial is only available when you first register. Please subscribe to a plan.",
        code: "TRIAL_NOT_ELIGIBLE",
      });
    }

    const ctx = await getTenantContextForUser(req.user || {});
    if (tenantSubscriptionGrantsAppAccess(ctx)) {
      return res.status(409).json({
        success: false,
        code: "TRIAL_ALREADY_ACTIVE",
        message: "Your workspace trial is already active.",
      });
    }

    const planRow = await resolveTrialPlanBySlug(planId);
    if (!planRow) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan. Choose an active package from the catalog.",
      });
    }
    const packageName = planRow.name;
    const rawAddons = Array.isArray(req.body?.addons) ? req.body.addons : [];
    const trialAddons = rawAddons.map((a) => ({
      id: a?.id != null ? String(a.id) : "",
      name: a?.name != null ? String(a.name) : "",
      priceRaw:
        typeof a?.priceRaw === "number"
          ? a.priceRaw
          : parseFloat(String(a?.priceRaw || a?.price || "").replace(/[₹$,]/g, "")) || 0,
      period: a?.period != null ? String(a.period) : "",
    }));

    const [result] = await mainPool.execute(
      `INSERT INTO orders
        (user_id, package_name, package_price, currency, addons, subtotal, gst, total, status)
       VALUES (?, ?, 0, ?, ?, 0, 0, 0, 'trial')`,
      [clerkUserId, packageName, currency, JSON.stringify(trialAddons)]
    );

    const workspaceHookUserId = req.user?.id != null ? String(req.user.id) : clerkUserId;
    await onTrialWorkspaceSubscription(workspaceHookUserId, packageName).catch((e) =>
      console.error("onTrialWorkspaceSubscription:", e.message)
    );

    const [[inserted]] = await mainPool.execute(
      "SELECT created_at FROM orders WHERE id = ? LIMIT 1",
      [result.insertId]
    );
    const createdAt = inserted?.created_at;

    emitAdminChanged({ scope: "orders", reason: "self_service_trial" });
    res.status(201).json({
      success: true,
      message: `Your 7-day free ${packageName} trial has started. Enjoy full access!`,
      order_id: result.insertId,
      trial: {
        planId: planRow.slug,
        planName: packageName,
        days: TRIAL_DAYS,
        seconds: TRIAL_SECONDS,
        startedAt: trialStartedIso(createdAt),
        endsAt: trialEndIso(createdAt),
        remaining: splitRemaining(trialEndMs(createdAt) - Date.now()),
      },
    });
  } catch (err) {
    console.error("startTrial error:", err);
    res.status(500).json({ success: false, message: "Could not start trial." });
  }
};

// ── BUG FIX: Original orderController used req.auth.userId
// but clerkVerify sets req.user. We now support BOTH via clerkVerify fix.
// Also fixed: price parsing from cart (priceRaw vs price string like "₹2750")

const placeOrder = async (req, res) => {
  try {
    const clerkUserId = clerkId(req);

    if (!clerkUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userIdCandidates = orderUserIdCandidates(req);
    await expireStaleTrials(userIdCandidates);

    const {
      package_name,
      package_price,
      currency,
      addons,
      subtotal,
      gst,
      total,
    } = req.body;

    // BUG FIX: Validate that there's something to order
    if (!package_name && (!Array.isArray(addons) || addons.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "No items in order. Please select a plan or addon.",
      });
    }

    // BUG FIX: Sanitize numeric values — frontend sends strings like "₹2750"
    const sanitizePrice = (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[₹$,]/g, "").trim();
        return parseFloat(cleaned) || 0;
      }
      return 0;
    };

    const cleanPackagePrice = sanitizePrice(package_price);
    const cleanSubtotal = sanitizePrice(subtotal);
    const cleanGst = sanitizePrice(gst);
    const cleanTotal = sanitizePrice(total);

    // Sanitize addon prices too
    const cleanAddons = Array.isArray(addons)
      ? addons.map((a) => ({
          ...a,
          priceRaw: sanitizePrice(a.priceRaw || a.price),
          price: sanitizePrice(a.priceRaw || a.price),
        }))
      : [];

    // BUG FIX: Check if user already has an active/trial order
    // Don't block, just log — admin can manage statuses
    const [existingOrders] = await mainPool.execute(
      `SELECT id, status
       FROM orders
       WHERE user_id IN (${userIdCandidates.map(() => "?").join(",")})
       ORDER BY created_at DESC
       LIMIT 1`,
      userIdCandidates
    );

    const existingActive = existingOrders.find((o) => isOrderGrantingAccess(o));

    if (existingActive) {
      // Update existing order instead of creating duplicate
      await mainPool.execute(
        `UPDATE orders SET 
          package_name = ?, 
          package_price = ?,
          currency = ?,
          addons = ?,
          subtotal = ?,
          gst = ?,
          total = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          package_name || null,
          cleanPackagePrice,
          currency || "INR",
          JSON.stringify(cleanAddons),
          cleanSubtotal,
          cleanGst,
          cleanTotal,
          existingActive.id,
        ]
      );

      emitAdminChanged({ scope: "orders", reason: "place_order_update" });
      if (req.user?.tenantId || req.user?.tenant_id) {
        emitWorkspaceAccessChanged({ tenantId: req.user?.tenantId || req.user?.tenant_id, reason: "order_updated" });
      }
      return res.json({
        success: true,
        message: "Order updated successfully.",
        order_id: existingActive.id,
      });
    }

    // Create new order with 'trial' status
    const [result] = await mainPool.execute(
      `INSERT INTO orders 
        (user_id, package_name, package_price, currency, addons, subtotal, gst, total, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'trial')`,
      [
        clerkUserId,
        package_name || null,
        cleanPackagePrice,
        currency || "INR",
        JSON.stringify(cleanAddons),
        cleanSubtotal,
        cleanGst,
        cleanTotal,
      ]
    );

    emitAdminChanged({ scope: "orders", reason: "place_order_insert" });
    if (req.user?.tenantId || req.user?.tenant_id) {
      emitWorkspaceAccessChanged({ tenantId: req.user?.tenantId || req.user?.tenant_id, reason: "order_created" });
    }
    res.json({
      success: true,
      message: "Order placed successfully. Your 7-day free trial has started!",
      order_id: result.insertId,
    });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ success: false, message: "Failed to place order." });
  }
};

const getOrders = async (req, res) => {
  try {
    if (isPlatformSuperAdmin(req.user)) {
      const serverNow = new Date();
      return res.json({
        success: true,
        orders: [],
        trialEligibility: {
          eligible: false,
          reason: "platform_operator",
          serverNow: serverNow.toISOString(),
        },
        subscriptionAccess: {
          granted: true,
          source: "platform_admin",
          isAdmin: true,
          serverNow: serverNow.toISOString(),
        },
      });
    }

    const clerkUserId = clerkId(req);

    if (!clerkUserId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Ensure tenant_id + invited_by are loaded; verifyToken does not select invited_by,
    // and JWT may omit tenant_id for newly-invited users on first request.
    let invitedBy = null;
    {
      try {
        const [[dbUser]] = await mainPool.execute(
          "SELECT tenant_id, role, invited_by FROM users WHERE id = ? LIMIT 1",
          [req.user.id]
        );
        if (dbUser?.tenant_id && !req.user.tenant_id && !req.user.tenantId) {
          req.user.tenant_id = dbUser.tenant_id;
          req.user.tenantId = dbUser.tenant_id;
        }
        invitedBy = dbUser?.invited_by ?? null;
        if (invitedBy == null) {
          const [[invitationRow]] = await mainPool.execute(
            `SELECT invited_by
             FROM user_invitations
             WHERE user_id = ?
             ORDER BY COALESCE(accepted_at, created_at) DESC, created_at DESC
             LIMIT 1`,
            [req.user.id]
          );
          invitedBy = invitationRow?.invited_by ?? null;
        }
      } catch (err) {
        // Keep /orders functional on environments where invited_by hasn't been migrated yet.
        console.warn("getOrders invited_by lookup skipped:", err.message);
      }
    }

    const userIdCandidates = orderUserIdCandidates(req);
    await expireStaleTrials(userIdCandidates);

    const [[{ orderCount }]] = await mainPool.execute(
      `SELECT COUNT(*) AS orderCount FROM orders WHERE user_id IN (${userIdCandidates.map(() => "?").join(",")})`,
      userIdCandidates
    );

    const [rows] = await mainPool.execute(
      `SELECT 
        id,
        user_id,
        package_name,
        package_price,
        currency,
        addons,
        subtotal,
        gst,
        total,
        status,
        created_at,
        COALESCE(updated_at, created_at) as updated_at
       FROM orders 
       WHERE user_id IN (${userIdCandidates.map(() => "?")})
       ORDER BY created_at DESC`,
      userIdCandidates
    );

    // BUG FIX: Parse addons JSON safely
    const orders = rows.map((order) => ({
      ...order,
      addons: (() => {
        try {
          return typeof order.addons === "string"
            ? JSON.parse(order.addons)
            : order.addons || [];
        } catch {
          return [];
        }
      })(),
    }));

    const serverNow = new Date();
    let trialEligibility = buildTrialEligibility(orders, Number(orderCount) || 0, serverNow);
    let subscriptionAccess = buildSubscriptionAccess(orders, serverNow);

    if (!subscriptionAccess.granted && req.user) {
      const tid = req.user.tenantId ?? req.user.tenant_id ?? null;
      if (tid) {
        const ctxUser = {
          id: req.user.id,
          role: req.user.role,
          tenant_id: tid,
          tenantId: tid,
          clerkUserId: req.user.clerkUserId,
          clerk_user_id: req.user.clerkUserId,
          is_platform_admin: req.user.is_platform_admin,
        };
        const ctx = await getTenantContextForUser(ctxUser);
        if (ctx?.tenantId && (ctx.hasWorkspaceAccess === true || tenantSubscriptionGrantsAppAccess(ctx))) {
          const serverIso = serverNow.toISOString();
          subscriptionAccess = {
            granted: true,
            source: "tenant_subscription",
            serverNow: serverIso,
            workspaceTenantId: ctx.tenantId,
          };
          const sub = ctx.subscription;
          if (
            tenantSubscriptionGrantsAppAccess(ctx) &&
            String(sub?.status || "").toLowerCase() === "trial" &&
            sub?.ends_at
          ) {
            subscriptionAccess.trial = {
              endsAt: new Date(sub.ends_at).toISOString(),
            };
          }
          const isWorkspaceTrial = String(sub?.status || "").toLowerCase() === "trial";
          trialEligibility = {
            eligible: false,
            reason: isWorkspaceTrial ? "workspace_trial_active" : "workspace_subscription",
            message: isWorkspaceTrial
              ? "Your workspace trial is already active. You can continue with secure payment anytime."
              : "Your workspace subscription is already active.",
            serverNow: serverIso,
          };
        }
      }
    }

    if (!subscriptionAccess.granted) {
      const tid = req.user.tenantId ?? req.user.tenant_id ?? null;
      if (tid && invitedBy != null) {
        const serverIso = serverNow.toISOString();
        subscriptionAccess = {
          granted: true,
          source: "invited_member",
          isAdmin: false,
          serverNow: serverIso,
          workspaceTenantId: tid,
        };
        trialEligibility = {
          eligible: false,
          reason: "invited_member",
          serverNow: serverIso,
        };
      }
    }

    if (!subscriptionAccess.granted) {
      const tid = req.user.tenantId ?? req.user.tenant_id ?? null;
      if (tid && !isPlatformSuperAdmin(req.user)) {
        try {
          const [[ownerRow]] = await mainPool.execute(
            "SELECT owner_user_id FROM tenants WHERE id = ? LIMIT 1",
            [tid]
          );
          const isOwner =
            ownerRow?.owner_user_id != null &&
            String(ownerRow.owner_user_id) === String(req.user.id);
          if (!isOwner) {
            const serverIso = serverNow.toISOString();
            subscriptionAccess = {
              granted: true,
              source: "workspace_member",
              isAdmin: false,
              serverNow: serverIso,
              workspaceTenantId: tid,
            };
            trialEligibility = {
              eligible: false,
              reason: "workspace_member",
              serverNow: serverIso,
            };
          }
        } catch (err) {
          console.warn("getOrders workspace_member fallback skipped:", err.message);
        }
      }
    }

    res.json({ success: true, orders, trialEligibility, subscriptionAccess });
  } catch (err) {
    console.error("Get orders error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
};

module.exports = { placeOrder, getOrders, startTrial, expireStaleTrials };