const { requireFeature } = require("./tenantAccess");

function requireManagerOrSuperAdmin(req, res, next) {
  const role = String(req.user?.role || "");
  if (role === "admin" || role === "manager") return next();
  return res.status(403).json({ success: false, message: "Manager access required." });
}

const requireHrFeature = requireFeature("hr_management", "view");
const requirePayrollFeature = requireFeature("hr_operations_payroll", "view");

module.exports = {
  requireManagerOrSuperAdmin,
  requireHrFeature,
  requirePayrollFeature,
};

