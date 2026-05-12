const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  getCalendarFeed,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getGoogleCalendarStatus,
  postGoogleCalendarSync,
} = require("../controllers/calendarController");

const router = express.Router();
router.use(verifyToken);

router.get("/feed", getCalendarFeed);
router.post("/events", createCalendarEvent);
router.put("/events/:id", updateCalendarEvent);
router.delete("/events/:id", deleteCalendarEvent);

router.get("/google/status", getGoogleCalendarStatus);
router.post("/google/sync", postGoogleCalendarSync);

module.exports = router;
