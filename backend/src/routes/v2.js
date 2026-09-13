const express  = require("express");
const multer = require("multer");
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
  updateInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  getInvoiceProducts,
  getInvoicePayments,
  createInvoicePayment,
  markInvoiceAsPaid,
  patchInvoicePayment,
  duplicateInvoice,
  getInvoiceWhatsapp,
  emailInvoice,
  getInvoicePdf,
  createPaymentReminder,
} = require("../controllers/invoiceController");

const {
  getQuotations,
  getQuotationById,
  getQuotationPdf,
  getQuotationWhatsapp,
  emailQuotation,
  duplicateQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  getBankDetails,
  createOrUpdateBankDetail,
  getQuotationCustomOptions,
  renameQuotationCustomOption,
  deleteQuotationCustomOption,
} = require("../controllers/quotationController");

const {
  getPaymentMethods,
  postPaymentMethod,
  putPaymentMethod,
  removePaymentMethod,
} = require("../controllers/paymentMethodsController");

const {
  getBrochures,
  postBrochure,
  putBrochure,
  removeBrochure,
  downloadBrochure,
} = require("../controllers/brochuresController");

const {
  getCompanySettings,
  updateCompanySettings,
  getIntegrations,
  toggleIntegration,
  getWebSettingsHandler,
  putWebSettingsHandler,
  resetInvoiceStartHandler,
  uploadLogoMiddleware,
  uploadSignatureMiddleware,
  uploadLogoHandler,
  uploadSignatureHandler,
  getWebAssetHandler,
} = require("../controllers/settingsController");

const { getCustomers, getCustomerById } = require("../controllers/customerController");
const {
  getStorage,
  getStorageFile,
  deleteStorageFile,
  deleteStorageByPath,
  bulkDeleteStorage,
  downloadStorageByPath,
} = require("../controllers/storageController");

const brochureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (mime === "application/pdf" || mime.startsWith("image/")) return cb(null, true);
    cb(new Error("Only PDF or image files are allowed"));
  },
});

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

router.get("/invoices/products", getInvoiceProducts);
router.get("/invoices", getInvoices);
router.get("/invoices/:id/receipt", getInvoiceReceipt);
router.get("/invoices/:id/payments", getInvoicePayments);
router.post("/invoices/:id/payments", createInvoicePayment);
router.post("/invoices/:id/mark-paid", markInvoiceAsPaid);
router.patch("/invoices/:id/payments/:paymentId", patchInvoicePayment);
router.get("/invoices/:id/pdf", getInvoicePdf);
router.post("/invoices/:id/email", emailInvoice);
router.get("/invoices/:id/whatsapp", getInvoiceWhatsapp);
router.post("/invoices/:id/duplicate", duplicateInvoice);
router.post("/invoices/:id/payment-reminder", createPaymentReminder);
router.get("/invoices/:id", getInvoiceById);
router.post("/invoices", createInvoice);
router.put("/invoices/:id", updateInvoice);
router.patch("/invoices/:id/status", updateInvoiceStatus);
router.delete("/invoices/:id", deleteInvoice);

router.get("/quotations/custom-options", getQuotationCustomOptions);
router.put("/quotations/custom-options/rename", renameQuotationCustomOption);
router.delete("/quotations/custom-options", deleteQuotationCustomOption);
router.get("/quotations", getQuotations);
router.get("/quotations/:id/pdf", getQuotationPdf);
router.get("/quotations/:id/whatsapp", getQuotationWhatsapp);
router.post("/quotations/:id/email", emailQuotation);
router.post("/quotations/:id/duplicate", duplicateQuotation);
router.get("/quotations/:id", getQuotationById);
router.post("/quotations", createQuotation);
router.put("/quotations/:id", updateQuotation);
router.delete("/quotations/:id", deleteQuotation);

router.get("/bank-details", getBankDetails);
router.post("/bank-details", createOrUpdateBankDetail);

router.get("/payment-methods", getPaymentMethods);
router.post("/payment-methods", postPaymentMethod);
router.put("/payment-methods/:id", putPaymentMethod);
router.delete("/payment-methods/:id", removePaymentMethod);

router.get("/brochures", getBrochures);
router.post("/brochures", (req, res, next) => {
  brochureUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, postBrochure);
router.get("/brochures/:id/file", downloadBrochure);
router.put("/brochures/:id", (req, res, next) => {
  brochureUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, putBrochure);
router.delete("/brochures/:id", removeBrochure);

router.get("/settings/company", getCompanySettings);
router.put("/settings/company", updateCompanySettings);
router.get("/settings/web", getWebSettingsHandler);
router.put("/settings/web", putWebSettingsHandler);
router.get("/settings/web/assets/:file", getWebAssetHandler);
router.post("/settings/web/invoice-start-reset", resetInvoiceStartHandler);
router.post("/settings/web/logo", uploadLogoMiddleware, uploadLogoHandler);
router.post("/settings/web/invoice-signature", uploadSignatureMiddleware, uploadSignatureHandler);

router.get("/storage", getStorage);
router.get("/storage/content", downloadStorageByPath);
router.delete("/storage/content", deleteStorageByPath);
router.post("/storage/bulk-delete", bulkDeleteStorage);
router.get("/storage/:id", getStorageFile);
router.delete("/storage/:id", deleteStorageFile);

router.get("/customers", getCustomers);
router.get("/customers/:id", getCustomerById);

router.get("/integrations", getIntegrations);
router.post("/integrations/:key/toggle", toggleIntegration);

module.exports = router;
