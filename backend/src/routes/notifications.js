const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getNotifications,
  markAllNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();
router.use(verifyToken);

router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);

module.exports = router;