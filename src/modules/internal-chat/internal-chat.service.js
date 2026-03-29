const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const usersService = require("../auth/users.service");
const internalChatGroupsService = require("./internal-chat-groups.service");

function normalizeText(value) {
  return String(value || "").trim();
}

const SYSTEM_USER_ID = "__system__";
const SYSTEM_USER_LABEL = "Sistema";

function buildConversationId(a, b) {
  const ids = [normalizeText(a), normalizeText(b)].filter(Boolean).sort();
  return ids.join("__");
}

function buildGroupConversationId(groupId) {
  return `group__${normalizeText(groupId)}`;
}

function normalizeIdList(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  return Array.from(new Set(source.map((item) => normalizeText(item)).filter(Boolean)));
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
  const participantUserIds = normalizeIdList(row && row.participantUserIds);
  const groupId = normalizeText(row && row.groupId);
  const type = normalizeText(row && row.type) || (groupId ? "group" : "direct");
  return {
    id: normalizeText(row && row.id),
    channel: "internal_chat",
    type: type === "group" ? "group" : "direct",
    groupId: type === "group" ? groupId : "",
    name: normalizeText(row && row.name),
    participantUserIds,
    createdAt: row && row.createdAt || new Date().toISOString(),
    updatedAt: row && row.updatedAt || new Date().toISOString(),
    lastMessageAt: row && row.lastMessageAt || null,
    lastMessageText: normalizeText(row && row.lastMessageText),
    clearedAtByUser: normalizeClearedAtByUser(row && row.clearedAtByUser),
  };
}

function normalizeMessage(row) {
  const recipientUserId = normalizeText(row && row.recipientUserId);
  const readByUserIds = Array.isArray(row && row.readByUserIds)
    ? normalizeIdList(row.readByUserIds)
    : (recipientUserId && row && row.readAt ? [recipientUserId] : []);
  return {
    id: normalizeText(row && row.id) || randomUUID(),
    conversationId: normalizeText(row && row.conversationId),
    channel: "internal_chat",
    conversationType: normalizeText(row && row.conversationType) || (normalizeText(row && row.groupId) ? "group" : "direct"),
    groupId: normalizeText(row && row.groupId),
    senderUserId: normalizeText(row && row.senderUserId),
    recipientUserId,
    text: normalizeText(row && row.text),
    direction: normalizeText(row && row.direction) || "out",
    status: normalizeText(row && row.status) || "sent",
    providerMessageId: normalizeText(row && row.providerMessageId),
    createdAt: row && row.createdAt || new Date().toISOString(),
    timestamp: row && row.timestamp || row && row.createdAt || new Date().toISOString(),
    readAt: row && row.readAt || null,
    readByUserIds,
    deletedForUserIds: Array.isArray(row && row.deletedForUserIds)
      ? normalizeIdList(row.deletedForUserIds)
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
  await internalConversations.saveAll(rows.map(normalizeConversation));
}

async function listMessages() {
  const { internalMessages } = getRepositories();
  const rows = await internalMessages.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeMessage);
}

