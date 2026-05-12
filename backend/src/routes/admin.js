const express = require("express");
const rateLimit = require("express-rate-limit");
const { verifyToken } = require("../middleware/verifyToken");
const {
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
} = require("../controllers/adminController");
const {
  adminListPackages,
  adminListAddons,
  adminCreatePackage,
  adminUpdatePackage,
  adminDeletePackage,
  adminCreateAddon,
  adminUpdateAddon,
  adminDeleteAddon,
} = require("../controllers/packageController");
const {
  adminListCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
} = require("../controllers/couponController");
const { resolveTenantContext } = require("../middleware/tenantAccess");
const { requirePlatformAdmin } = require("../middleware/platformAdmin");
const {
  getAllTenants,
  getTenantDetail,
  toggleTenantActive,
  updateTenantPackage,
  updateTenantAddon,
  updateTenantFeature,
  grantTenantTrial,
  patchTenantProfile,
  listOrphanTenants,
  purgeTenantWorkspaceEndpoint,
  purgeOrphansBatch,
  adminCheckTenantUserEmail,
  adminAddTenantUser,
  adminCheckWorkspaceUserEmail,
  adminAddWorkspaceUser,
} = require("../controllers/platformTenantController");
const { provisionTenant } = require("../services/provisionTenant");
const tenantDbProvisioningRoutes = require("./tenantDbProvisioning");

const router = express.Router();
const tenantResolutionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many tenant resolution requests. Try again shortly." },
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// All admin routes run these in order:
//   1. verifyToken       — validate JWT
//   2. resolveTenantContext — populate req.user
//   3. platformAdminIsolation — CRITICAL: strip tenant_id so admin requests
//      always hit mainPool only and can NEVER accidentally read tenant CRM data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips tenant_id from the request user for platform admin requests.
 *
 * Why this matters:
 * - Without this, if a platform admin also has a tenant_id on their user row,
 *   the tenantDbMiddleware could bind a tenant DB pool to their request.
 * - That would mean admin controller queries could accidentally run against
 *   a tenant's private database instead of mainPool.
 * - By nulling tenant_id here, we guarantee ALL admin queries use mainPool only.
 * - Admin controllers must NEVER query CRM tables (contacts, leads, tasks etc.)
 *   This middleware is a safety net — the controllers must still be written correctly.
 */
function platformAdminIsolation(req, res, next) {
  if (req.user) {
    req.user.tenant_id = null;
  }
  return next();
}

