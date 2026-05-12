const crypto = require("crypto");
const { hashPassword } = require("../services/authService");
const { mainPool } = require("../config/database");
const { validateTenantSubdomain } = require("../services/tenantDatabaseService");
const { ensureTenantRbacInitialized } = require("../services/rbacService");
const { upsertTenantUserMap } = require("../services/tenantUserMapService");
const { reserveSubdomain } = require("../services/subdomainService");
const { sendWorkspaceCreatedPendingEmail } = require("../services/emailService");
const { generateAccessToken, generateRefreshToken, saveRefreshToken } = require("../services/authService");
const { setAccessCookie, setRefreshCookie, setTenantIdCookie } = require("./authController");

function appBaseDomain() {
  return String(process.env.APP_BASE_DOMAIN || "365rndcrm.vercel.app")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

function isRetryableTxError(err) {
  return err?.code === "ER_LOCK_WAIT_TIMEOUT" || err?.code === "ER_LOCK_DEADLOCK";
}

async function signupWithDedicatedTenant(req, res) {
  let conn;
  try {
    if (String(process.env.TENANT_DEDICATED_SIGNUP || "1") === "0") {
      return res.status(503).json({ success: false, message: "Dedicated tenant signup is disabled." });
    }

    const { name, company_name, company_slug, email, password } = req.body || {};

    if (!email || !password || !name || !company_name) {
      return res.status(400).json({
        success: false,
        message: "name, company_name, email, and password are required.",
      });
    }

    let slug;
    if (company_slug) {
      const v = validateTenantSubdomain(company_slug);
      if (!v.ok) {
        return res.status(400).json({ success: false, message: v.error || "Invalid company URL slug" });
      }
      slug = v.slug;
    } else {
      slug = await reserveSubdomain(company_name);
    }

    const safeEmail = String(email).trim().toLowerCase();
    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts.shift() || "";
    const lastName = nameParts.join(" ") || "";

    const [[existingByEmail]] = await mainPool.execute(
      "SELECT id, tenant_id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [safeEmail]
    );

    if (existingByEmail?.tenant_id) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already belongs to a workspace.",
      });
    }

    const [[existingSlug]] = await mainPool.execute("SELECT id FROM tenants WHERE slug = ? LIMIT 1", [slug]);
    if (existingSlug && !existingByEmail?.id) {
      return res.status(409).json({
        success: false,
        message: "Workspace URL already exists. Please choose a different workspace URL.",
      });
    }

    const [[tenantDbBySubdomain]] = await mainPool.execute(
      `SELECT td.id, td.tenant_id, t.id AS tenant_exists
       FROM tenant_databases td
       LEFT JOIN tenants t ON t.id = td.tenant_id
       WHERE td.subdomain = ?
       LIMIT 1`,
      [slug]
    );

    if (tenantDbBySubdomain && !tenantDbBySubdomain.tenant_exists) {
      await mainPool
        .execute("DELETE FROM tenant_databases WHERE id = ?", [tenantDbBySubdomain.id])
        .catch(() => {});
    } else if (tenantDbBySubdomain && tenantDbBySubdomain.tenant_id !== existingByEmail?.tenant_id) {
      return res.status(409).json({
        success: false,
        message: "Workspace URL already exists. Please choose a different workspace URL.",
      });
    }

    const clerkUserId = `local:${crypto.randomUUID()}`;
    const passwordHash = await hashPassword(String(password));

    let user;
    let tenantId = existingByEmail?.tenant_id || null;

    const maxTxAttempts = 5;
    for (let attempt = 1; attempt <= maxTxAttempts; attempt += 1) {
      conn = await mainPool.getConnection();
      try {
        try { await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED"); } catch {}
        try { await conn.query("SET SESSION innodb_lock_wait_timeout = 5"); } catch {}

        await conn.beginTransaction();

        if (existingByEmail?.id) {
          await conn.execute(
            `UPDATE users
             SET clerk_user_id = ?, first_name = ?, last_name = ?, password_hash = ?, is_active = 1
             WHERE id = ?`,
            [clerkUserId, firstName, lastName, passwordHash, existingByEmail.id]
          );
          const [fresh] = await conn.execute(
            "SELECT id, clerk_user_id, email, first_name, last_name, role, tenant_id FROM users WHERE id = ?",
            [existingByEmail.id]
          );
          user = fresh[0];
        } else {
          await conn.execute(
            `INSERT INTO users (clerk_user_id, email, first_name, last_name, role, is_active, password_hash)
             VALUES (?, ?, ?, ?, 'manager', 1, ?)`,
            [clerkUserId, safeEmail, firstName, lastName, passwordHash]
          );
          const [fresh] = await conn.execute(
            `SELECT id, clerk_user_id, email, first_name, last_name, role, tenant_id
             FROM users WHERE clerk_user_id = ? LIMIT 1`,
            [clerkUserId]
          );
          user = fresh[0];
        }

        tenantId = user.tenant_id || crypto.randomUUID();

        if (!user.tenant_id) {
          await conn.execute(
            `INSERT INTO tenants
               (id, company_name, subdomain, subdomain_status, owner_user_id, status, trial_ends_at, slug)
             VALUES (?, ?, ?, 'pending', ?, 'pending_payment', DATE_ADD(NOW(), INTERVAL 7 DAY), ?)`,
            [tenantId, String(company_name).trim().slice(0, 180), slug, user.id, slug]
          );

          try {
            await conn.execute(
              "UPDATE tenants SET owner_clerk_user_id = ? WHERE id = ?",
              [clerkUserId, tenantId]
            );
          } catch {}

          await conn.execute(
            "UPDATE users SET tenant_id = ?, role = 'manager' WHERE id = ?",
            [tenantId, user.id]
          );

          // NOTE: No subscription is created here on purpose.
          // Subscription/trial is created when the user completes the
          // add-package flow via POST /orders/start-trial or POST /payment/checkout.
          // Creating it here caused a race condition where the user appeared to
          // already have a trial before they ever chose a plan.

        } else {
          const [[slugOwnedByAnotherTenant]] = await conn.execute(
            "SELECT id FROM tenants WHERE slug = ? AND id <> ? LIMIT 1",
            [slug, tenantId]
          );
          if (slugOwnedByAnotherTenant) {
            await conn.rollback();
            conn.release();
            conn = null;
            return res.status(409).json({
              success: false,
              message: "Workspace URL already exists. Please choose a different workspace URL.",
            });
          }
          await conn.execute(
            `UPDATE tenants SET company_name = ?, slug = ?, subdomain = ?, subdomain_status = 'pending' WHERE id = ?`,
            [String(company_name).trim().slice(0, 180), slug, slug, tenantId]
          );
        }

        await conn.commit();
        conn.release();
        conn = null;
        break;
      } catch (txErr) {
        try { await conn.rollback(); } catch {}
        conn.release();
        conn = null;
        if (!isRetryableTxError(txErr) || attempt === maxTxAttempts) throw txErr;
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    try {
      await upsertTenantUserMap({ clerkUserId, tenantId, role: "admin", email: safeEmail });
    } catch {}

    ensureTenantRbacInitialized(tenantId).catch(() => {});

    const base = appBaseDomain();
    const tenantUrl = `https://${slug}.${base}`;
    const appUrl = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || `https://${base}`)
      .replace(/\/+$/, "");
    const addPackageUrl = `${appUrl}/add-package?onboarding=1`;

    // Send workspace-created email without blocking signup.
    setImmediate(async () => {
      try {
        const result = await sendWorkspaceCreatedPendingEmail(safeEmail, {
          firstName,
          companyName: company_name,
          tenantUrl,
          addPackageUrl,
        });
        if (result?.ok) {
          console.log(`[signup] workspace_created_email_sent user=${user.id} channel=${result.channel}`);
        } else {
          console.error(`[signup] workspace_created_email_failed user=${user.id} reason=${result?.detail || result?.reason || "unknown"}`);
        }
      } catch (err) {
        console.error("sendWorkspaceCreatedPendingEmail failed:", err.message);
      }

      try {
        const result2 = await require("../services/emailService").sendAccountCreatedEmail(safeEmail, {
          firstName,
          companyName: company_name,
        });
        if (result2?.ok) {
          console.log(`[signup] account_created_email_sent user=${user.id} channel=${result2.channel}`);
        }
      } catch (err) {
        console.error("sendAccountCreatedEmail failed:", err.message);
      }
    });

    // Set auto-login cookies
    const access = generateAccessToken({
      userId: user.id,
      tenantId,
      role: user.role || "manager",
      is_platform_admin: 0,
    });
    const refresh = generateRefreshToken({ userId: user.id });
    await saveRefreshToken(user.id, refresh);

    setAccessCookie(req, res, access);
    setRefreshCookie(req, res, refresh);
    setTenantIdCookie(req, res, tenantId);

    return res.status(201).json({
      success: true,
      message: "Account and workspace created.",
      data: {
        token: access,
        refreshToken: refresh,
        user_id: user.id,
        tenant_id: tenantId,
        dedicated_db_id: null,
        subdomain: slug,
        tenantUrl,
        nextUrl: `${appUrl}/add-package?onboarding=1`,
        welcomeUrl: appUrl,
        dbName: null,
        useMainCredentials: null,
        provisioningWarning: "Workspace URL is reserved. Super-admin database activation is required before workspace login.",
      },
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }

    if (
      err?.code === "ER_DUP_ENTRY" &&
      /tenants\.uk_tenants_slug|slug/i.test(String(err.message || ""))
    ) {
      return res.status(409).json({
        success: false,
        message: "Workspace URL already exists. Please choose a different workspace URL.",
      });
    }

    if (isRetryableTxError(err)) {
      return res.status(503).json({
        success: false,
        message:
          "Signup is temporarily blocked by a database lock. Please close any open DB edit transactions and retry in a few seconds.",
      });
    }

    return res.status(500).json({ success: false, message: err.message || "Signup failed" });
  }
}

module.exports = { signupWithDedicatedTenant };
