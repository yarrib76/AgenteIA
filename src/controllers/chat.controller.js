const contactsService = require("../modules/agenda/contacts.service");
const messagesService = require("../modules/chat/messages.service");
const messagingGateway = require("../modules/messaging/messaging.gateway");
const usersService = require("../modules/auth/users.service");
const internalChatService = require("../modules/internal-chat/internal-chat.service");

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

async function renderChatPage(req, res) {
  const activeChannel = await messagingGateway.getChannel();
  if (activeChannel === "internal_chat") {
    const users = (await usersService.listUsers())
      .filter((user) => !req.currentUser || user.id !== req.currentUser.id)
      .map((user) => ({
        id: user.id,
        name: user.email,
        type: "user",
        targetLabel: user.email,
      }));
    const selectedContactId = req.query.contactId || (users[0] && users[0].id);
    const selectedUser = users.find((user) => user.id === selectedContactId) || null;
    const conversation = selectedUser && req.currentUser
      ? await internalChatService.getConversationForUsers(req.currentUser.id, selectedUser.id)
      : null;
    const messages = conversation
      ? await internalChatService.listConversationMessages(conversation.id)
      : [];
    const messagesWithFormattedTime = (messages || []).map((msg) => ({
      ...msg,
      direction: msg.senderUserId === req.currentUser.id ? "out" : "in",
      timestampFormatted: formatDateTime(msg.timestamp),
    }));

    return res.render("layouts/main", {
      pageTitle: "Chat - Panel Multi Agente IA",
      activeMenu: "chat",
      headerTitle: "Chat",
      moduleView: "chat",
      moduleData: {
        contacts: users,
        selectedContactId: selectedUser ? selectedUser.id : "",
        messages: messagesWithFormattedTime,
        channelReady: true,
        activeChannel,
        selectedContactConfigured: Boolean(selectedUser),
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
    const user = await usersService.getUserById(req.params.contactId);
    if (!user || user.id === req.currentUser.id) {
      return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
    }
    const conversation = await internalChatService.getConversationForUsers(req.currentUser.id, user.id);
    const messages = conversation
      ? await internalChatService.listConversationMessages(conversation.id)
      : [];
    await internalChatService.markConversationRead(
      conversation ? conversation.id : internalChatService.buildConversationId(req.currentUser.id, user.id),
      req.currentUser.id
    );
    return res.json({
      ok: true,
      contact: { id: user.id, name: user.email, type: "user" },
      messages: messages.map((msg) => ({
        ...msg,
        direction: msg.senderUserId === req.currentUser.id ? "out" : "in",
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
      const recipient = await usersService.getUserById(req.body.contactId);
      if (!recipient || recipient.id === req.currentUser.id) {
        return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
      }
      const text = String(req.body.message || "").trim();
      if (!text) {
        return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
      }
      const result = await messagingGateway.sendMessage(recipient.id, text, {
        channel: "internal_chat",
        senderUserId: req.currentUser.id,
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
      const user = await usersService.getUserById(req.params.contactId || req.body.contactId);
      if (!user || user.id === req.currentUser.id) {
        return res.status(404).json({ ok: false, message: "Usuario no encontrado." });
      }
      const conversationId = internalChatService.buildConversationId(req.currentUser.id, user.id);
      const deletedCount = await internalChatService.clearConversation(conversationId, req.currentUser.id);
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
