const internalChatService = require("./internal-chat.service");
const internalChatGroupsService = require("./internal-chat-groups.service");
const messagingGateway = require("../messaging/messaging.gateway");
const usersService = require("../auth/users.service");
const internalChatPushService = require("./internal-chat.push.service");

function buildInternalChatProvider() {
  let io = null;

  function emitMessage(message) {
    if (!io) return;
    const payload = {
      messageId: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      recipientUserId: message.recipientUserId,
      text: message.text,
      timestamp: message.timestamp,
      readAt: message.readAt || null,
    };
    io.to(`internal-user:${message.senderUserId}`).emit("internal-chat-message", payload);
    io.to(`internal-user:${message.recipientUserId}`).emit("internal-chat-message", payload);
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
        title: senderUserId === internalChatService.SYSTEM_USER_ID ? "Robot IA" : "Nuevo mensaje interno",
        body: text,
        conversationId: message.conversationId,
        counterpartEmail: senderUserId === internalChatService.SYSTEM_USER_ID
          ? internalChatService.SYSTEM_USER_LABEL
          : (await usersService.getUserById(senderUserId))?.email || internalChatService.SYSTEM_USER_LABEL,
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
    listGroups: async () => {
      const groups = await internalChatGroupsService.listGroups();
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        membersCount: group.membersCount,
      }));
    },
    getPublicStatus: async () => {
      const [users, groups] = await Promise.all([
        usersService.listUsers(),
        internalChatGroupsService.listGroups(),
      ]);
      return {
        linked: true,
        ready: true,
        statusText: "Chat interno disponible.",
        hasClient: true,
        usersCount: users.length,
        groupsCount: groups.length,
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
