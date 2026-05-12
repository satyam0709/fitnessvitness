const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
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
const router = express.Router();
router.use(verifyToken);

router.use("/leads", leadsRouter);
router.use("/tasks", tasksRouter);
router.use("/opportunities", opportunitiesRouter);
router.use("/tickets", ticketsRouter);
router.use("/reminders", remindersRouter);
router.use("/meetings", meetingsRouter);
router.use("/todos", todosRouter);
router.use("/companies", companiesRouter);

router.get("/notes", getNotes);
router.post("/notes", createNote);
router.put("/notes/:id", updateNote);
router.delete("/notes/:id", deleteNote);

router.get("/customers", getCustomers);
router.post("/customers", createCustomer);
router.put("/customers/:id", updateCustomer);
router.delete("/customers/:id", deleteCustomer);

module.exports = router;