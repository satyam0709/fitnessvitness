const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
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
const {
  listTenants,
  updateTenantStatus,
  listSubscriptions,
  getSuperadminAnalytics,
} = require("../controllers/superadminController");
const { requirePlatformAdmin } = require("../middleware/platformAdmin");

const router = express.Router();

router.use(verifyToken, requirePlatformAdmin);

router.get("/tenants", listTenants);
router.patch("/tenants/:id/status", updateTenantStatus);
router.get("/subscriptions", listSubscriptions);
router.get("/analytics", getSuperadminAnalytics);

router.get("/packages", adminListPackages);
router.post("/packages", adminCreatePackage);
router.patch("/packages/:id", adminUpdatePackage);
router.delete("/packages/:id", adminDeletePackage);

router.get("/addons", adminListAddons);
router.post("/addons", adminCreateAddon);
router.patch("/addons/:id", adminUpdateAddon);
router.delete("/addons/:id", adminDeleteAddon);

router.get("/coupons", adminListCoupons);
router.post("/coupons", adminCreateCoupon);
router.patch("/coupons/:id", adminUpdateCoupon);
router.delete("/coupons/:id", adminDeleteCoupon);

module.exports = router;

