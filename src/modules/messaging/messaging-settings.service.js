const { getRepositories } = require("../../repositories/repository-provider");

const DEFAULT_SETTINGS = {
  activeChannel: "whatsapp",
  telegramBotToken: "",
  telegramBotUsername: "",
  telegramPollIntervalMs: 5000,
  telegramLastUpdateId: 0,
};

function normalizeChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  return channel === "telegram" ? "telegram" : "whatsapp";
}

function normalizeSettings(row) {
  const raw = row && typeof row === "object" ? row : {};
  const pollInterval = Number.parseInt(String(raw.telegramPollIntervalMs || ""), 10);
  return {
    activeChannel: normalizeChannel(raw.activeChannel),
    telegramBotToken: String(raw.telegramBotToken || "").trim(),
    telegramBotUsername: String(raw.telegramBotUsername || "").trim().replace(/^@+/, ""),
    telegramPollIntervalMs:
      Number.isFinite(pollInterval) && pollInterval >= 1000 ? pollInterval : 5000,
    telegramLastUpdateId:
      Number.parseInt(String(raw.telegramLastUpdateId || "0"), 10) || 0,
  };
}

async function getSettings() {
  const { messagingSettings } = getRepositories();
  const rows = await messagingSettings.list();
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ...DEFAULT_SETTINGS };
  }
  return normalizeSettings(rows[0]);
}

async function saveSettings(nextSettings) {
  const { messagingSettings } = getRepositories();
  const normalized = normalizeSettings(nextSettings);
  await messagingSettings.saveAll([normalized]);
  return normalized;
}

async function updateSettings(patch) {
  const current = await getSettings();
  return saveSettings({
    ...current,
    ...(patch || {}),
  });
}

async function setActiveChannel(channel) {
  return updateSettings({ activeChannel: normalizeChannel(channel) });
}

async function getPublicSettings() {
  const settings = await getSettings();
  return {
    activeChannel: settings.activeChannel,
    telegramBotConfigured: Boolean(settings.telegramBotToken),
    telegramBotUsername: settings.telegramBotUsername || "",
    telegramPollIntervalMs: settings.telegramPollIntervalMs,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeChannel,
  getSettings,
  getPublicSettings,
  saveSettings,
  updateSettings,
  setActiveChannel,
};
