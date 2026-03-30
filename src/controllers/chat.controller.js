const contactsService = require("../modules/agenda/contacts.service");
const messagesService = require("../modules/chat/messages.service");
const messagingGateway = require("../modules/messaging/messaging.gateway");
const usersService = require("../modules/auth/users.service");
const internalChatService = require("../modules/internal-chat/internal-chat.service");
const internalChatGroupsService = require("../modules/internal-chat/internal-chat-groups.service");
const { SYSTEM_USER_ID } = require("../modules/internal-chat/internal-chat.service");

function formatDateTime(value, timeZone = "America/Argentina/Buenos_Aires") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function parseInternalTargetId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("group:")) {
    return { type: "group", id: raw.slice(6) };
  }
  if (raw.startsWith("user:")) {
    return { type: "user", id: raw.slice(5) };
  }
  return { type: "user", id: raw };
}

function resolveInternalActor(req) {
  const mode = String((req && (req.query.actor || (req.body && req.body.actor))) || "user").trim().toLowerCase();
  if (mode === "system") {
    return { mode: "system", userId: SYSTEM_USER_ID, label: "Sistema" };
  }
  return {
    mode: "user",
    userId: req && req.currentUser ? req.currentUser.id : "",
    label: req && req.currentUser ? (req.currentUser.name || req.currentUser.email) : "Usuario",
  };
}

