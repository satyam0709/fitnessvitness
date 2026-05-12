const express = require("express");
const {
  getInvitationByToken,
  acceptInvitation,
} = require("../controllers/invitationController");

const router = express.Router();

router.get("/:token", getInvitationByToken);
router.post("/accept", acceptInvitation);

module.exports = router;

