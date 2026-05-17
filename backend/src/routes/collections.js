const express = require("express");
const { verifyToken } = require("../middleware/verifyToken");
const collectionController = require("../controllers/collectionController");

const router = express.Router();
router.use(verifyToken);

router.get("/summary", collectionController.summary);
router.get("/", collectionController.list);
router.get("/:id", collectionController.getOne);
router.post("/", collectionController.create);
router.patch("/:id", collectionController.patch);
router.post("/:id/payments", collectionController.addPayment);
router.post("/:id/mark-paid", collectionController.markPaid);

module.exports = router;
