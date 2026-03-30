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
      conversationType: message.conversationType || "direct",
      groupId: message.groupId || "",
      senderUserId: message.senderUserId,
      senderName: message.senderName || "",
      recipientUserId: message.recipientUserId,
      text: message.text,
      attachment: message.attachment || null,
      timestamp: message.timestamp,
      readAt: message.readAt || null,
    };
    const recipients = Array.isArray(message.participantUserIds) && message.participantUserIds.length > 0
      ? message.participantUserIds
      : [message.senderUserId, message.recipientUserId].filter(Boolean);
    Array.from(new Set(recipients)).forEach((userId) => {
      io.to(`internal-user:${userId}`).emit("internal-chat-message", payload);
    });
  }

  messagingGateway.setProvider("internal_chat", {
    sendMessage: async (target, text, options = {}) => {
      const senderUserId = String(options.senderUserId || internalChatService.SYSTEM_USER_ID).trim();
      const resolved = await internalChatService.resolveTarget(target);
      let message = null;
      let pushTargets = [];
      let counterpartEmail = internalChatService.SYSTEM_USER_LABEL;

      if (resolved.type === "group") {
        message = await internalChatService.sendMessage({
          senderUserId,
          groupId: resolved.group.id,
          text,
          attachment: options.attachment || null,
          status: "sent",
        });
        pushTargets = (message.participantUserIds || []).filter((userId) => userId && userId !== senderUserId);
        counterpartEmail = resolved.group.name;
      } else {
        message = await internalChatService.sendMessage({
          senderUserId,
          recipientUserId: resolved.user.id,
          text,
          attachment: options.attachment || null,
          status: "sent",
        });
        pushTargets = [resolved.user.id];
        counterpartEmail = senderUserId === internalChatService.SYSTEM_USER_ID
          ? internalChatService.SYSTEM_USER_LABEL
          : (await usersService.getUserById(senderUserId))?.email || internalChatService.SYSTEM_USER_LABEL;
      }

      emitMessage(message);
      for (const userId of pushTargets) {
        await internalChatPushService.sendPushToUser(userId, {
          title: senderUserId === internalChatService.SYSTEM_USER_ID ? "Robot IA" : "Nuevo mensaje interno",
          body: String(text || "").trim() || "Te envio una imagen.",
          conversationId: message.conversationId,
          counterpartEmail,
        });
      }
      return {
        chatId: message.conversationId,
        contactKey: resolved.type === "group" ? `group:${resolved.group.id}` : resolved.user.id,
        messageId: message.id,
        message,
      };
    },
    isReady: async () => true,
    resolveContactKeys: async (target) => {
      const resolved = await internalChatService.resolveTarget(target);
      return [resolved.type === "group" ? `group:${resolved.group.id}` : resolved.user.id];
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