async function saveMessages(rows) {
  const { internalMessages } = getRepositories();
  await internalMessages.saveAll(rows.map(normalizeMessage));
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

function isMessageUnreadForUser(message, userId) {
  const targetUserId = normalizeText(userId);
  if (!targetUserId) return false;
  if (message.senderUserId === targetUserId) return false;
  return !(message.readByUserIds || []).includes(targetUserId);
}

async function ensureDirectConversation(userAId, userBId) {
  const conversationId = buildConversationId(userAId, userBId);
  const conversations = await listConversations();
  const existing = conversations.find((row) => row.id === conversationId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const conversation = normalizeConversation({
    id: conversationId,
    type: "direct",
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

async function ensureGroupConversation(groupId) {
  const group = await internalChatGroupsService.getGroupById(groupId);
  if (!group) {
    throw new Error("Grupo interno no encontrado.");
  }
  const conversationId = buildGroupConversationId(group.id);
  const conversations = await listConversations();
  const existingIndex = conversations.findIndex((row) => row.id === conversationId);
  const now = new Date().toISOString();
  const nextConversation = normalizeConversation({
    ...(existingIndex >= 0 ? conversations[existingIndex] : {}),
    id: conversationId,
    type: "group",
    groupId: group.id,
    name: group.name,
    participantUserIds: group.memberUserIds,
    createdAt: existingIndex >= 0 ? conversations[existingIndex].createdAt : now,
    updatedAt: now,
  });
  if (existingIndex >= 0) {
    conversations[existingIndex] = nextConversation;
  } else {
    conversations.push(nextConversation);
  }
  await saveConversations(conversations);
  return nextConversation;
}

async function sendMessage({ senderUserId, recipientUserId, groupId, text, status = "sent" }) {
  const nextSender = normalizeText(senderUserId);
  const nextRecipient = normalizeText(recipientUserId);
  const nextGroupId = normalizeText(groupId);
  const nextText = normalizeText(text);
  if (!nextSender || !nextText) {
    throw new Error("Mensaje interno invalido.");
  }

  const now = new Date().toISOString();
  let conversation = null;
  let participantUserIds = [];
  let message = null;

  if (nextGroupId) {
    conversation = await ensureGroupConversation(nextGroupId);
    participantUserIds = normalizeIdList(conversation.participantUserIds);
    if (nextSender !== SYSTEM_USER_ID && !participantUserIds.includes(nextSender)) {
      throw new Error("El usuario no pertenece al grupo interno.");
    }
    message = normalizeMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      conversationType: "group",
      groupId: nextGroupId,
      senderUserId: nextSender,
      recipientUserId: "",
      text: nextText,
      status,
      createdAt: now,
      timestamp: now,
      readByUserIds: [],
      deletedForUserIds: [],
    });
  } else {
    if (!nextRecipient) {
      throw new Error("Mensaje interno invalido.");
    }
    conversation = await ensureDirectConversation(nextSender, nextRecipient);
    participantUserIds = normalizeIdList(conversation.participantUserIds);
    message = normalizeMessage({
      id: randomUUID(),
      conversationId: conversation.id,
      conversationType: "direct",
      senderUserId: nextSender,
      recipientUserId: nextRecipient,
      text: nextText,
      status,
      createdAt: now,
      timestamp: now,
      readByUserIds: [],
      deletedForUserIds: [],
    });
  }

  const messages = await listMessages();
  messages.push(message);
  await saveMessages(messages);

  const conversations = await listConversations();
  const updated = conversations.map((row) => {
    if (row.id !== conversation.id) return row;
    const nextClearedAtByUser = { ...(row.clearedAtByUser || {}) };
    participantUserIds.forEach((userId) => {
      if (nextClearedAtByUser[userId]) delete nextClearedAtByUser[userId];
    });
    return {
      ...row,
      type: conversation.type,
      groupId: conversation.groupId || "",
      name: conversation.name || "",
      participantUserIds,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageText: nextText,
      clearedAtByUser: nextClearedAtByUser,
    };
  });
  await saveConversations(updated);
  return {
    ...message,
    participantUserIds,
  };
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
  const [conversations, users, messages, groups] = await Promise.all([
    listConversations(),
    usersService.listUsers(),
    listMessages(),
    internalChatGroupsService.listGroups(),
  ]);
  return conversations
    .filter((row) => row.participantUserIds.includes(target))
    .map((row) => {
      const visibleMessages = messages
        .filter((msg) => msg.conversationId === row.id)
        .filter((msg) => isMessageVisibleForUser(msg, row, target))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const lastVisible = visibleMessages[visibleMessages.length - 1] || null;
      const unreadCount = visibleMessages.filter((msg) => isMessageUnreadForUser(msg, target)).length;

      if (row.type === "group") {
        const group = groups.find((item) => item.id === row.groupId) || null;
        return {
          ...row,
          counterpartUserId: row.groupId,
          counterpartEmail: group ? group.name : row.name || "Grupo interno",
          unreadCount,
          lastMessageAt: lastVisible ? lastVisible.timestamp : null,
          lastMessageText: lastVisible ? lastVisible.text : "",
        };
      }

      const counterpartUserId = row.participantUserIds.find((item) => item !== target) || "";
      const counterpart = users.find((user) => user.id === counterpartUserId) || null;
      return {
        ...row,
        counterpartUserId,
        counterpartEmail:
          counterpartUserId === SYSTEM_USER_ID
            ? SYSTEM_USER_LABEL
            : (counterpart ? counterpart.email : counterpartUserId),
        unreadCount,
        lastMessageAt: lastVisible ? lastVisible.timestamp : null,
        lastMessageText: lastVisible ? lastVisible.text : "",
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
    if (row.conversationId !== targetConversation) return row;
    if (!isMessageVisibleForUser(row, conversation, targetUserId)) return row;
    if (!isMessageUnreadForUser(row, targetUserId)) return row;
    const nextReadBy = normalizeIdList([...(row.readByUserIds || []), targetUserId]);
    changed += 1;
    return {
      ...row,
      readByUserIds: nextReadBy,
      readAt: row.conversationType === "direct" ? now : row.readAt,
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

async function resolveTarget(target) {
  const lookup = normalizeText(target);
  if (!lookup) throw new Error("Destino interno invalido.");
  if (lookup.toLowerCase().startsWith("group:")) {
    const groupId = lookup.slice(6).trim();
    const group = await internalChatGroupsService.getGroupById(groupId);
    if (!group) throw new Error("Grupo interno no encontrado.");
    return { type: "group", group };
  }
  const user = await resolveUserTarget(lookup);
  return { type: "user", user };
}

async function getConversationForUsers(userAId, userBId) {
  const conversationId = buildConversationId(userAId, userBId);
  const conversations = await listConversations();
  return conversations.find((row) => row.id === conversationId) || null;
}

async function getConversationForGroup(groupId) {
  const targetConversation = buildGroupConversationId(groupId);
  const conversations = await listConversations();
  return conversations.find((row) => row.id === targetConversation) || null;
}

async function getConversationByIdForUser(conversationId, userId) {
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
  buildGroupConversationId,
  sendMessage,
  listConversationMessages,
  listConversationsForUser,
  markConversationRead,
  clearConversation,
  clearConversationForUser,
  deleteMessageForUser,
  resolveUserTarget,
  resolveTarget,
  getConversationForUsers,
  getConversationForGroup,
  getConversationByIdForUser,
};
