const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getReminders,
  getReminderMeta,
  createReminder,
  updateReminder,
  markReminderDone,
  deleteReminder,
  bulkDeleteReminders,
} = require("../controllers/reminderController");

const router = express.Router();
router.use(verifyToken);

router.get("/meta", getReminderMeta);
router.get("/", getReminders);
router.post("/", createReminder);
router.post("/bulk-delete", bulkDeleteReminders);
router.put("/:id", updateReminder);
router.patch("/:id/done", markReminderDone);
router.delete("/:id", deleteReminder);

module.exports = router;