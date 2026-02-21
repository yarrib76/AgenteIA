const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

async function listContacts() {
  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  return contacts.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createContact({ name, phone }) {
  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(phone);

  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (!normalizedPhone) throw new Error("El numero de WhatsApp es obligatorio.");

  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  const exists = contacts.some((c) => c.phone === normalizedPhone);
  if (exists) throw new Error("Ya existe un contacto con ese numero.");

  const contact = {
    id: randomUUID(),
    name: trimmedName,
    phone: normalizedPhone,
    createdAt: new Date().toISOString(),
  };

  await contactsRepo.insert(contact);
  return contact;
}

async function getContactById(id) {
  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  return contacts.find((c) => c.id === id) || null;
}

module.exports = {
  listContacts,
  createContact,
  getContactById,
  normalizePhone,
};
