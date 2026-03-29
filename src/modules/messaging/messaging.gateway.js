const messagingSettingsService = require("./messaging-settings.service");

const providers = new Map();

function setProvider(channel, provider) {
  const key = messagingSettingsService.normalizeChannel(channel);
  providers.set(key, {
    sendMessage: null,
    isReady: null,
    resolveContactKeys: null,
    listGroups: null,
    getPublicStatus: null,
    refreshLink: null,
    ...provider,
  });
}

function getProvider(channel) {
  const key = messagingSettingsService.normalizeChannel(channel);
  return providers.get(key) || null;
}

async function getChannel(options = {}) {
  if (options && options.channel) {
    return messagingSettingsService.normalizeChannel(options.channel);
  }
  const settings = await messagingSettingsService.getSettings();
  return settings.activeChannel;
}

async function sendMessage(target, text, options = {}) {
  const channel = await getChannel(options);
  const provider = getProvider(channel);
  if (!provider || typeof provider.sendMessage !== "function") {
    throw new Error(`Proveedor de mensajeria no disponible: ${channel}`);
  }
  return provider.sendMessage(target, text, { ...options, channel });
}

async function isReady(options = {}) {
  const channel = await getChannel(options);
  const provider = getProvider(channel);
  if (!provider || typeof provider.isReady !== "function") return false;
  return Boolean(await provider.isReady({ ...options, channel }));
}

async function resolveContactKeys(target, options = {}) {
  const channel = await getChannel(options);
  const provider = getProvider(channel);
  if (!provider || typeof provider.resolveContactKeys !== "function") {
    return [String(target || "").trim()].filter(Boolean);
  }
  return provider.resolveContactKeys(target, { ...options, channel });
}

async function listGroups(options = {}) {
  const channel = await getChannel(options);
  const provider = getProvider(channel);
  if (!provider || typeof provider.listGroups !== "function") return [];
  return provider.listGroups({ ...options, channel });
}

async function refreshLink(options = {}) {
  const channel = await getChannel(options);
  const provider = getProvider(channel);
  if (!provider || typeof provider.refreshLink !== "function") {
    throw new Error(`Proveedor de mensajeria no disponible: ${channel}`);
  }
  return provider.refreshLink({ ...options, channel });
}

async function getProviderStatus(channel) {
  const provider = getProvider(channel);
  if (!provider || typeof provider.getPublicStatus !== "function") {
    return {
      channel,
      ready: false,
      statusText: "Proveedor no disponible.",
    };
  }
  const status = await provider.getPublicStatus({ channel });
  return {
    channel,
    ...status,
  };
}

async function getAllProviderStatuses() {
  return {
    whatsapp: await getProviderStatus("whatsapp"),
    telegram: await getProviderStatus("telegram"),
    internal_chat: await getProviderStatus("internal_chat"),
  };
}

module.exports = {
  setProvider,
  getProvider,
  getChannel,
  sendMessage,
  isReady,
  resolveContactKeys,
  listGroups,
  refreshLink,
  getProviderStatus,
  getAllProviderStatuses,
};
