const contactsService = require("../modules/agenda/contacts.service");
const messagesService = require("../modules/chat/messages.service");
const messagingGateway = require("../modules/messaging/messaging.gateway");

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
