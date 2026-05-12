const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getReminders,
  createReminder,
  updateReminder,
  markReminderDone,
  deleteReminder,
  bulkDeleteReminders,
} = require("../controllers/reminderController");

const router = express.Router();
router.use(verifyToken);

router.get("/", getReminders);
router.post("/", createReminder);
router.post("/bulk-delete", bulkDeleteReminders);
router.put("/:id", updateReminder);
router.patch("/:id/done", markReminderDone);
router.delete("/:id", deleteReminder);

module.exports = router;