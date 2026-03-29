const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const usersService = require("../auth/users.service");

function normalizeText(value) {
  return String(value || "").trim();
}

const SYSTEM_USER_ID = "__system__";
const SYSTEM_USER_LABEL = "Sistema";

function buildConversationId(a, b) {
  const ids = [normalizeText(a), normalizeText(b)].filter(Boolean).sort();
  return ids.join("__");
}

function normalizeClearedAtByUser(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source).reduce((acc, [key, item]) => {
    const nextKey = normalizeText(key);
    const nextValue = normalizeText(item);
    if (nextKey && nextValue) acc[nextKey] = nextValue;
    return acc;
  }, {});
}

function normalizeConversation(row) {
  return {
    id: normalizeText(row && row.id),
    channel: "internal_chat",
    participantUserIds: Array.isArray(row && row.participantUserIds)
      ? row.participantUserIds.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    createdAt: row && row.createdAt || new Date().toISOString(),
    updatedAt: row && row.updatedAt || new Date().toISOString(),
    lastMessageAt: row && row.lastMessageAt || null,
    lastMessageText: normalizeText(row && row.lastMessageText),
    clearedAtByUser: normalizeClearedAtByUser(row && row.clearedAtByUser),
  };
}

function normalizeMessage(row) {
  return {
    id: normalizeText(row && row.id) || randomUUID(),
    conversationId: normalizeText(row && row.conversationId),
    channel: "internal_chat",
    senderUserId: normalizeText(row && row.senderUserId),
    recipientUserId: normalizeText(row && row.recipientUserId),
    text: normalizeText(row && row.text),
    direction: normalizeText(row && row.direction) || "out",
    status: normalizeText(row && row.status) || "sent",
    providerMessageId: normalizeText(row && row.providerMessageId),
    createdAt: row && row.createdAt || new Date().toISOString(),
    timestamp: row && row.timestamp || row && row.createdAt || new Date().toISOString(),
    readAt: row && row.readAt || null,
    deletedForUserIds: Array.isArray(row && row.deletedForUserIds)
      ? row.deletedForUserIds.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  };
}

async function listConversations() {
  const { internalConversations } = getRepositories();
  const rows = await internalConversations.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeConversation);
}

async function saveConversations(rows) {
  const { internalConversations } = getRepositories();
  await internalConversations.saveAll(rows);
}

async function listMessages() {
  const { internalMessages } = getRepositories();
  const rows = await internalMessages.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeMessage);
}

async function saveMessages(rows) {
  const { internalMessages } = getRepositories();
  await internalMessages.saveAll(rows);
}

function isMessageVisibleForUser(message, conversation, userId) {
  const targetUserId = normalizeText(userId);
  if (!targetUserId) return true;
  if ((message.deletedForUserIds || []).includes(targetUserId)) return false;
  const clearedAt = conversation && conversation.clearedAtByUser
    ? conversation.clearedAtByUser[targetUserId]
    : "";
  if (!clearedAt) return true;
  return new Date(message.timestamp).getTime() > new Date(clearedAt).getTime();
}

