const messagingController = require("./messaging.controller");
const messagingGateway = require("../modules/messaging/messaging.gateway");

async function renderDashboard(req, res) {
  return messagingController.renderMessagingPage(req, res);
}

async function getStatus(req, res) {
  try {
    const status = await messagingGateway.getProviderStatus("whatsapp");
    res.json(status);
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function refreshQr(req, res) {
  try {
    await messagingGateway.refreshLink({ channel: "whatsapp" });
    res.json({
      ok: true,
      status: await messagingGateway.getProviderStatus("whatsapp"),
      message: "Solicitud de refresco enviada.",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "No se pudo refrescar el QR.",
      details: error.message,
    });
  }
}

async function listGroups(req, res) {
  try {
    const groups = await messagingGateway.listGroups({ channel: "whatsapp" });
    res.json({ ok: true, groups });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderDashboard,
  getStatus,
  refreshQr,
  listGroups,
};
