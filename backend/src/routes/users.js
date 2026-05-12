const express = require("express");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");
const { mainPool } = require("../config/database");
const { emitWorkspaceAccessChanged } = require("../realtime/meetingsRealtime");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { clearMustChangePassword, updateProfile } = require("../controllers/userController");
const { getTenantDataPoolForTenantId } = require("../services/tenantDatabaseService");

const router = express.Router();
router.use(verifyToken, resolveTenantContext);

router.get("/", async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required" });
    }
    // FIXED: 9 tenant user listing uses tenant CRM pool when available
    const tPool = req.tenantDb || (await getTenantDataPoolForTenantId(tenantId)) || mainPool;
    const [rows] = await tPool.execute(
      `SELECT id, tenant_id, clerk_user_id, email, first_name, last_name, role, is_active, last_login, created_at
       FROM users
       WHERE tenant_id = ?
       ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error("GET /api/users", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/password-changed", async (req, res) => clearMustChangePassword(req, res));
router.put("/profile", async (req, res) => updateProfile(req, res));

router.patch("/:id/role", requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid user id" });

    const { role } = req.body;
    if (!role || !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ success: false, message: "role is required and must be admin|manager|staff" });
    }

    const [result] = await mainPool.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [updated] = await mainPool.query("SELECT id, clerk_user_id, email, role FROM users WHERE id = ?", [userId]);
    const row = updated[0];
    if (row?.clerk_user_id) {
      emitWorkspaceAccessChanged({ clerkUserId: row.clerk_user_id, reason: "role" });
    }
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("PATCH /api/users/:id/role", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
