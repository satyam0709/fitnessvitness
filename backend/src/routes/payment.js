const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { createCheckoutSession, handleStripeWebhook, getPaymentStatus } = require("../controllers/paymentController");
const { createUnifiedCheckout } = require("../controllers/unifiedBillingController");
const { resolveTenantContext, enforceSubscription } = require("../middleware/tenantAccess");

const router = express.Router();

router.post("/webhook/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

router.post("/checkout", verifyToken, resolveTenantContext, createCheckoutSession);
router.post("/checkout/unified", verifyToken, resolveTenantContext, createUnifiedCheckout);
router.get("/status", verifyToken, resolveTenantContext, getPaymentStatus);

module.exports = router;
