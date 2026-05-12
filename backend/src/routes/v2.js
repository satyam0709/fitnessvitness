const express  = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const {
  resolveTenantContext,
  enforceSubscription,
  requireFeature,
} = require("../middleware/tenantAccess");
const { requireCrmTenant } = require("../middleware/crmTenant");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { signupWithDedicatedTenant } = require("../controllers/tenantSignupController");

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
  getCustomers, createCustomer, updateCustomer, deleteCustomer,
} = require("../controllers/customerController");

const {
  getInvoices, getInvoiceById, createInvoice, updateInvoiceStatus, deleteInvoice,
} = require("../controllers/invoiceController");

const {
  getConversation, sendMessage, getUnreadCount,
} = require("../controllers/chatController");

const {
  listChatUsers,
  listThreads,
  getThreadDetails,
  createThread,
  listMessages,
  sendMessageToThread,
  markThreadRead,
  deleteThread,
  getChatRetentionStatus,
} = require("../controllers/chatThreadsController");

const {
  getAttendance, markAttendance,
  getLeaves, createLeaveRequest, approveLeave, rejectLeave,
} = require("../controllers/hrController");

const {
  getPayroll, upsertPayroll, markPayrollPaid,
  getAppraisals, createAppraisal,
} = require("../controllers/hrOpsController");
const {
  requireManagerOrSuperAdmin,
  requireHrFeature,
  requirePayrollFeature,
} = require("../middleware/hrAccess");

const {
  getCompanySettings, updateCompanySettings,
  getIntegrations, toggleIntegration,
} = require("../controllers/settingsController");

const { getStorage }  = require("../controllers/storageController");
const { search }      = require("../controllers/searchController");

const auth = [verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription()];

const router = express.Router();

router.post("/signup/tenant", signupWithDedicatedTenant);

// ── Search ───────────────────────────────────────────────────
router.get("/search", ...auth, search);

// ── Reminders ────────────────────────────────────────────────
router.get   ("/reminders",     ...auth, requireFeature("task_management", "view"), getReminders);
router.post  ("/reminders",     ...auth, requireFeature("task_management", "create"), createReminder);
router.patch ("/reminders/:id", ...auth, requireFeature("task_management", "edit"), updateReminder);
router.delete("/reminders/:id", ...auth, requireFeature("task_management", "delete"), deleteReminder);

// ── Meetings ─────────────────────────────────────────────────
router.get   ("/meetings/stats",  ...auth, requireFeature("task_management", "view"), getMeetingStats);
router.get   ("/meetings/export", ...auth, requireFeature("task_management", "view"), exportMeetingsCsv);
router.post  ("/meetings/bulk-delete", ...auth, requireFeature("task_management", "delete"), bulkDeleteMeetings);
router.get   ("/meetings",     ...auth, requireFeature("task_management", "view"), getMeetings);
router.post  ("/meetings",     ...auth, requireFeature("task_management", "create"), createMeeting);
router.put   ("/meetings/:id", ...auth, requireFeature("task_management", "edit"), updateMeeting);
router.delete("/meetings/:id", ...auth, requireFeature("task_management", "delete"), deleteMeeting);

// ── Notes ────────────────────────────────────────────────────
router.get   ("/notes",     ...auth, requireFeature("lead_management", "view"), getNotes);
router.post  ("/notes",     ...auth, requireFeature("lead_management", "create"), createNote);
router.put   ("/notes/:id", ...auth, requireFeature("lead_management", "edit"), updateNote);
router.delete("/notes/:id", ...auth, requireFeature("lead_management", "delete"), deleteNote);

// ── Customers ────────────────────────────────────────────────
router.get   ("/customers",     ...auth, requireFeature("customer_management", "view"), getCustomers);
router.post  ("/customers",     ...auth, requireFeature("customer_management", "create"), createCustomer);
router.put   ("/customers/:id", ...auth, requireFeature("customer_management", "edit"), updateCustomer);
router.delete("/customers/:id", ...auth, requireFeature("customer_management", "delete"), deleteCustomer);

// ── Invoices ─────────────────────────────────────────────────
router.get   ("/invoices",            ...auth, requireFeature("invoice_management", "view"), getInvoices);
router.get   ("/invoices/:id",        ...auth, requireFeature("invoice_management", "view"), getInvoiceById);
router.post  ("/invoices",            ...auth, requireFeature("invoice_management", "create"), createInvoice);
router.patch ("/invoices/:id/status", ...auth, requireFeature("invoice_management", "edit"), updateInvoiceStatus);
router.delete("/invoices/:id",        ...auth, requireFeature("invoice_management", "delete"), deleteInvoice);

// ── Chat ─────────────────────────────────────────────────────
router.get ("/chat/unread",       ...auth, getUnreadCount);
router.get ("/chat/:otherId",     ...auth, getConversation);
router.post("/chat",              ...auth, sendMessage);

// ── Chat v2 (threads + groups + realtime) ─────────────────────
router.get ("/chat-users",                 ...auth, listChatUsers);
router.get ("/chat-threads",               ...auth, listThreads);
router.get ("/chat-threads/:id",           ...auth, getThreadDetails);
router.post("/chat-threads",               ...auth, createThread);
router.get ("/chat-threads/:id/messages",   ...auth, listMessages);
router.post("/chat-threads/:id/messages",  ...auth, sendMessageToThread);
router.post("/chat-threads/:id/read",      ...auth, markThreadRead);
router.delete("/chat-threads/:id",         ...auth, deleteThread);
router.get ("/chat-retention/status",      ...auth, getChatRetentionStatus);

// ── HR: Attendance ───────────────────────────────────────────
router.get ("/hr/attendance", ...auth, requireHrFeature, getAttendance);
router.post("/hr/attendance", ...auth, requireHrFeature, markAttendance);

// ── HR: Leaves ───────────────────────────────────────────────
router.get  ("/hr/leaves",              ...auth, requireHrFeature, getLeaves);
router.post ("/hr/leaves",              ...auth, requireHrFeature, createLeaveRequest);
router.patch("/hr/leaves/:id/approve",  ...auth, requireHrFeature, requireManagerOrSuperAdmin, approveLeave);
router.patch("/hr/leaves/:id/reject",   ...auth, requireHrFeature, requireManagerOrSuperAdmin, rejectLeave);

// ── HR Ops: Payroll ──────────────────────────────────────────
router.get  ("/hr-ops/payroll",          ...auth, requirePayrollFeature, getPayroll);
router.post ("/hr-ops/payroll",          ...auth, requirePayrollFeature, requireManagerOrSuperAdmin, upsertPayroll);
router.patch("/hr-ops/payroll/:id/paid", ...auth, requirePayrollFeature, requireManagerOrSuperAdmin, markPayrollPaid);

// ── HR Ops: Appraisals ───────────────────────────────────────
router.get ("/hr-ops/appraisals", ...auth, requirePayrollFeature, getAppraisals);
router.post("/hr-ops/appraisals", ...auth, requirePayrollFeature, requireManagerOrSuperAdmin, createAppraisal);

// ── Settings: Company ────────────────────────────────────────
router.get("/settings/company", ...auth, getCompanySettings);
router.put("/settings/company", ...auth, updateCompanySettings);

// ── Settings: Integrations ───────────────────────────────────
router.get ("/integrations",             ...auth, getIntegrations);
router.post("/integrations/:key/toggle", ...auth, toggleIntegration);

// ── Storage ──────────────────────────────────────────────────
router.get("/storage", ...auth, getStorage);

module.exports = router;