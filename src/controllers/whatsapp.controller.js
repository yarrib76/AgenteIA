const whatsappService = require("../modules/whatsapp/whatsapp.state");
const whatsappGateway = require("../modules/whatsapp/whatsapp.gateway");

function renderDashboard(req, res) {
  const status = whatsappService.getPublicStatus();

  res.render("layouts/main", {
    pageTitle: "Panel Multi Agente IA",
    activeMenu: "whatsapp-link",
    headerTitle: "Vincular Whatsapp",
    moduleView: "whatsapp-link",
    moduleData: { status },
    pageScripts: ["/socket.io/socket.io.js", "/js/whatsapp-link.js"],
  });
}

function getStatus(req, res) {
  res.json(whatsappService.getPublicStatus());
}

async function refreshQr(req, res) {
  try {
    await whatsappService.refreshQr();
    res.json({
      ok: true,
      status: whatsappService.getPublicStatus(),
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
    const groups = await whatsappGateway.listGroups();
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
