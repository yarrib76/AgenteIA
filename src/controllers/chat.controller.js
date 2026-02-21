const contactsService = require("../modules/agenda/contacts.service");
const messagesService = require("../modules/chat/messages.service");
const whatsappGateway = require("../modules/whatsapp/whatsapp.gateway");

async function renderChatPage(req, res) {
  const contacts = await contactsService.listContacts();
  const selectedContactId = req.query.contactId || (contacts[0] && contacts[0].id);
  const selectedContact =
    contacts.find((contact) => contact.id === selectedContactId) || null;
  const selectedTarget = selectedContact
    ? contactsService.getContactMessageTarget(selectedContact)
    : "";
  const contactKeys = selectedContact
    ? await whatsappGateway.resolveContactKeys(selectedTarget)
    : [];
  const messages = selectedContact
    ? await messagesService.listMessagesByPhones(contactKeys, 40)
    : [];

  res.render("layouts/main", {
    pageTitle: "Chat - Panel Multi Agente IA",
    activeMenu: "chat",
    headerTitle: "Chat",
    moduleView: "chat",
    moduleData: {
      contacts,
      selectedContactId: selectedContact ? selectedContact.id : "",
      messages,
      whatsappReady: whatsappGateway.isReady(),
    },
    pageScripts: ["/js/chat.js"],
  });
}

async function getConversation(req, res) {
  const { contactId } = req.params;
  const contact = await contactsService.getContactById(contactId);
  if (!contact) {
    return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
  }

  const target = contactsService.getContactMessageTarget(contact);
  const contactKeys = await whatsappGateway.resolveContactKeys(target);
  const messages = await messagesService.listMessagesByPhones(contactKeys, 40);
  return res.json({ ok: true, contact, messages });
}

async function sendMessage(req, res) {
  try {
    const { contactId, message } = req.body;
    const contact = await contactsService.getContactById(contactId);
    if (!contact) {
      return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
    }

    const text = String(message || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, message: "Escribe un mensaje." });
    }

    const target = contactsService.getContactMessageTarget(contact);
    const result = await whatsappGateway.sendMessage(target, text);
    const saved = await messagesService.addMessage({
      contactPhone: (result && result.contactKey) || target,
      direction: "out",
      text,
      status: "sent",
    });

    return res.status(201).json({ ok: true, message: saved });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function clearConversation(req, res) {
  try {
    const contactId = req.params.contactId || req.body.contactId;
    const contact = await contactsService.getContactById(contactId);
    if (!contact) {
      return res.status(404).json({ ok: false, message: "Contacto no encontrado." });
    }

    const target = contactsService.getContactMessageTarget(contact);
    const contactKeys = await whatsappGateway.resolveContactKeys(target);
    const deletedCount = await messagesService.deleteMessagesByPhones(contactKeys);
    return res.json({ ok: true, deletedCount });
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
