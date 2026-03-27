const telegramState = require("./telegram.state");
const messagingGateway = require("../messaging/messaging.gateway");
const messagingSettingsService = require("../messaging/messaging-settings.service");
const { addMessage } = require("../chat/messages.service");
const { routeTaskReplyIfNeeded } = require("../messaging/reply-routing.service");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeTelegramTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, "");
}

function buildTelegramService() {
  let io = null;
  let pollTimer = null;
  let polling = false;

  function broadcast(status) {
    if (!io) return;
    io.emit("telegram-status", status);
  }

  async function getToken() {
    const settings = await messagingSettingsService.getSettings();
    return String(settings.telegramBotToken || "").trim();
  }

  async function telegramRequest(method, body) {
    const token = await getToken();
    if (!token) throw new Error("Telegram no configurado.");
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(
        payload && payload.description
          ? String(payload.description)
          : `Error Telegram API (${response.status})`
      );
    }
    return payload.result;
  }

  async function upsertKnownChat(chat) {
    if (!chat || chat.id == null) return;
    const { telegramChats } = getRepositories();
    const rows = await telegramChats.list();
    const list = Array.isArray(rows) ? rows : [];
    const chatId = normalizeTelegramTarget(chat.id);
    const next = {
      id: chatId,
      title: String(chat.title || chat.username || chat.first_name || chat.last_name || chatId).trim(),
      type: String(chat.type || "").trim(),
      username: String(chat.username || "").trim(),
      updatedAt: new Date().toISOString(),
    };
    const index = list.findIndex((row) => String(row && row.id) === chatId);
    if (index >= 0) {
      list[index] = { ...list[index], ...next };
    } else {
      list.push({ ...next, createdAt: next.updatedAt });
    }
    await telegramChats.saveAll(list);
  }

  async function listGroupsInternal() {
    const { telegramChats } = getRepositories();
    const rows = await telegramChats.list();
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => ["group", "supergroup"].includes(String(row && row.type || "")))
      .map((row) => ({
        id: String(row.id),
        name: String(row.title || row.username || row.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  async function sendMessageInternal(target, text) {
    const chatId = normalizeTelegramTarget(target);
    if (!chatId) throw new Error("Identificador de Telegram invalido.");
    const result = await telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
    });
    return {
      chatId,
      contactKey: chatId,
      messageId: result && result.message_id != null ? String(result.message_id) : "",
    };
  }

  async function resolveContactKeysInternal(target) {
    const key = normalizeTelegramTarget(target);
    return key ? [key] : [];
  }

  async function refreshInternal() {
    await initTelegram();
  }

  async function processUpdate(update) {
    const message = update && (update.message || update.edited_message);
    if (!message || !message.chat || message.text == null) return;
    const text = String(message.text || "").trim();
    if (!text) return;

    await upsertKnownChat(message.chat);

    const chatId = normalizeTelegramTarget(message.chat.id);
    const isGroup = ["group", "supergroup"].includes(String(message.chat.type || ""));
    const authorName = String(
      (message.from && (message.from.first_name || message.from.username || message.from.last_name)) || ""
    ).trim();
    const authorTarget = message.from && message.from.id != null
      ? normalizeTelegramTarget(message.from.id)
      : "";
    const sourceTarget = chatId;

    await addMessage({
      channel: "telegram",
      contactPhone: sourceTarget,
      direction: "in",
      text,
      status: "received",
      providerMessageId: message.message_id != null ? String(message.message_id) : "",
    });

    await routeTaskReplyIfNeeded({
      channel: "telegram",
      sourceTarget,
      text,
      quotedMessageId:
        message.reply_to_message && message.reply_to_message.message_id != null
          ? String(message.reply_to_message.message_id)
          : "",
      isGroup,
      groupName: String(message.chat.title || ""),
      authorName,
      authorTarget,
    });
  }

  async function pollOnce() {
    const settings = await messagingSettingsService.getSettings();
    const token = String(settings.telegramBotToken || "").trim();
    if (!token) {
      telegramState.patchState({
        linked: false,
        statusText: "Telegram no configurado.",
        hasClient: false,
        configured: false,
        polling: false,
        botUsername: settings.telegramBotUsername || "",
      });
      return;
    }

    const { messagingSettings } = getRepositories();
    const rows = await messagingSettings.list();
    const stored = Array.isArray(rows) && rows[0] ? rows[0] : {};
    const offset = Number.parseInt(String(stored.telegramLastUpdateId || "0"), 10) || 0;

    const me = await telegramRequest("getMe", {});
    telegramState.patchState({
      linked: true,
      statusText: "Bot de Telegram activo.",
      hasClient: true,
      configured: true,
      polling: true,
      botUsername: String(me && me.username || settings.telegramBotUsername || "").trim(),
    });

    const updates = await telegramRequest("getUpdates", {
      offset: offset > 0 ? offset + 1 : undefined,
      timeout: 0,
      allowed_updates: ["message", "edited_message"],
    });
    let maxUpdateId = offset;
    for (const update of updates || []) {
      const updateId = Number(update && update.update_id);
      if (Number.isFinite(updateId) && updateId > maxUpdateId) maxUpdateId = updateId;
      await processUpdate(update);
    }
    if (maxUpdateId !== offset) {
      await messagingSettingsService.saveSettings({
        ...stored,
        ...settings,
        telegramLastUpdateId: maxUpdateId,
      });
    }
  }

  async function schedulePolling() {
    if (polling) return;
    polling = true;

    const loop = async () => {
      if (!polling) return;
      try {
        await pollOnce();
      } catch (error) {
        telegramState.patchState({
          linked: false,
          hasClient: false,
          configured: Boolean(await getToken().catch(() => "")),
          polling: false,
          statusText: `Error Telegram: ${error.message}`,
        });
      } finally {
        if (!polling) return;
        const settings = await messagingSettingsService.getSettings().catch(() => ({
          telegramPollIntervalMs: 5000,
        }));
        const waitMs = settings.telegramPollIntervalMs || 5000;
        pollTimer = setTimeout(loop, waitMs);
      }
    };

    await loop();
  }

  async function initTelegram() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    polling = false;
    await schedulePolling();
  }

  function stop() {
    polling = false;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function attachIo(nextIo) {
    io = nextIo;
    if (io) {
      io.on("connection", (socket) => {
        socket.emit("telegram-status", telegramState.getPublicStatus());
      });
    }
  }

  telegramState.setHooks({
    onRefresh: refreshInternal,
    onBroadcast: broadcast,
  });

  messagingGateway.setProvider("telegram", {
    sendMessage: sendMessageInternal,
    isReady: async () => {
      const status = telegramState.getPublicStatus();
      return Boolean(status.linked && status.hasClient);
    },
    resolveContactKeys: resolveContactKeysInternal,
    listGroups: listGroupsInternal,
    getPublicStatus: async () => telegramState.getPublicStatus(),
    refreshLink: refreshInternal,
  });

  return {
    init: initTelegram,
    stop,
    attachIo,
  };
}

module.exports = buildTelegramService;
