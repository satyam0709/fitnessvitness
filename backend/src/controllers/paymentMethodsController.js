const {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} = require("../services/paymentMethodsService");
const { emitInvoicesChanged } = require("../realtime/meetingsRealtime");

async function getPaymentMethods(_req, res) {
  try {
    const methods = await listPaymentMethods();
    res.json({ success: true, methods });
  } catch (err) {
    console.error("getPaymentMethods", err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function postPaymentMethod(req, res) {
  try {
    const row = await createPaymentMethod(req.body?.method || req.body?.name);
    emitInvoicesChanged({ action: "payment_method_create", id: row.id });
    res.json({ success: true, method: row });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function putPaymentMethod(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await updatePaymentMethod(id, req.body?.method || req.body?.name);
    emitInvoicesChanged({ action: "payment_method_update", id: row.id });
    res.json({ success: true, method: row });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

async function removePaymentMethod(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    await deletePaymentMethod(id);
    emitInvoicesChanged({ action: "payment_method_delete", id });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getPaymentMethods,
  postPaymentMethod,
  putPaymentMethod,
  removePaymentMethod,
};