async function buildInternalTargets(currentUserId, actorMode = "user") {
  const [users, groups] = await Promise.all([
    usersService.listUsers(),
    internalChatGroupsService.listGroups(),
  ]);
  const directTargets = (users || [])
    .filter((user) => actorMode === "system" || !currentUserId || user.id !== currentUserId)
    .map((user) => ({
      id: `user:${user.id}`,
      rawId: user.id,
      name: user.name || user.email,
      type: "user",
      targetLabel: user.email,
    }));
  const groupTargets = (groups || [])
    .filter((group) => actorMode === "system" || !currentUserId || (group.memberUserIds || []).includes(currentUserId))
    .map((group) => ({
      id: `group:${group.id}`,
      rawId: group.id,
      name: group.name,
      type: "group",
      targetLabel: group.name,
    }));
  return [...directTargets, ...groupTargets].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function renderChatPage(req, res) {
  const activeChannel = await messagingGateway.getChannel();
  if (activeChannel === "internal_chat") {
    const actor = resolveInternalActor(req);
    const contacts = await buildInternalTargets(req.currentUser && req.currentUser.id, actor.mode);
    const selectedContactId = req.query.contactId || (contacts[0] && contacts[0].id);
    const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null;
    const parsed = parseInternalTargetId(selectedContactId);
    let conversation = null;
    if (selectedContact && parsed) {
      conversation = parsed.type === "group"
        ? await internalChatService.getConversationForGroup(parsed.id)
        : await internalChatService.getConversationForUsers(actor.userId, parsed.id);
    }
    const messages = conversation
      ? await internalChatService.listConversationMessages(conversation.id, actor.userId)
      : [];
    const messagesWithFormattedTime = (messages || []).map((msg) => ({
      ...msg,
      direction: msg.senderUserId === actor.userId ? "out" : "in",
      timestampFormatted: formatDateTime(msg.timestamp),
      conversationType: msg.conversationType || (selectedContact && selectedContact.type === "group" ? "group" : "direct"),
      senderName: msg.senderName || "",
    }));

    return res.render("layouts/main", {
      pageTitle: "Chat - Panel Multi Agente IA",
      activeMenu: "chat",
      headerTitle: "Chat",
      moduleView: "chat",
      moduleData: {
        contacts,
        selectedContactId: selectedContact ? selectedContact.id : "",
        messages: messagesWithFormattedTime,
        channelReady: true,
        activeChannel,
        selectedContactConfigured: Boolean(selectedContact),
        internalActorMode: actor.mode,
        internalActorLabel: actor.label,
      },
      pageScripts: ["/js/chat.js"],
    });
  }
  const contacts = await contactsService.listContacts();
  const selectedContactId = req.query.contactId || (contacts[0] && contacts[0].id);
  const selectedContact =
    contacts.find((contact) => contact.id === selectedContactId) || null;
  const selectedTarget = selectedContact
    ? contactsService.getContactMessageTarget(selectedContact, activeChannel)
    : "";
  const contactKeys = selectedContact && selectedTarget
    ? await messagingGateway.resolveContactKeys(selectedTarget, { channel: activeChannel })
    : [];
  const messages = selectedContact && selectedTarget
    ? await messagesService.listMessagesByPhones(contactKeys, 40, { channel: activeChannel })
    : [];
  const messagesWithFormattedTime = (messages || []).map((msg) => ({
    ...msg,
    timestampFormatted: formatDateTime(msg.timestamp),
  }));

  res.render("layouts/main", {
    pageTitle: "Chat - Panel Multi Agente IA",
    activeMenu: "chat",
    headerTitle: "Chat",
    moduleView: "chat",
    moduleData: {
      contacts,
      selectedContactId: selectedContact ? selectedContact.id : "",
      messages: messagesWithFormattedTime,
      channelReady: await messagingGateway.isReady({ channel: activeChannel }),
      activeChannel,
      selectedContactConfigured:
        !selectedContact || contactsService.hasTargetForChannel(selectedContact, activeChannel),
    },
    pageScripts: ["/js/chat.js"],
  });
}

async function getConversation(req, res) {
  const activeChannel = await messagingGateway.getChannel();
  if (activeChannel === "internal_chat") {
    if (!req.currentUser) {
      return res.status(401).json({ ok: false, message: "Sesion invalida." });
    }
    const actor = resolveInternalActor(req);
    const parsed = parseInternalTargetId(req.params.contactId);
    if (!parsed) {
      return res.status(404).json({ ok: false, message: "Destino no encontrado." });
    }

    if (parsed.type === "group") {
      const group = await internalChatGroupsService.getGroupById(parsed.id);
      if (!group || (actor.mode !== "system" && !(group.memberUserIds || []).includes(req.currentUser.id))) {
        return res.status(404).json({ ok: false, message: "Grupo no encontrado." });
      }
      const conversation = await internalChatService.getConversationForGroup(group.id);
      const conversationId = conversation ? conversation.id : internalChatService.buildGroupConversationId(group.id);
      const messages = conversation
        ? await internalChatService.listConversationMessages(conversation.id, actor.userId)
        : [];
      await internalChatService.markConversationRead(conversationId, actor.userId);
      return res.json({
        ok: true,
        contact: { id: `group:${group.id}`, name: group.name, type: "group" },
        messages: messages.map((msg) => ({
          ...msg,
          direction: msg.senderUserId === actor.userId ? "out" : "in",
          conversationType: msg.conversationType || "group",
          senderName: msg.senderName || "",
        })),
        activeChannel,
        configured: true,
      });
    }

    const user = await usersService.getUserById(parsed.id);
    if (!user || (actor.mode !== "system" && user.id === req.currentUser.id)) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
    }
    const conversation = await internalChatService.getConversationForUsers(actor.userId, user.id);
    const messages = conversation
      ? await internalChatService.listConversationMessages(conversation.id, actor.userId)
      : [];
    await internalChatService.markConversationRead(
      conversation ? conversation.id : internalChatService.buildConversationId(actor.userId, user.id),
      actor.userId
    );
    return res.json({
      ok: true,
      contact: { id: `user:${user.id}`, name: user.name || user.email, type: "user" },
      messages: messages.map((msg) => ({
        ...msg,
        direction: msg.senderUserId === req.currentUser.id ? "out" : "in",
        conversationType: msg.conversationType || "direct",
        senderName: msg.senderName || "",
      })),
      activeChannel,
      configured: true,
    });
  }
  const { contactId } = req.params;
  const contact = await contactsService.getContactById(contactId);
  if (!contact) {
    return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
  }

  const target = contactsService.getContactMessageTarget(contact, activeChannel);
  if (!target) {
    return res.json({
      ok: true,
      contact,
      messages: [],
      activeChannel,
      configured: false,
    });
  }
  const contactKeys = await messagingGateway.resolveContactKeys(target, { channel: activeChannel });
  const messages = await messagesService.listMessagesByPhones(contactKeys, 40, { channel: activeChannel });
  return res.json({ ok: true, contact, messages, activeChannel, configured: true });
}

