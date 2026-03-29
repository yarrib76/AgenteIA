const usersService = require("../modules/auth/users.service");
const mobileAuthService = require("../modules/mobile/mobile-auth.service");
const mobileDeviceTokensService = require("../modules/mobile/mobile-device-tokens.service");
const internalChatService = require("../modules/internal-chat/internal-chat.service");
const internalChatPushService = require("../modules/internal-chat/internal-chat.push.service");

function sanitizeUser(user) {
  return user
    ? {
        id: user.id,
        email: user.email,
      }
    : null;
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
  const conversation = await internalChatService.getConversationForUsersByConversationId(
    req.params.conversationId,
    req.mobileUser.id
  );
  if (!conversation) {
    return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
  }
  const messages = await internalChatService.listConversationMessages(conversation.id);
  await internalChatService.markConversationRead(conversation.id, req.mobileUser.id);
  return res.json({
    ok: true,
    conversation,
    messages,
  });
}

async function sendConversationMessage(req, res) {
  try {
    const conversation = await internalChatService.getConversationForUsersByConversationId(
      req.params.conversationId,
      req.mobileUser.id
    );
    if (!conversation) {
      return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
    }
    const recipientUserId = conversation.participantUserIds.find((id) => id !== req.mobileUser.id);
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
    }
    const message = await internalChatService.sendMessage({
      senderUserId: req.mobileUser.id,
      recipientUserId,
      text,
      status: "sent",
    });
    await internalChatPushService.sendPushToUser(recipientUserId, {
      title: "Nuevo mensaje interno",
      body: text,
      conversationId: message.conversationId,
    });
    return res.status(201).json({ ok: true, message });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function markConversationRead(req, res) {
  const conversation = await internalChatService.getConversationForUsersByConversationId(
    req.params.conversationId,
    req.mobileUser.id
  );
  if (!conversation) {
    return res.status(404).json({ ok: false, message: "Conversacion no encontrada." });
  }
  const count = await internalChatService.markConversationRead(conversation.id, req.mobileUser.id);
  return res.json({ ok: true, updatedCount: count });
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
  registerDevice,
  deleteDevice,
};
