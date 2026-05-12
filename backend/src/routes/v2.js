const express  = require("express");
const { verifyToken } = require("../middleware/verifyToken");

const {
  getReminders, createReminder, updateReminder, deleteReminder,
} = require("../controllers/reminderController");

const {
  getMeetings, createMeeting, updateMeeting, deleteMeeting, bulkDeleteMeetings,
  getMeetingStats, exportMeetingsCsv,
} = require("../controllers/meetingController");

const {
  getNotes, createNote, updateNote, deleteNote,
} = require("../controllers/noteController");

const router = express.Router();
router.use(verifyToken);

router.get("/reminders", getReminders);
router.post("/reminders", createReminder);
router.put("/reminders/:id", updateReminder);
router.delete("/reminders/:id", deleteReminder);

router.get("/meetings", getMeetings);
router.post("/meetings", createMeeting);
router.put("/meetings/:id", updateMeeting);
router.delete("/meetings/:id", deleteMeeting);
router.post("/meetings/bulk-delete", bulkDeleteMeetings);

router.get("/notes", getNotes);
router.post("/notes", createNote);
router.put("/notes/:id", updateNote);
router.delete("/notes/:id", deleteNote);

module.exports = router;