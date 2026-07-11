const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getMeetings,
  getMeetingStats,
  exportMeetingsCsv,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  bulkDeleteMeetings,
  bulkAssignMeetings,
} = require("../controllers/meetingController");

const router = express.Router();
router.use(verifyToken);

router.get("/stats", getMeetingStats);
router.get("/export", exportMeetingsCsv);
router.post("/bulk-delete", bulkDeleteMeetings);
router.post("/bulk-assign", bulkAssignMeetings);
router.get("/", getMeetings);
router.post("/", createMeeting);
router.put("/:id", updateMeeting);
router.delete("/:id", deleteMeeting);

module.exports = router;