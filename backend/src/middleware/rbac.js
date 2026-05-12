const { hasPermission, getRbacContext } = require("../services/rbacService");

function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const ctx = await getRbacContext(req.user, req.tenantId);
      const allowed = await hasPermission(ctx, permissionCode);

      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      next();
    } catch (err) {
      console.error("requirePermission error:", err.message);
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}

module.exports = {
  requirePermission,
};