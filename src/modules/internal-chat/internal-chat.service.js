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
  });
  messages.push(message);
  await saveMessages(messages);

  const conversations = await listConversations();
  const updated = conversations.map((row) =>
    row.id === conversation.id
      ? {
          ...row,
          updatedAt: now,
          lastMessageAt: now,
          lastMessageText: nextText,
        }
      : row
  );
  await saveConversations(updated);
  return message;
}

async function listConversationMessages(conversationId) {
  const target = normalizeText(conversationId);
  const messages = await listMessages();
  return messages
    .filter((row) => row.conversationId === target)
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
      const unreadCount = messages.filter(
        (msg) => msg.conversationId === row.id && msg.recipientUserId === target && !msg.readAt
      ).length;
      return {
        ...row,
        counterpartUserId,
        counterpartEmail:
          counterpartUserId === SYSTEM_USER_ID
            ? SYSTEM_USER_LABEL
            : (counterpart ? counterpart.email : counterpartUserId),
        unreadCount,
      };
    })
    .sort((a, b) => new Date(b.lastMessageAt || b.updatedAt) - new Date(a.lastMessageAt || a.updatedAt));
}

async function markConversationRead(conversationId, userId) {
  const targetConversation = normalizeText(conversationId);
  const targetUserId = normalizeText(userId);
  const messages = await listMessages();
  const now = new Date().toISOString();
  let changed = 0;
  const updated = messages.map((row) => {
    if (row.conversationId !== targetConversation || row.recipientUserId !== targetUserId || row.readAt) {
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

async function clearConversation(conversationId, userId) {
  const targetConversation = normalizeText(conversationId);
  const currentUserId = normalizeText(userId);
  const conversation = await getConversationForUsersByConversationId(targetConversation, currentUserId);
  if (!conversation) return 0;
  const messages = await listMessages();
  const kept = messages.filter((row) => row.conversationId !== targetConversation);
  const deleted = messages.length - kept.length;
  if (deleted > 0) {
    await saveMessages(kept);
  }
  const conversations = await listConversations();
  const nextConversations = conversations.map((row) =>
    row.id === targetConversation
      ? {
          ...row,
          lastMessageAt: null,
          lastMessageText: "",
          updatedAt: new Date().toISOString(),
        }
      : row
  );
  await saveConversations(nextConversations);
  return deleted;
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
  resolveUserTarget,
  getConversationForUsers,
  getConversationForUsersByConversationId,
};
