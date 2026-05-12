const { mainPool } = require("../config/database");
const { hashPassword } = require("../services/authService");
const { resolveWorkspacePublicRouting } = require("../services/workspacePublicUrlService");

async function getInvitationByToken(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ success: false, message: "Invalid token" });
    const [[row]] = await mainPool.execute(
      `SELECT i.id, i.status, i.expires_at, i.email, i.role, i.tenant_id,
              u.first_name, u.last_name,
              COALESCE(NULLIF(TRIM(t.name), ''), t.company_name) AS workspace_name
       FROM user_invitations i
       LEFT JOIN users u ON u.id = i.user_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token = ?
       LIMIT 1`,
      [token]
    );
    if (!row) {
      return res.status(404).json({ success: false, message: "Invitation not found." });
    }
    const isExpired = new Date(row.expires_at).getTime() <= Date.now();
    const valid = row.status === "pending" && !isExpired;
    if (row.status === "pending" && isExpired) {
      await mainPool.execute("UPDATE user_invitations SET status = 'expired' WHERE id = ? LIMIT 1", [row.id]);
    }
    const routing = await resolveWorkspacePublicRouting(row.tenant_id || null);
    return res.json({
      success: true,
      valid,
      data: {
        email: row.email,
        role: row.role,
        workspace_name: row.workspace_name || "365 RND CRM",
        first_name: row.first_name || "",
        last_name: row.last_name || "",
        expires_at: row.expires_at,
        status: valid ? "pending" : isExpired ? "expired" : row.status,
        tenant_id: row.tenant_id || null,
        post_login_kind: routing.post_login_kind,
        workspace_dashboard_url: routing.workspace_dashboard_url,
      },
    });
  } catch (err) {
    console.error("getInvitationByToken error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function acceptInvitation(req, res) {
  let conn;
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "").trim();
    if (!token) return res.status(400).json({ success: false, code: "TOKEN_REQUIRED", message: "Token is required." });
    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ success: false, code: "PASSWORD_TOO_SHORT", message: "Password must be at least 8 characters." });
    }
    conn = await mainPool.getConnection();
    await conn.beginTransaction();
    const [[inv]] = await conn.execute(
      `SELECT i.id, i.user_id, i.email, i.status, i.expires_at
       FROM user_invitations i
       INNER JOIN users u ON u.id = i.user_id
       WHERE i.token = ?
       LIMIT 1`,
      [token]
    );
    if (!inv) {
      await conn.rollback();
      return res.status(404).json({ success: false, code: "INVITE_NOT_FOUND", message: "Invitation not found." });
    }
    if (inv.status !== "pending") {
      await conn.rollback();
      return res
        .status(409)
        .json({ success: false, code: "INVITE_INACTIVE", message: "Invitation is already used or inactive." });
    }
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      await conn.execute("UPDATE user_invitations SET status = 'expired' WHERE id = ? LIMIT 1", [inv.id]);
      await conn.commit();
      return res.status(410).json({ success: false, code: "INVITE_EXPIRED", message: "Invitation link expired." });
    }

    const pwHash = await hashPassword(password);
    await conn.execute(
      `UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1, updated_at = NOW()
       WHERE id = ? LIMIT 1`,
      [pwHash, inv.user_id]
    );
    await conn.execute(
      `UPDATE user_invitations SET status = 'accepted', accepted_at = NOW()
       WHERE id = ? LIMIT 1`,
      [inv.id]
    );
    await conn.commit();

    const [[uMeta]] = await mainPool.execute("SELECT tenant_id FROM users WHERE id = ? LIMIT 1", [inv.user_id]);
    const routing = await resolveWorkspacePublicRouting(uMeta?.tenant_id || null);

    return res.json({
      success: true,
      code: "INVITE_ACCEPTED",
      message: "Invitation accepted. You can sign in with your email and password.",
      data: {
        email: inv.email,
        invite_id: inv.id,
        tenant_id: uMeta?.tenant_id || null,
        post_login_kind: routing.post_login_kind,
        workspace_dashboard_url: routing.workspace_dashboard_url,
      },
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback error
      }
    }
    console.error("acceptInvitation error:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  getInvitationByToken,
  acceptInvitation,
};
