const crypto = require("crypto");
const { mainPool } = require("../config/database");
const { emitAdminChanged, emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const { hashPassword } = require("../services/authService");
const { createUserInvitation, sendUserInvitationEmail } = require("../services/userInvitationService");

/** Safe pagination: avoid NaN / arrays from query strings; LIMIT/OFFSET as SQL literals (not ?) for Aiven/MySQL compatibility. */
function parsePageLimit(query, defaultLimit = 20) {
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const page = Math.max(1, parseInt(String(rawPage ?? 1), 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(String(rawLimit ?? defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function getWorkspaceScope(req) {
  const tenantId = String(req.user?.tenantId || "").trim();
  if (!tenantId) return null;
  return tenantId;
}

function configuredSuperAdminEmails() {
  const raw = [
    String(process.env.PLATFORM_SUPERADMIN_EMAILS || ""),
    String(process.env.SUPERADMIN_EMAILS || ""),
    String(process.env.SUPERADMIN_EMAIL || ""),
    String(process.env.SEED_SUPERADMIN_EMAIL || "iamsatyamsingh91@gmail.com"),
  ]
    .filter(Boolean)
    .join(",");
  return new Set(
    raw
      .split(",")
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

async function hardDeleteUserRecord(userId) {
  // Cleanup rows that reference users.id without ON DELETE CASCADE.
  await mainPool.execute("DELETE FROM chat_messages WHERE sender_id = ?", [userId]);
  await mainPool.execute("DELETE FROM meetings WHERE organizer_id = ?", [userId]);
  await mainPool.execute("DELETE FROM reminders WHERE user_id = ?", [userId]);
  await mainPool.execute("DELETE FROM crm_todos WHERE created_by = ?", [userId]);

  // Nullable relationships.
  await mainPool.execute("UPDATE reminders SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [userId]);
  await mainPool.execute("UPDATE meetings SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?", [userId]);
  await mainPool.execute("UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?", [userId]);
}

async function getDashboardStats(req, res) {
  try {
    const [[{ totalUsers }]] = await mainPool.execute(
      "SELECT COUNT(*) as totalUsers FROM users WHERE is_active = 1"
    );
    const [[{ totalLeads }]] = await mainPool.execute(
      "SELECT COUNT(*) as totalLeads FROM leads"
    );
    const [[{ totalOrders }]] = await mainPool.execute(
      "SELECT COUNT(*) as totalOrders FROM orders"
    );
    const [[{ activeTrials }]] = await mainPool.execute(
      "SELECT COUNT(*) as activeTrials FROM orders WHERE status = 'trial'"
    );
    const [[{ activeSubs }]] = await mainPool.execute(
      "SELECT COUNT(*) as activeSubs FROM orders WHERE status = 'active'"
    );
    const [[{ expiredSubs }]] = await mainPool.execute(
      "SELECT COUNT(*) as expiredSubs FROM orders WHERE status IN ('expired', 'trial_expired')"
    );
    let contactRequests = 0;
    try {
      const [[row]] = await mainPool.execute(
        "SELECT COUNT(*) as contactRequests FROM contact_requests WHERE is_read = 0"
      );
      contactRequests = Number(row.contactRequests);
    } catch (_) {
      // table may not exist on this deployment
      contactRequests = 0;
    }

    let totalTasks = 0;
    try {
      const [[row]] = await mainPool.execute("SELECT COUNT(*) as totalTasks FROM tasks");
      totalTasks = Number(row.totalTasks);
    } catch (_) {
      totalTasks = 0;
    }

    let totalReminders = 0;
    try {
      const [[row]] = await mainPool.execute("SELECT COUNT(*) as totalReminders FROM reminders");
      totalReminders = Number(row.totalReminders);
    } catch (_) {
      totalReminders = 0;
    }

    let totalMeetings = 0;
    try {
      const [[row]] = await mainPool.execute("SELECT COUNT(*) as totalMeetings FROM meetings");
      totalMeetings = Number(row.totalMeetings);
    } catch (_) {
      totalMeetings = 0;
    }

    let totalNotes = 0;
    try {
      const [[row]] = await mainPool.execute("SELECT COUNT(*) as totalNotes FROM notes");
      totalNotes = Number(row.totalNotes);
    } catch (_) {
      totalNotes = 0;
    }

    const [recentUsers] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, role, created_at, last_login
       FROM users 
       WHERE is_active = 1
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    // BUG FIX: JOIN orders to users via clerk_user_id
    const [recentOrders] = await mainPool.execute(
      `SELECT o.id, o.package_name, o.status, o.total, o.currency, o.created_at,
              u.email, u.first_name, u.last_name
       FROM orders o
       LEFT JOIN users u ON u.clerk_user_id = o.user_id
       ORDER BY o.created_at DESC 
       LIMIT 5`
    );

    const [[{ totalTenants }]] = await mainPool.execute("SELECT COUNT(*) AS totalTenants FROM tenants");
    const [[{ activeTenants }]] = await mainPool.execute(
      "SELECT COUNT(*) AS activeTenants FROM tenants WHERE is_active = 1 AND status IN ('active','trial')"
    );
    const [[{ trialTenants }]] = await mainPool.execute(
      "SELECT COUNT(DISTINCT t.id) AS trialTenants FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id WHERE s.status = 'trial'"
    );
    const [[{ expiredTenants }]] = await mainPool.execute(
      `SELECT COUNT(DISTINCT s.tenant_id) AS expiredTenants
       FROM subscriptions s
       WHERE s.status IN ('expired','cancelled','suspended')
         AND s.id = (
           SELECT s2.id FROM subscriptions s2 WHERE s2.tenant_id = s.tenant_id ORDER BY s2.created_at DESC LIMIT 1
         )`
    );
    const [[{ totalSeatsAcrossAllTenants }]] = await mainPool.execute(
      `SELECT COALESCE(SUM(p.staff_seats), 0) AS totalSeatsAcrossAllTenants
       FROM subscriptions s
       INNER JOIN subscription_packages p ON p.id = s.package_id
       WHERE s.status IN ('trial','active')`
    );
    const [mostAddonRows] = await mainPool.execute(
      `SELECT addon_key, COUNT(*) AS c FROM tenant_marketplace_addons
       WHERE is_active = 1 GROUP BY addon_key ORDER BY c DESC LIMIT 1`
    );
    const [topPlanRows] = await mainPool.execute(
      `SELECT p.name AS plan_name, COUNT(*) AS c
       FROM subscriptions s
       JOIN subscription_packages p ON p.id = s.package_id
       WHERE s.status IN ('trial','active')
       GROUP BY p.name ORDER BY c DESC LIMIT 1`
    );
    const [tenantBreakdown] = await mainPool.execute(
      `SELECT t.id AS tenant_id, t.company_name AS name, p.name AS plan, s.status,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = 1) AS user_count,
              (SELECT COUNT(*) FROM tenant_marketplace_addons a
                WHERE a.tenant_id = t.id AND a.is_active = 1) AS addon_count,
              s.ends_at AS valid_until
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
         AND s.id = (SELECT s2.id FROM subscriptions s2 WHERE s2.tenant_id = t.id ORDER BY s2.created_at DESC LIMIT 1)
       LEFT JOIN subscription_packages p ON p.id = s.package_id
       ORDER BY COALESCE(s.ends_at, t.created_at) DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      stats: {
        totalUsers: Number(totalUsers),
        totalLeads: Number(totalLeads),
        totalOrders: Number(totalOrders),
        activeTrials: Number(activeTrials),
        activeSubs: Number(activeSubs),
        expiredSubs: Number(expiredSubs),
        contactRequests,
        totalTasks,
        totalReminders,
        totalMeetings,
        totalNotes,
      },
      tenantStats: {
        totalTenants: Number(totalTenants) || 0,
        activeTenants: Number(activeTenants) || 0,
        trialTenants: Number(trialTenants) || 0,
        expiredTenants: Number(expiredTenants) || 0,
        totalSeatsAcrossAllTenants: Number(totalSeatsAcrossAllTenants) || 0,
        mostUsedAddon: mostAddonRows[0]?.addon_key || null,
        topPlan: topPlanRows[0]?.plan_name || null,
      },
      tenantBreakdown,
      recentUsers,
      recentOrders,
    });
  } catch (err) {
    console.error("getDashboardStats error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getSuperAdminStatus(req, res) {
  try {
    const uid = Number(req.user?.id || 0);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const [[row]] = await mainPool.execute(
      `SELECT id, email, role, tenant_id, COALESCE(is_platform_admin, 0) AS is_platform_admin
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [uid]
    );
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    const email = String(row.email || "").trim().toLowerCase();
    const allow = configuredSuperAdminEmails();
    const emailAllowlisted = Boolean(email && allow.has(email));
    const roleAdmin = String(row.role || "").toLowerCase() === "admin";
    const platformFlag = Number(row.is_platform_admin) === 1;
    const tenantDetached = row.tenant_id == null || String(row.tenant_id).trim() === "";
    const superAdminMode = emailAllowlisted && roleAdmin && platformFlag && tenantDetached;
    return res.json({
      success: true,
      data: {
        user_id: row.id,
        email: row.email || null,
        checks: {
          email_allowlisted: emailAllowlisted,
          role_admin: roleAdmin,
          platform_flag: platformFlag,
          tenant_detached: tenantDetached,
        },
        super_admin_mode: superAdminMode,
      },
    });
  } catch (err) {
    console.error("getSuperAdminStatus error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllUsers(req, res) {
  try {
    const { search, role } = req.query;
    const { page, limit, offset } = parsePageLimit(req.query, 20);
    const tenantId = getWorkspaceScope(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "Workspace context not found." });
    }

    let where = "u.tenant_id = ? AND COALESCE(u.is_platform_admin, 0) = 0";
    const params = [tenantId];

    if (search) {
      where += " AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (role) {
      where += " AND u.role = ?";
      params.push(role);
    }

    const [[{ total }]] = await mainPool.execute(
      `SELECT COUNT(*) as total FROM users u WHERE ${where}`,
      params
    );

    // BUG FIX: Subquery to get latest order per user
    const [users] = await mainPool.query(
      `SELECT 
        u.id, u.clerk_user_id, u.email, u.first_name, u.last_name,
        u.role, u.is_active, u.last_login, u.created_at,
        o.status as subscription_status, 
        o.package_name,
        o.total as order_total,
        o.created_at as order_date
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.clerk_user_id
         AND o.id = (
           SELECT MAX(id) FROM orders WHERE user_id = u.clerk_user_id
         )
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({
      success: true,
      total: Number(total),
      users,
      page,
      limit,
    });
  } catch (err) {
    console.error("getAllUsers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getUserDetail(req, res) {
  try {
    const { id } = req.params;
    const tenantId = getWorkspaceScope(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "Workspace context not found." });
    }

    const [[user]] = await mainPool.execute(
      `SELECT id, clerk_user_id, email, first_name, last_name, role, is_active, last_login, created_at
       FROM users WHERE id = ? AND tenant_id = ? AND COALESCE(is_platform_admin, 0) = 0`,
      [id, tenantId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [orders] = await mainPool.execute(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
      [user.clerk_user_id]
    );

    const [[leadsData]] = await mainPool.execute(
      "SELECT COUNT(*) as count FROM leads WHERE created_by = ?",
      [user.id]
    );

    res.json({
      success: true,
      user,
      orders,
      leadsCount: Number(leadsData.count),
    });
  } catch (err) {
    console.error("getUserDetail error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function grantTrial(req, res) {
  try {
    const { userId } = req.params;
    const { package_name = "Gold", days = 7 } = req.body;
    const tenantId = getWorkspaceScope(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "Workspace context not found." });
    }

    const [[user]] = await mainPool.execute(
      "SELECT clerk_user_id FROM users WHERE id = ? AND tenant_id = ? AND COALESCE(is_platform_admin, 0) = 0",
      [userId, tenantId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // BUG FIX: Check if user already has a trial, update instead of creating duplicate
    const [existingOrders] = await mainPool.execute(
      "SELECT id FROM orders WHERE user_id = ? AND status = 'trial' LIMIT 1",
      [user.clerk_user_id]
    );

    if (existingOrders.length > 0) {
      // Reset the trial by updating status
      await mainPool.execute(
        "UPDATE orders SET package_name = ?, status = 'trial', created_at = NOW() WHERE id = ?",
        [package_name, existingOrders[0].id]
      );
    } else {
      await mainPool.execute(
        `INSERT INTO orders (user_id, package_name, package_price, currency, addons, subtotal, gst, total, status)
         VALUES (?, ?, 0, 'INR', '[]', 0, 0, 0, 'trial')`,
        [user.clerk_user_id, package_name]
      );
    }

    emitAdminChanged({ scope: "orders", action: "grant_trial", userId });
    res.json({
      success: true,
      message: `${days}-day free trial granted for ${package_name} plan`,
    });
  } catch (err) {
    console.error("grantTrial error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateOrderStatus(req, res) {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ["trial", "active", "expired", "trial_expired", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const [result] = await mainPool.execute(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, orderId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    emitAdminChanged({ scope: "orders", action: "order_status", orderId });
    res.json({ success: true, message: "Order status updated" });
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const tenantId = getWorkspaceScope(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "Workspace context not found." });
    }

    if (!["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const [result] = await mainPool.execute(
      "UPDATE users SET role = ? WHERE id = ? AND tenant_id = ? AND COALESCE(is_platform_admin, 0) = 0",
      [role, userId, tenantId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [[urow]] = await mainPool.execute(
      "SELECT clerk_user_id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1",
      [userId, tenantId]
    );
    if (urow?.clerk_user_id) {
      emitWorkspaceAccessChanged({ clerkUserId: urow.clerk_user_id, reason: "role" });
    }

    emitAdminChanged({ scope: "users", action: "role", userId });
    res.json({ success: true, message: "User role updated" });
  } catch (err) {
    console.error("updateUserRole error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function toggleUserActive(req, res) {
  try {
    const { userId } = req.params;
    const tenantId = getWorkspaceScope(req);
    if (!tenantId) {
      return res.status(403).json({ success: false, message: "Workspace context not found." });
    }

    const [[user]] = await mainPool.execute(
      "SELECT is_active, clerk_user_id FROM users WHERE id = ? AND tenant_id = ? AND COALESCE(is_platform_admin, 0) = 0",
      [userId, tenantId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const newStatus = user.is_active ? 0 : 1;
    await mainPool.execute(
      "UPDATE users SET is_active = ? WHERE id = ? AND tenant_id = ? AND COALESCE(is_platform_admin, 0) = 0",
      [newStatus, userId, tenantId]
    );

    if (user.clerk_user_id) {
      emitWorkspaceAccessChanged({ clerkUserId: user.clerk_user_id, reason: "active" });
    }

    emitAdminChanged({ scope: "users", action: "toggle_active", userId });
    res.json({
      success: true,
      is_active: newStatus,
      message: newStatus ? "User activated" : "User deactivated",
    });
  } catch (err) {
    console.error("toggleUserActive error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllOrders(req, res) {
  try {
    const { status } = req.query;
    const { page, limit, offset } = parsePageLimit(req.query, 20);

    let where = "1=1";
    const params = [];

    if (status) {
      where += " AND o.status = ?";
      params.push(status);
    }

    const [[{ total }]] = await mainPool.execute(
      `SELECT COUNT(*) as total FROM orders o WHERE ${where}`,
      params
    );

    const [orders] = await mainPool.query(
      `SELECT o.id, o.package_name, o.package_price, o.currency, 
              o.subtotal, o.gst, o.total, o.status, o.created_at,
              u.email, u.first_name, u.last_name
       FROM orders o
       LEFT JOIN users u ON u.clerk_user_id = o.user_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ success: true, total: Number(total), orders, page, limit });
  } catch (err) {
    console.error("getAllOrders error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listPlatformUsers(req, res) {
  try {
    const [rows] = await mainPool.execute(
      `SELECT id, clerk_user_id, email, first_name, last_name, role, is_active, last_login, created_at,
              tenant_id, COALESCE(is_platform_admin, 0) AS is_platform_admin
       FROM users
       WHERE tenant_id IS NULL OR is_platform_admin = 1
       ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("listPlatformUsers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createPlatformUser(req, res) {
  try {
    let clerkUserId = String(req.body?.clerkUserId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const firstName = String(req.body?.firstName || "").trim() || null;
    const lastName = String(req.body?.lastName || "").trim() || null;
    const role = String(req.body?.role || "staff").trim();
    const password = String(req.body?.password || "").trim();
    const shouldSendWelcomeEmail = req.body?.sendWelcomeEmail !== false;
    const generatedPassword = () => crypto.randomBytes(10).toString("base64url");
    let linkedExistingClerkUser = false;
    if (!clerkUserId && !email) {
      return res.status(400).json({ success: false, message: "Provide clerkUserId or email" });
    }
    if (!["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    let dbMatch = null;
    if (!clerkUserId) {
      const [[existing]] = await mainPool.execute(
        `SELECT id, clerk_user_id, email, first_name, last_name FROM users WHERE LOWER(email) = ? LIMIT 1`,
        [email]
      );
      if (existing?.clerk_user_id && !String(existing.clerk_user_id).startsWith("pending:")) {
        clerkUserId = String(existing.clerk_user_id);
        linkedExistingClerkUser = true;
        dbMatch = existing;
      } else {
        clerkUserId = `local:${crypto.randomUUID()}`;
      }
    }
    const seedPassword = shouldSendWelcomeEmail ? generatedPassword() : password || generatedPassword();
    if (seedPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Temporary password must be at least 8 characters." });
    }
    const passwordHash = await hashPassword(seedPassword);
    let resolvedEmail = email || dbMatch?.email || null;
    let resolvedFirstName = firstName || dbMatch?.first_name || null;
    let resolvedLastName = lastName || dbMatch?.last_name || null;
    if (clerkUserId && (!resolvedEmail || !resolvedFirstName || !resolvedLastName)) {
      const [[cu]] = await mainPool.execute(
        `SELECT email, first_name, last_name FROM users WHERE clerk_user_id = ? LIMIT 1`,
        [clerkUserId]
      );
      if (cu) {
        resolvedEmail = resolvedEmail || cu.email || null;
        resolvedFirstName = resolvedFirstName || cu.first_name || null;
        resolvedLastName = resolvedLastName || cu.last_name || null;
      }
    }
    if (!resolvedEmail) {
      return res.status(400).json({
        success: false,
        message: "email is required (or must exist on the linked user record).",
      });
    }

    await mainPool.execute(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, role, tenant_id, is_platform_admin, is_active, must_change_password, password_hash)
       VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 1, ?)
       ON DUPLICATE KEY UPDATE
        tenant_id = NULL,
        is_platform_admin = 0,
        role = VALUES(role),
        must_change_password = 1,
        email = COALESCE(VALUES(email), email),
        first_name = COALESCE(VALUES(first_name), first_name),
        last_name = COALESCE(VALUES(last_name), last_name),
        is_active = 1,
        password_hash = COALESCE(VALUES(password_hash), password_hash),
        updated_at = NOW()`,
      [clerkUserId, resolvedEmail, resolvedFirstName, resolvedLastName, role, passwordHash]
    );
    const [[row]] = await mainPool.execute(
      `SELECT id, clerk_user_id, email, first_name, last_name, role, is_active, last_login, created_at
       FROM users WHERE clerk_user_id = ? LIMIT 1`,
      [clerkUserId]
    );
    let mailStatus = null;
    if (row?.email && shouldSendWelcomeEmail) {
      try {
        const invitation = await createUserInvitation({
          userId: row.id,
          email: row.email,
          tenantId: null,
          role: row.role,
          invitedByUserId: Number(req.user?.id) || null,
        });
        const inviterName =
          `${String(req.user?.first_name || "").trim()} ${String(req.user?.last_name || "").trim()}`.trim() ||
          String(req.user?.email || "").trim();
        mailStatus = await sendUserInvitationEmail({
          req,
          to: row.email,
          firstName: row.first_name,
          role: row.role,
          workspaceName: "365 RND CRM",
          token: invitation.token,
          inviterName,
          inviterEmail: String(req.user?.email || "").trim(),
          meta: { user_id: row.id },
        }).catch((err) => ({ ok: false, reason: err?.message || "send_failed" }));
        if (!mailStatus?.ok) {
          console.warn("createPlatformUser invitation email failed:", {
            to: row.email,
            reason: mailStatus?.reason || "unknown",
            detail: mailStatus?.detail || "n/a",
          });
        }
      } catch (inviteErr) {
        mailStatus = {
          ok: false,
          reason: "invitation_create_failed",
          detail: inviteErr?.message || "unknown error while creating invitation",
        };
        console.warn("createPlatformUser invitation create failed:", {
          user_id: row.id,
          reason: mailStatus.reason,
          detail: mailStatus.detail,
        });
      }
    }
    emitAdminChanged({ scope: "platform_users", action: "create" });
    res.status(201).json({
      success: true,
      data: row,
      linkedExistingClerkUser,
      mail: shouldSendWelcomeEmail
        ? mailStatus || { ok: false, reason: "missing_email" }
        : { ok: false, reason: "disabled" },
    });
  } catch (err) {
    console.error("createPlatformUser error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function patchPlatformUserRole(req, res) {
  try {
    const id = Number(req.params.id);
    const { role } = req.body || {};
    if (!id || !["admin", "manager", "staff"].includes(String(role || ""))) {
      return res.status(400).json({ success: false, message: "Invalid id or role" });
    }
    const [[existingUser]] = await mainPool.execute(
      "SELECT email FROM users WHERE id = ? AND (tenant_id IS NULL OR is_platform_admin = 1) LIMIT 1",
      [id]
    );
    const protectedEmails = configuredSuperAdminEmails();
    if (existingUser && protectedEmails.has(String(existingUser.email || "").trim().toLowerCase())) {
      return res.status(403).json({ success: false, message: "Protected platform super-admin accounts cannot have their role changed." });
    }
    const [r] = await mainPool.execute(
      `UPDATE users SET role = ?, updated_at = NOW()
       WHERE id = ? AND (tenant_id IS NULL OR is_platform_admin = 1)`,
      [role, id]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: "User not found" });
    const [[urow]] = await mainPool.execute("SELECT clerk_user_id FROM users WHERE id = ? LIMIT 1", [id]);
    if (urow?.clerk_user_id) emitWorkspaceAccessChanged({ clerkUserId: urow.clerk_user_id, reason: "role" });
    emitAdminChanged({ scope: "platform_users", action: "role", userId: id });
    res.json({ success: true });
  } catch (err) {
    console.error("patchPlatformUserRole error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deactivatePlatformUser(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const [[urow]] = await mainPool.execute(
      "SELECT clerk_user_id, email FROM users WHERE id = ? AND (tenant_id IS NULL OR is_platform_admin = 1) LIMIT 1",
      [id]
    );
    if (!urow) return res.status(404).json({ success: false, message: "User not found" });

    const userEmail = String(urow.email || "").trim().toLowerCase();
    const protectedEmails = configuredSuperAdminEmails();
    if (protectedEmails.has(userEmail)) {
      return res.status(403).json({ success: false, message: "Protected platform super-admin accounts cannot be deleted." });
    }

    const clerkUserId = String(urow.clerk_user_id || "").trim();
    const isPending = clerkUserId.startsWith("pending:");

    await hardDeleteUserRecord(id);
    const [r] = await mainPool.execute(
      "DELETE FROM users WHERE id = ? AND (tenant_id IS NULL OR is_platform_admin = 1) LIMIT 1",
      [id]
    );
    if (!r.affectedRows) {
      return res.status(409).json({
        success: false,
        message: "Could not fully delete this user due to linked records.",
      });
    }

    if (clerkUserId && !isPending) emitWorkspaceAccessChanged({ clerkUserId, reason: "active" });
    emitAdminChanged({ scope: "platform_users", action: "delete", userId: id });
    res.json({ success: true, message: "User deleted from database." });
  } catch (err) {
    console.error("deactivatePlatformUser error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Workspace buyers promoted to tenant admin after payment — surfaced to platform super admins.
 * Same people appear under each tenant’s user list (`GET /admin/tenants/:id`).
 */
async function listTenantWorkspaceAdmins(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "80"), 10) || 80));
    const [rows] = await mainPool.execute(
      `SELECT
         u.id AS user_id,
         u.email,
         u.first_name,
         u.last_name,
         u.role,
         u.is_active,
         u.last_login,
         u.created_at AS user_created_at,
         u.tenant_id,
         COALESCE(NULLIF(TRIM(t.name), ''), t.company_name) AS tenant_name,
         t.created_at AS tenant_created_at,
         t.status AS tenant_status,
         tp.valid_until AS package_valid_until,
         s.ends_at AS subscription_ends_at,
         s.status AS subscription_status
       FROM users u
       INNER JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN tenant_packages tp ON tp.id = (
         SELECT tp2.id FROM tenant_packages tp2 WHERE tp2.tenant_id = t.id ORDER BY tp2.id DESC LIMIT 1
       )
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2 WHERE s2.tenant_id = t.id ORDER BY s2.created_at DESC LIMIT 1
       )
       WHERE u.role = 'admin'
         AND u.tenant_id IS NOT NULL
         AND COALESCE(u.is_platform_admin, 0) = 0
       ORDER BY u.updated_at DESC, u.created_at DESC
       LIMIT ${limit}`
    );

    const data = rows.map((r) => {
      const endMs = r.subscription_ends_at
        ? new Date(r.subscription_ends_at).getTime()
        : r.package_valid_until
          ? new Date(r.package_valid_until).getTime()
          : null;
      let daysLeft = null;
      if (endMs != null && !Number.isNaN(endMs)) {
        daysLeft = endMs <= Date.now() ? 0 : Math.ceil((endMs - Date.now()) / 86400000);
      }
      return {
        user_id: r.user_id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        role: r.role,
        is_active: Number(r.is_active) === 1,
        last_login: r.last_login,
        user_created_at: r.user_created_at,
        tenant_id: r.tenant_id,
        tenant_name: r.tenant_name,
        tenant_created_at: r.tenant_created_at,
        tenant_status: r.tenant_status,
        subscription_status: r.subscription_status,
        subscription_ends_at: r.subscription_ends_at,
        package_valid_until: r.package_valid_until,
        days_left: daysLeft,
      };
    });

    res.json({ success: true, total: data.length, data });
  } catch (err) {
    console.error("listTenantWorkspaceAdmins error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getContactRequests(req, res) {
  try {
    const { type, is_read } = req.query;
    const { page, limit, offset } = parsePageLimit(req.query, 20);

    let where = "1=1";
    const params = [];

    if (type) {
      where += " AND type = ?";
      params.push(type);
    }
    if (is_read !== undefined) {
      where += " AND is_read = ?";
      params.push(is_read === "true" ? 1 : 0);
    }

    const [[{ total }]] = await mainPool.execute(
      `SELECT COUNT(*) as total FROM contact_requests WHERE ${where}`,
      params
    );

    const [requests] = await mainPool.query(
      `SELECT * FROM contact_requests WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ success: true, total: Number(total), requests, page, limit });
  } catch (err) {
    console.error("getContactRequests error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Resolve tenant mapping quickly for ops/support without exposing tenant CRM content.
 * Query by either user email or workspace slug/subdomain.
 */
async function resolveTenantMapping(req, res) {
  try {
    const isTopLevelPlatformAdmin =
      Number(req.user?.is_platform_admin) === 1 && String(req.user?.role || "").toLowerCase() === "admin";
    const email = String(req.query?.email || "")
      .trim()
      .toLowerCase();
    const subdomain = String(req.query?.subdomain || req.query?.slug || "")
      .trim()
      .toLowerCase();

    if (!email && !subdomain) {
      return res.status(400).json({
        success: false,
        message: "Provide email or subdomain",
      });
    }

    let tenantId = null;
    let user = null;

    if (email) {
      const [[u]] = await mainPool.execute(
        `SELECT id, email, first_name, last_name, role, tenant_id, is_active
         FROM users
         WHERE LOWER(email) = ?
         LIMIT 1`,
        [email]
      );
      if (u) {
        user = u;
        tenantId = u.tenant_id || null;
      }
    }

    if (!tenantId && subdomain) {
      const [[tBySub]] = await mainPool.execute(
        `SELECT id FROM tenants
         WHERE LOWER(COALESCE(subdomain, '')) = ? OR LOWER(COALESCE(slug, '')) = ?
         LIMIT 1`,
        [subdomain, subdomain]
      );
      if (tBySub?.id) tenantId = tBySub.id;

      if (!tenantId) {
        const [[tdBySub]] = await mainPool.execute(
          `SELECT tenant_id
           FROM tenant_databases
           WHERE LOWER(subdomain) = ?
           LIMIT 1`,
          [subdomain]
        );
        if (tdBySub?.tenant_id) tenantId = tdBySub.tenant_id;
      }
    }

    if (!tenantId) {
      return res.status(404).json({
        success: false,
        message: "Tenant mapping not found",
      });
    }

    const [[tenant]] = await mainPool.execute(
      `SELECT id, company_name, slug, subdomain, status, is_active, created_at
       FROM tenants
       WHERE id = ?
       LIMIT 1`,
      [tenantId]
    );
    const [[tenantDb]] = await mainPool.execute(
      `SELECT id, tenant_id, subdomain, db_host, db_port, db_name, db_user,
              use_main_credentials, provision_mode, status, updated_at
       FROM tenant_databases
       WHERE tenant_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId]
    );
    const [admins] = await mainPool.execute(
      `SELECT id, email, first_name, last_name, role, is_active
       FROM users
       WHERE tenant_id = ? AND role IN ('admin','manager')
       ORDER BY created_at ASC
       LIMIT 10`,
      [tenantId]
    );

    const maskedTenantDb = tenantDb
      ? {
          ...tenantDb,
          db_host: isTopLevelPlatformAdmin ? tenantDb.db_host : "[masked]",
          db_user: isTopLevelPlatformAdmin ? tenantDb.db_user : "[masked]",
          db_port: isTopLevelPlatformAdmin ? tenantDb.db_port : null,
        }
      : null;

    console.info(
      JSON.stringify({
        level: "info",
        event: "tenant_resolution_lookup",
        actor_user_id: req.user?.id || null,
        actor_role: req.user?.role || null,
        actor_is_platform_admin: Number(req.user?.is_platform_admin) === 1 ? 1 : 0,
        query_email: email || null,
        query_subdomain: subdomain || null,
        resolved_tenant_id: tenantId,
        matched_user_id: user?.id || null,
        request_id: req.request_id || null,
      })
    );

    return res.json({
      success: true,
      data: {
        query: { email: email || null, subdomain: subdomain || null },
        tenant_id: tenantId,
        tenant: tenant || null,
        tenant_database: maskedTenantDb,
        matched_user: user,
        tenant_admins: admins,
      },
    });
  } catch (err) {
    console.error("resolveTenantMapping error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to resolve tenant mapping" });
  }
}

module.exports = {
  getDashboardStats,
  getSuperAdminStatus,
  getAllUsers,
  getUserDetail,
  grantTrial,
  updateOrderStatus,
  updateUserRole,
  toggleUserActive,
  getAllOrders,
  getContactRequests,
  resolveTenantMapping,
  listTenantWorkspaceAdmins,
  listPlatformUsers,
  createPlatformUser,
  patchPlatformUserRole,
  deactivatePlatformUser,
};