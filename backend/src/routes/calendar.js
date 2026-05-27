const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getCalendarFeed,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getGoogleCalendarStatus,
  postGoogleCalendarSync,
  getAppleCalendarStatus,
  putAppleCalendarSettings,
  deleteAppleCalendarDisconnect,
  postAppleCalendarSync,
  quickAddFromCalendar,
} = require("../controllers/calendarController");

const router = express.Router();
router.use(verifyToken);

router.get("/feed", getCalendarFeed);
router.post("/quick-add", quickAddFromCalendar);
router.post("/events", createCalendarEvent);
router.put("/events/:id", updateCalendarEvent);
router.delete("/events/:id", deleteCalendarEvent);

router.get("/google/status", getGoogleCalendarStatus);
router.post("/google/sync", postGoogleCalendarSync);

router.get("/apple/status", getAppleCalendarStatus);
router.put("/apple/settings", putAppleCalendarSettings);
router.delete("/apple/disconnect", deleteAppleCalendarDisconnect);
router.post("/apple/sync", postAppleCalendarSync);

module.exports = router;
