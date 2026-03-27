const messagingSettingsService = require("../modules/messaging/messaging-settings.service");
const messagingGateway = require("../modules/messaging/messaging.gateway");

async function buildModuleData() {
  const settings = await messagingSettingsService.getPublicSettings();
  const providers = await messagingGateway.getAllProviderStatuses();
  return {
    settings,
    providers,
    activeChannel: settings.activeChannel,
  };
}

async function renderMessagingPage(req, res) {
  const moduleData = await buildModuleData();
  res.render("layouts/main", {
    pageTitle: "Mensajeria - Panel Multi Agente IA",
    activeMenu: "messaging",
    headerTitle: "Mensajeria",
    moduleView: "messaging",
    moduleData,
    pageScripts: ["/socket.io/socket.io.js", "/js/messaging.js"],
  });
}

async function getStatus(req, res) {
  const data = await buildModuleData();
  res.json({ ok: true, ...data });
}

async function updateActiveChannel(req, res) {
  try {
    const settings = await messagingSettingsService.setActiveChannel(req.body.activeChannel);
    res.json({ ok: true, settings: await messagingSettingsService.getPublicSettings(), activeChannel: settings.activeChannel });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateTelegramConfig(req, res) {
  try {
    await messagingSettingsService.updateSettings({
      telegramBotToken: req.body.telegramBotToken,
      telegramBotUsername: req.body.telegramBotUsername,
    });
    await messagingGateway.refreshLink({ channel: "telegram" });
    res.json({
      ok: true,
      settings: await messagingSettingsService.getPublicSettings(),
      providers: await messagingGateway.getAllProviderStatuses(),
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function refreshProvider(req, res) {
  try {
    const channel = req.body.channel || req.query.channel;
    await messagingGateway.refreshLink({ channel });
    res.json({
      ok: true,
      providers: await messagingGateway.getAllProviderStatuses(),
    });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function listGroups(req, res) {
  try {
    const channel = req.query.channel || req.body.channel;
    const groups = await messagingGateway.listGroups({ channel });
    res.json({ ok: true, groups, channel: await messagingGateway.getChannel({ channel }) });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderMessagingPage,
  getStatus,
  updateActiveChannel,
  updateTelegramConfig,
  refreshProvider,
  listGroups,
};
