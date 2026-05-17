const collectionService = require("../services/collectionService");

async function list(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (userId) {
      try {
        await collectionService.sweepCollectionFollowupNotifications(userId);
      } catch (sweepErr) {
        console.warn("collections sweep:", sweepErr.message);
      }
    }
    const { rows, total, limit, offset } = await collectionService.listCollections(req);
    res.json({ success: true, data: rows, total, limit, offset });
  } catch (err) {
    console.error("GET /collections:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function summary(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (userId) {
      try {
        await collectionService.sweepCollectionFollowupNotifications(userId);
      } catch (sweepErr) {
        console.warn("collections summary sweep:", sweepErr.message);
      }
    }
    const data = await collectionService.getSummary(req);
    res.json({ success: true, data });
  } catch (err) {
    console.error("GET /collections/summary:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const data = await collectionService.getCollectionWithDetails(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function create(req, res) {
  try {
    const created = await collectionService.createCollectionsFromVisit(req);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("POST /collections:", err.message);
    const msg = err.message || "Create failed";
    const code =
      msg.includes("required") ||
      msg.includes("cannot") ||
      msg.includes("not found") ||
      msg.includes("Invalid")
        ? 400
        : 500;
    res.status(code).json({ success: false, message: msg });
  }
}

async function patch(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const data = await collectionService.updateCollection(req, id, req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addPayment(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const data = await collectionService.addPayment(req, id, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    const msg = err.message || "Payment failed";
    const code =
      msg.includes("not found") || msg.includes("exceeds") || msg.includes("cancelled")
        ? 400
        : 500;
    res.status(code).json({ success: false, message: msg });
  }
}

async function markPaid(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const data = await collectionService.markPaid(req, id, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  list,
  summary,
  getOne,
  create,
  patch,
  addPayment,
  markPaid,
};
