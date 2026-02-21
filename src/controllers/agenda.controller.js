const contactsService = require("../modules/agenda/contacts.service");

async function renderAgendaPage(req, res) {
  const contacts = await contactsService.listContacts();
  res.render("layouts/main", {
    pageTitle: "Agenda - Panel Multi Agente IA",
    activeMenu: "agenda",
    headerTitle: "Agenda",
    moduleView: "agenda",
    moduleData: { contacts },
    pageScripts: ["/js/agenda.js"],
  });
}

async function listContacts(req, res) {
  const contacts = await contactsService.listContacts();
  res.json({ ok: true, contacts });
}

async function createContact(req, res) {
  try {
    const contact = await contactsService.createContact(req.body);
    res.status(201).json({ ok: true, contact });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateContact(req, res) {
  try {
    const contact = await contactsService.updateContact(req.params.contactId, req.body);
    res.json({ ok: true, contact });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteContact(req, res) {
  try {
    const contact = await contactsService.deleteContact(req.params.contactId);
    res.json({ ok: true, contact });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderAgendaPage,
  listContacts,
  createContact,
  updateContact,
  deleteContact,
};