async function sendMessage(req, res) {
  try {
    const activeChannel = await messagingGateway.getChannel();
    if (activeChannel === "internal_chat") {
      if (!req.currentUser) {
        return res.status(401).json({ ok: false, message: "Sesion invalida." });
      }
      const actor = resolveInternalActor(req);
      const parsed = parseInternalTargetId(req.body.contactId);
      if (!parsed) {
        return res.status(404).json({ ok: false, message: "Destino no encontrado." });
      }
      const text = String(req.body.message || "").trim();
      if (!text) {
        return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
      }
      if (parsed.type === "group") {
        const group = await internalChatGroupsService.getGroupById(parsed.id);
        if (!group || (actor.mode !== "system" && !(group.memberUserIds || []).includes(req.currentUser.id))) {
          return res.status(404).json({ ok: false, message: "Grupo no encontrado." });
        }
        const result = await messagingGateway.sendMessage(`group:${group.id}`, text, {
          channel: "internal_chat",
          senderUserId: actor.userId,
        });
        return res.status(201).json({
          ok: true,
          message: {
            id: result.messageId,
            direction: "out",
            text,
            timestamp: new Date().toISOString(),
          },
          activeChannel,
        });
      }
      const recipient = await usersService.getUserById(parsed.id);
      if (!recipient || (actor.mode !== "system" && recipient.id === req.currentUser.id)) {
        return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
      }
      const result = await messagingGateway.sendMessage(recipient.id, text, {
        channel: "internal_chat",
        senderUserId: actor.userId,
      });
      return res.status(201).json({
        ok: true,
        message: {
          id: result.messageId,
          direction: "out",
          text,
          timestamp: new Date().toISOString(),
        },
        activeChannel,
      });
    }
    const { contactId, message } = req.body;
    const contact = await contactsService.getContactById(contactId);
    if (!contact) {
      return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
    }

    const text = String(message || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
    }

    const target = contactsService.getContactMessageTarget(contact, activeChannel);
    if (!target) {
      return res.status(400).json({ ok: false, message: "El contacto no esta configurado para este canal." });
    }
    const result = await messagingGateway.sendMessage(target, text, { channel: activeChannel });
    const saved = await messagesService.addMessage({
      channel: activeChannel,
      contactPhone: (result && result.contactKey) || target,
      direction: "out",
      text,
      status: "sent",
      providerMessageId: result && result.messageId ? result.messageId : "",
    });

    return res.status(201).json({ ok: true, message: saved, activeChannel });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function clearConversation(req, res) {
  try {
    const activeChannel = await messagingGateway.getChannel();
    if (activeChannel === "internal_chat") {
      if (!req.currentUser) {
        return res.status(401).json({ ok: false, message: "Sesion invalida." });
      }
      const actor = resolveInternalActor(req);
      const parsed = parseInternalTargetId(req.params.contactId || req.body.contactId);
      if (!parsed) {
        return res.status(404).json({ ok: false, message: "Destino no encontrado." });
      }
      let conversationId = "";
      if (parsed.type === "group") {
        const group = await internalChatGroupsService.getGroupById(parsed.id);
        if (!group || (actor.mode !== "system" && !(group.memberUserIds || []).includes(req.currentUser.id))) {
          return res.status(404).json({ ok: false, message: "Grupo no encontrado." });
        }
        conversationId = internalChatService.buildGroupConversationId(group.id);
      } else {
        const user = await usersService.getUserById(parsed.id);
        if (!user || (actor.mode !== "system" && user.id === req.currentUser.id)) {
          return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
        }
        conversationId = internalChatService.buildConversationId(actor.userId, user.id);
      }
      const deletedCount = await internalChatService.clearConversation(conversationId, actor.userId);
      return res.json({ ok: true, deletedCount, activeChannel });
    }
    const contactId = req.params.contactId || req.body.contactId;
    const contact = await contactsService.getContactById(contactId);
    if (!contact) {
      return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
    }

    const target = contactsService.getContactMessageTarget(contact, activeChannel);
    if (!target) {
      return res.json({ ok: true, deletedCount: 0, activeChannel });
    }
    const contactKeys = await messagingGateway.resolveContactKeys(target, { channel: activeChannel });
    const deletedCount = await messagesService.deleteMessagesByPhones(contactKeys, { channel: activeChannel });
    return res.json({ ok: true, deletedCount, activeChannel });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderChatPage,
  getConversation,
  sendMessage,
  clearConversation,
};
