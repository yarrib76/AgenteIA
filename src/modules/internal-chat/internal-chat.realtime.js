let io = null;

function normalizeUserIds(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((item) => String(item || "").trim()).filter(Boolean)));
}

function attachIo(nextIo) {
  io = nextIo || null;
}

function emitToUsers(eventName, payload, userIds) {
  if (!io) return;
  normalizeUserIds(userIds).forEach((userId) => {
    io.to(`internal-user:${userId}`).emit(eventName, payload);
  });
}

function emitMessage(message) {
  if (!message) return;
  emitToUsers("internal-chat-message", {
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
  }, Array.isArray(message.participantUserIds) && message.participantUserIds.length > 0
    ? message.participantUserIds
    : [message.senderUserId, message.recipientUserId]);
}

function emitReadReceipt(result) {
  if (
    !result
    || result.conversationType !== "direct"
    || !result.count
    || !result.readAt
    || !Array.isArray(result.messageIds)
    || result.messageIds.length === 0
  ) {
    return;
  }
  emitToUsers("internal-chat-read", {
    conversationId: result.conversationId,
    messageIds: result.messageIds,
    readAt: result.readAt,
    readerUserId: result.readerUserId || "",
  }, result.participantUserIds || []);
}

module.exports = {
  attachIo,
  emitMessage,
  emitReadReceipt,
};