// Apply to ALL routes in this router
router.use(verifyToken, resolveTenantContext, platformAdminIsolation);
router.use("/", tenantDbProvisioningRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

router.get("/stats", requirePlatformAdmin, getDashboardStats);
router.get("/superadmin/status", requirePlatformAdmin, getSuperAdminStatus);

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ⚠️  getAllUsers / getUserDetail must NOT return: password_hash,
//     password_reset_token, password_reset_expires
//     They SHOULD return: id, email, first_name, last_name, role,
//     tenant_id, is_active, created_at only.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users",                requirePlatformAdmin, getAllUsers);
router.get("/users/:id",            requirePlatformAdmin, getUserDetail);
router.post("/users/:userId/trial", requirePlatformAdmin, grantTrial);
router.patch("/users/:userId/role",          requirePlatformAdmin, updateUserRole);
router.patch("/users/:userId/toggle-active", requirePlatformAdmin, toggleUserActive);

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS & BILLING
// ─────────────────────────────────────────────────────────────────────────────

router.get("/orders",                    requirePlatformAdmin, getAllOrders);
router.patch("/orders/:orderId/status",  requirePlatformAdmin, updateOrderStatus);

// ─────────────────────────────────────────────────────────────────────────────
// CONTACTS
// ⚠️  IMPORTANT: getContactRequests must query a "contact_us" / "support_requests"
//     table — NOT the CRM `contacts` table which belongs to tenants.
//     If your adminController.getContactRequests currently queries the `contacts`
//     table, you must rename/refactor it to only query your platform's own
//     inbound contact form submissions.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/contacts", requirePlatformAdmin, getContactRequests);
router.get("/tenant-resolution", tenantResolutionLimiter, requirePlatformAdmin, resolveTenantMapping);

// ─────────────────────────────────────────────────────────────────────────────
// TENANT ADMINS & PLATFORM USERS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/tenant-admins",  requirePlatformAdmin, listTenantWorkspaceAdmins);

router.get("/platform-users",        requirePlatformAdmin, listPlatformUsers);
router.post("/platform-users",       requirePlatformAdmin, createPlatformUser);
router.patch("/platform-users/:id/role", requirePlatformAdmin, patchPlatformUserRole);
router.delete("/platform-users/:id",     requirePlatformAdmin, deactivatePlatformUser);

// ─────────────────────────────────────────────────────────────────────────────
// TENANTS (company metadata only — never CRM data)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/tenants", requirePlatformAdmin, getAllTenants);
router.get("/tenants/orphans", requirePlatformAdmin, listOrphanTenants);
router.post("/tenants/orphans/purge", requirePlatformAdmin, purgeOrphansBatch);

router.post("/tenants", requirePlatformAdmin, async (req, res) => {
  try {
    const {
      tenantName,
      ownerClerkUserId,
      ownerClerkId,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      packageName,
    } = req.body || {};
    const data = await provisionTenant({
      tenantName,
      ownerClerkUserId: ownerClerkUserId || ownerClerkId,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      packageName,
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("POST /api/admin/tenants error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/tenants/:id/purge-workspace", requirePlatformAdmin, purgeTenantWorkspaceEndpoint);
router.get("/tenants/:id",               requirePlatformAdmin, getTenantDetail);
router.get("/tenants/:id/users/check-email", requirePlatformAdmin, adminCheckTenantUserEmail);
router.post("/tenants/:id/users",        requirePlatformAdmin, adminAddTenantUser);
router.get("/workspace/users/check-email", requirePlatformAdmin, adminCheckWorkspaceUserEmail);
router.post("/workspace/users", requirePlatformAdmin, adminAddWorkspaceUser);
router.patch("/tenants/:id/active",      requirePlatformAdmin, toggleTenantActive);
router.patch("/tenants/:id/package",     requirePlatformAdmin, updateTenantPackage);
router.patch("/tenants/:id/addon",       requirePlatformAdmin, updateTenantAddon);
router.patch("/tenants/:id/feature",     requirePlatformAdmin, updateTenantFeature);
router.post("/tenants/:id/grant-trial",  requirePlatformAdmin, grantTenantTrial);
router.patch("/tenants/:id",             requirePlatformAdmin, patchTenantProfile);

// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE CATALOG
// ─────────────────────────────────────────────────────────────────────────────

router.get("/catalog/packages",          requirePlatformAdmin, adminListPackages);
router.get("/catalog/addons",            requirePlatformAdmin, adminListAddons);
router.post("/catalog/packages",         requirePlatformAdmin, adminCreatePackage);
router.patch("/catalog/packages/:id",    requirePlatformAdmin, adminUpdatePackage);
router.delete("/catalog/packages/:id",   requirePlatformAdmin, adminDeletePackage);
router.post("/catalog/addons",           requirePlatformAdmin, adminCreateAddon);
router.patch("/catalog/addons/:id",      requirePlatformAdmin, adminUpdateAddon);
router.delete("/catalog/addons/:id",     requirePlatformAdmin, adminDeleteAddon);

// ─────────────────────────────────────────────────────────────────────────────
// COUPONS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/coupons",       requirePlatformAdmin, adminListCoupons);
router.post("/coupons",      requirePlatformAdmin, adminCreateCoupon);
router.patch("/coupons/:id", requirePlatformAdmin, adminUpdateCoupon);
router.delete("/coupons/:id",requirePlatformAdmin, adminDeleteCoupon);

module.exports = router;