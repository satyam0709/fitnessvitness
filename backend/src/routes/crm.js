const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const { resolveTenantContext, enforceSubscription, requireFeature } = require("../middleware/tenantAccess");
const { bindTenantCrmPool } = require("../middleware/tenantCrmPool");
const { requireCrmTenant } = require("../middleware/crmTenant");
const leadsRouter = require("./leads");
const tasksRouter = require("./tasks");
const opportunitiesRouter = require("./opportunities");
const ticketsRouter = require("./tickets");
const remindersRouter = require("./reminders");
const meetingsRouter = require("./meetings");
const todosRouter = require("./todos");
const companiesRouter = require("./companies");
const {
  getNotes,
  createNote,
  updateNote,
  deleteNote,
} = require("../controllers/noteController");
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../controllers/customerController");
const {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoiceStatus,
  deleteInvoice,
} = require("../controllers/invoiceController");
const { getDashboardStats } = require("../controllers/dashboardController");

const router = express.Router();
router.use(verifyToken, resolveTenantContext, bindTenantCrmPool, requireCrmTenant, enforceSubscription());

router.use("/leads", leadsRouter);
router.use("/opportunities", opportunitiesRouter);
router.use("/tickets", ticketsRouter);
router.use("/tasks", tasksRouter);
router.use("/reminders", remindersRouter);
router.use("/meetings", meetingsRouter);
router.use("/todos", todosRouter);
router.use("/companies", companiesRouter);

router.get("/notes", requireFeature("lead_management", "view"), getNotes);
router.post("/notes", requireFeature("lead_management", "create"), createNote);
router.put("/notes/:id", requireFeature("lead_management", "edit"), updateNote);
router.delete("/notes/:id", requireFeature("lead_management", "delete"), deleteNote);

router.get("/customers", requireFeature("customer_management", "view"), getCustomers);
router.post("/customers", requireFeature("customer_management", "create"), createCustomer);
router.put("/customers/:id", requireFeature("customer_management", "edit"), updateCustomer);
router.delete("/customers/:id", requireFeature("customer_management", "delete"), deleteCustomer);

router.get("/invoices", requireFeature("invoice_management", "view"), getInvoices);
router.get("/invoices/:id", requireFeature("invoice_management", "view"), getInvoiceById);
router.post("/invoices", requireFeature("invoice_management", "create"), createInvoice);
router.patch("/invoices/:id/status", requireFeature("invoice_management", "edit"), updateInvoiceStatus);
router.delete("/invoices/:id", requireFeature("invoice_management", "delete"), deleteInvoice);

router.get("/dashboard", getDashboardStats);

module.exports = router;

