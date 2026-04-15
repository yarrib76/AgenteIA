const usersService = require("../modules/auth/users.service");
const mobileAuthService = require("../modules/mobile/mobile-auth.service");
const mobileDeviceTokensService = require("../modules/mobile/mobile-device-tokens.service");
const internalChatRealtime = require("../modules/internal-chat/internal-chat.realtime");
const internalChatService = require("../modules/internal-chat/internal-chat.service");
const internalChatPushService = require("../modules/internal-chat/internal-chat.push.service");
const { routeTaskReplyIfNeeded } = require("../modules/messaging/reply-routing.service");

function sanitizeUser(user) {
  return user
    ? {
        id: user.id,
        name: user.name || "",
        email: user.email,
      }
    : null;
}

function hasAttachment(value) {
  return Boolean(
    value
    && typeof value === "object"
    && (String(value.fileId || "").trim()
      || (String(value.originalName || "").trim() && String(value.contentBase64 || "").trim()))
  );
}

async function login(req, res) {
  try {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    const deviceName = String(req.body.deviceName || "").trim();
    const user = await usersService.authenticateUser({ email, password });
    if (!user) {
      return res.status(401).json({ ok: false, message: "Email o contraseña incorrectos." });
    }
    const created = await mobileAuthService.createSession({
      userId: user.id,
      deviceName,
    });
    return res.json({
      ok: true,
      token: created.token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function logout(req, res) {
  await mobileAuthService.revokeSession(req.mobileToken);
  return res.json({ ok: true });
}

async function getMe(req, res) {
  return res.json({
    ok: true,
    user: sanitizeUser(req.mobileUser),
    fcmConfigured: internalChatPushService.isConfigured(),
  });
}

async function listConversations(req, res) {
  const rows = await internalChatService.listConversationsForUser(req.mobileUser.id);
  return res.json({ ok: true, conversations: rows });
}

async function getConversationMessages(req, res) {
  const conversation = await internalChatService.getConversationByIdForUser(
    req.params.conversationId,
    req.mobileUser.id
  );
  if (!conversation) {
    return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
  }
  const messages = await internalChatService.listConversationMessages(conversation.id, req.mobileUser.id);
  const readResult = await internalChatService.markConversationReadDetailed(conversation.id, req.mobileUser.id);
  internalChatRealtime.emitReadReceipt(readResult);
  return res.json({
    ok: true,
    conversation,
    messages,
  });
}

async function sendConversationMessage(req, res) {
  try {
    const conversation = await internalChatService.getConversationByIdForUser(
      req.params.conversationId,
      req.mobileUser.id
    );
    if (!conversation) {
      return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
    }
    const text = String(req.body.text || "").trim();
    const attachment = req.body.attachment && typeof req.body.attachment === "object"
      ? req.body.attachment
      : null;
    if (!text && !hasAttachment(attachment)) {
      return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
    }

    let message = null;
    let pushTargets = [];
    let counterpartEmail = req.mobileUser.email || "";

    if (conversation.type === "group") {
      message = await internalChatService.sendMessage({
        senderUserId: req.mobileUser.id,
        groupId: conversation.groupId,
        text,
        attachment,
        status: "sent",
      });
      pushTargets = (message.participantUserIds || []).filter((id) => id !== req.mobileUser.id);
      counterpartEmail = conversation.name || counterpartEmail;
    } else {
      const recipientUserId = conversation.participantUserIds.find((id) => id !== req.mobileUser.id);
      message = await internalChatService.sendMessage({
        senderUserId: req.mobileUser.id,
        recipientUserId,
        text,
        attachment,
        status: "sent",
      });
      pushTargets = [recipientUserId];
    }

    for (const userId of pushTargets) {
      await internalChatPushService.sendPushToUser(userId, {
        title: req.mobileUser.email || "Nuevo mensaje interno",
        body: text || "Te envio una imagen.",
        conversationId: message.conversationId,
        counterpartEmail,
      });
    }

    await routeTaskReplyIfNeeded({
      channel: "internal_chat",
      sourceTarget: req.mobileUser.id,
      text: text || "[Imagen]",
      quotedMessageId: "",
      isGroup: conversation.type === "group",
      groupName: conversation.type === "group" ? (conversation.name || "") : "",
      authorName: req.mobileUser.name || req.mobileUser.email || req.mobileUser.id,
      authorTarget: req.mobileUser.id,
    });
    return res.status(201).json({ ok: true, message });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function markConversationRead(req, res) {
  const conversation = await internalChatService.getConversationByIdForUser(
    req.params.conversationId,
    req.mobileUser.id
  );
  if (!conversation) {
    return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
  }
  const result = await internalChatService.markConversationReadDetailed(conversation.id, req.mobileUser.id);
  internalChatRealtime.emitReadReceipt(result);
  return res.json({ ok: true, updatedCount: result.count });
}

async function deleteConversation(req, res) {
  try {
    const conversation = await internalChatService.getConversationByIdForUser(
      req.params.conversationId,
      req.mobileUser.id
    );
    if (!conversation) {
      return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
    }
    await internalChatService.clearConversationForUser(conversation.id, req.mobileUser.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteConversationMessage(req, res) {
  try {
    const conversation = await internalChatService.getConversationByIdForUser(
      req.params.conversationId,
      req.mobileUser.id
    );
    if (!conversation) {
      return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
    }
    const deletedCount = await internalChatService.deleteMessageForUser(
      conversation.id,
      req.params.messageId,
      req.mobileUser.id
    );
    return res.json({ ok: true, deletedCount });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function registerDevice(req, res) {
  try {
    const token = String(req.body.token || "").trim();
    const deviceName = String(req.body.deviceName || "").trim();
    const appVersion = String(req.body.appVersion || "").trim();
    const row = await mobileDeviceTokensService.registerToken({
      userId: req.mobileUser.id,
      token,
      deviceName,
      appVersion,
      platform: "android",
    });
    return res.status(201).json({ ok: true, device: row });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteDevice(req, res) {
  const deleted = await mobileDeviceTokensService.unregisterToken(req.params.token);
  return res.json({ ok: true, deleted });
}

module.exports = {
  login,
  logout,
  getMe,
  listConversations,
  getConversationMessages,
  sendConversationMessage,
  markConversationRead,
  deleteConversation,
  deleteConversationMessage,
  registerDevice,
  deleteDevice,
};
