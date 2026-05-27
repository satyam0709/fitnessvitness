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

const {
  getInvoices,
  getInvoiceById,
  getInvoiceReceipt,
  createInvoice,
  updateInvoiceStatus,
  deleteInvoice,
} = require("../controllers/invoiceController");

const {
  getCompanySettings,
  updateCompanySettings,
} = require("../controllers/settingsController");

const { getCustomers } = require("../controllers/customerController");

const {
  getIntegrations,
  toggleIntegration,
} = require("../controllers/settingsController");

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

router.get("/invoices", getInvoices);
router.get("/invoices/:id/receipt", getInvoiceReceipt);
router.get("/invoices/:id", getInvoiceById);
router.post("/invoices", createInvoice);
router.patch("/invoices/:id/status", updateInvoiceStatus);
router.delete("/invoices/:id", deleteInvoice);

router.get("/settings/company", getCompanySettings);
router.put("/settings/company", updateCompanySettings);

router.get("/customers", getCustomers);

router.get("/integrations", getIntegrations);
router.post("/integrations/:key/toggle", toggleIntegration);

module.exports = router;