async function ensureConversation(userAId, userBId) {
  const conversationId = buildConversationId(userAId, userBId);
  const conversations = await listConversations();
  const existing = conversations.find((row) => row.id === conversationId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const conversation = normalizeConversation({
    id: conversationId,
    participantUserIds: [userAId, userBId],
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastMessageText: "",
    clearedAtByUser: {},
  });
  conversations.push(conversation);
  await saveConversations(conversations);
  return conversation;
}

async function sendMessage({ senderUserId, recipientUserId, text, status = "sent" }) {
  const nextSender = normalizeText(senderUserId);
  const nextRecipient = normalizeText(recipientUserId);
  const nextText = normalizeText(text);
  if (!nextSender || !nextRecipient || !nextText) {
    throw new Error("Mensaje interno invalido.");
  }
  const conversation = await ensureConversation(nextSender, nextRecipient);
  const messages = await listMessages();
  const now = new Date().toISOString();
  const message = normalizeMessage({
    id: randomUUID(),
    conversationId: conversation.id,
    senderUserId: nextSender,
    recipientUserId: nextRecipient,
    text: nextText,
    status,
    createdAt: now,
    timestamp: now,
    deletedForUserIds: [],
  });
  messages.push(message);
  await saveMessages(messages);

  const conversations = await listConversations();
  const updated = conversations.map((row) => {
    if (row.id !== conversation.id) return row;
    const nextClearedAtByUser = { ...(row.clearedAtByUser || {}) };
    if (nextClearedAtByUser[nextSender]) delete nextClearedAtByUser[nextSender];
    if (nextClearedAtByUser[nextRecipient]) delete nextClearedAtByUser[nextRecipient];
    return {
      ...row,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageText: nextText,
      clearedAtByUser: nextClearedAtByUser,
    };
  });
  await saveConversations(updated);
  return message;
}

async function listConversationMessages(conversationId, userId = "") {
  const target = normalizeText(conversationId);
  const targetUserId = normalizeText(userId);
  const [messages, conversations] = await Promise.all([listMessages(), listConversations()]);
  const conversation = conversations.find((row) => row.id === target) || null;
  return messages
    .filter((row) => row.conversationId === target)
    .filter((row) => isMessageVisibleForUser(row, conversation, targetUserId))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function listConversationsForUser(userId) {
  const target = normalizeText(userId);
  const [conversations, users, messages] = await Promise.all([
    listConversations(),
    usersService.listUsers(),
    listMessages(),
  ]);
  return conversations
    .filter((row) => row.participantUserIds.includes(target))
    .map((row) => {
      const counterpartUserId = row.participantUserIds.find((item) => item !== target) || "";
      const counterpart = users.find((user) => user.id === counterpartUserId) || null;
      const visibleMessages = messages
        .filter((msg) => msg.conversationId === row.id)
        .filter((msg) => isMessageVisibleForUser(msg, row, target))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const lastVisible = visibleMessages[visibleMessages.length - 1] || null;
      const unreadCount = visibleMessages.filter(
        (msg) => msg.recipientUserId === target && !msg.readAt
      ).length;
      return {
        ...row,
        counterpartUserId,
        counterpartEmail:
          counterpartUserId === SYSTEM_USER_ID
            ? SYSTEM_USER_LABEL
            : (counterpart ? counterpart.email : counterpartUserId),
        lastMessageAt: lastVisible ? lastVisible.timestamp : null,
        lastMessageText: lastVisible ? lastVisible.text : "",
        unreadCount,
      };
    })
    .sort((a, b) => new Date(b.lastMessageAt || b.updatedAt) - new Date(a.lastMessageAt || a.updatedAt));
}

async function markConversationRead(conversationId, userId) {
  const targetConversation = normalizeText(conversationId);
  const targetUserId = normalizeText(userId);
  const [messages, conversations] = await Promise.all([listMessages(), listConversations()]);
  const conversation = conversations.find((row) => row.id === targetConversation) || null;
  const now = new Date().toISOString();
  let changed = 0;
  const updated = messages.map((row) => {
    if (row.conversationId !== targetConversation || row.recipientUserId !== targetUserId || row.readAt) {
      return row;
    }
    if (!isMessageVisibleForUser(row, conversation, targetUserId)) {
      return row;
    }
    changed += 1;
    return {
      ...row,
      readAt: now,
    };
  });
  if (changed > 0) {
    await saveMessages(updated);
  }
  return changed;
}

async function clearConversationForUser(conversationId, userId) {
  const targetConversation = normalizeText(conversationId);
  const currentUserId = normalizeText(userId);
  const conversations = await listConversations();
  const index = conversations.findIndex(
    (row) => row.id === targetConversation && row.participantUserIds.includes(currentUserId)
  );
  if (index < 0) return 0;
  const now = new Date().toISOString();
  conversations[index] = {
    ...conversations[index],
    updatedAt: now,
    clearedAtByUser: {
      ...(conversations[index].clearedAtByUser || {}),
      [currentUserId]: now,
    },
  };
  await saveConversations(conversations);
  return 1;
}

async function deleteMessageForUser(conversationId, messageId, userId) {
  const targetConversation = normalizeText(conversationId);
  const targetMessageId = normalizeText(messageId);
  const currentUserId = normalizeText(userId);
  const [conversations, messages] = await Promise.all([listConversations(), listMessages()]);
  const conversation = conversations.find(
    (row) => row.id === targetConversation && row.participantUserIds.includes(currentUserId)
  );
  if (!conversation) throw new Error("Conversacion no encontrada.");
  let deleted = 0;
  const updated = messages.map((row) => {
    if (row.id !== targetMessageId || row.conversationId !== targetConversation) return row;
    const deletedForUserIds = Array.isArray(row.deletedForUserIds) ? row.deletedForUserIds.slice() : [];
    if (!deletedForUserIds.includes(currentUserId)) {
      deletedForUserIds.push(currentUserId);
      deleted += 1;
    }
    return {
      ...row,
      deletedForUserIds,
    };
  });
  if (deleted > 0) {
    await saveMessages(updated);
  }
  return deleted;
}

async function clearConversation(conversationId, userId) {
  return clearConversationForUser(conversationId, userId);
}

async function resolveUserTarget(target) {
  const lookup = normalizeText(target);
  if (!lookup) throw new Error("Usuario interno invalido.");
  const users = await usersService.listUsers();
  const byId = users.find((user) => user.id === lookup);
  if (byId) return byId;
  const byEmail = users.find((user) => String(user.email || "").trim().toLowerCase() === lookup.toLowerCase());
  if (byEmail) return byEmail;
  const byPartial = users.find((user) => String(user.email || "").toLowerCase().includes(lookup.toLowerCase()));
  if (byPartial) return byPartial;
  throw new Error(`No se encontro usuario interno: ${lookup}`);
}

async function getConversationForUsers(userAId, userBId) {
  const conversationId = buildConversationId(userAId, userBId);
  const conversations = await listConversations();
  return conversations.find((row) => row.id === conversationId) || null;
}

async function getConversationForUsersByConversationId(conversationId, userId) {
  const targetConversation = normalizeText(conversationId);
  const currentUserId = normalizeText(userId);
  const conversations = await listConversations();
  return conversations.find(
    (row) => row.id === targetConversation && row.participantUserIds.includes(currentUserId)
  ) || null;
}

module.exports = {
  SYSTEM_USER_ID,
  SYSTEM_USER_LABEL,
  buildConversationId,
  sendMessage,
  listConversationMessages,
  listConversationsForUser,
  markConversationRead,
  clearConversation,
  clearConversationForUser,
  deleteMessageForUser,
  resolveUserTarget,
  getConversationForUsers,
  getConversationForUsersByConversationId,
};
