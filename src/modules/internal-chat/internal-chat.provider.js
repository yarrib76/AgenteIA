const internalChatService = require("./internal-chat.service");
const messagingGateway = require("../messaging/messaging.gateway");
const usersService = require("../auth/users.service");
const internalChatPushService = require("./internal-chat.push.service");

function buildInternalChatProvider() {
  let io = null;

  function emitMessage(message) {
    if (!io) return;
    io.to(`internal-user:${message.senderUserId}`).emit("internal-chat-message", message);
    io.to(`internal-user:${message.recipientUserId}`).emit("internal-chat-message", message);
  }

  messagingGateway.setProvider("internal_chat", {
    sendMessage: async (target, text, options = {}) => {
      const recipient = await internalChatService.resolveUserTarget(target);
      const senderUserId = String(options.senderUserId || internalChatService.SYSTEM_USER_ID).trim();
      const message = await internalChatService.sendMessage({
        senderUserId,
        recipientUserId: recipient.id,
        text,
        status: "sent",
      });
      emitMessage(message);
      await internalChatPushService.sendPushToUser(recipient.id, {
        title: "Nuevo mensaje interno",
        body: text,
        conversationId: message.conversationId,
      });
      return {
        chatId: message.conversationId,
        contactKey: recipient.id,
        messageId: message.id,
      };
    },
    isReady: async () => true,
    resolveContactKeys: async (target) => {
      const recipient = await internalChatService.resolveUserTarget(target);
      return [recipient.id];
    },
    listGroups: async () => [],
    getPublicStatus: async () => {
      const users = await usersService.listUsers();
      return {
        linked: true,
        ready: true,
        statusText: "Chat interno disponible.",
        hasClient: true,
        usersCount: users.length,
      };
    },
    refreshLink: async () => true,
  });

  return {
    init: async () => true,
    stop: async () => true,
    attachIo: (nextIo) => {
      io = nextIo;
      if (!io) return;
      io.on("connection", (socket) => {
        socket.on("internal-chat-auth", (payload) => {
          const userId = String(payload && payload.userId || "").trim();
          if (!userId) return;
          socket.join(`internal-user:${userId}`);
        });
      });
    },
  };
}

module.exports = buildInternalChatProvider;
