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

async function updateContact(contactId, { name, phone }) {
  const targetId = String(contactId || "").trim();
  if (!targetId) throw new Error("Contacto invalido.");

  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(phone);
  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (!normalizedPhone) throw new Error("El numero de WhatsApp es obligatorio.");

  const { contacts: contactsRepo, taskReplyRoutes: routesRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  const index = contacts.findIndex((c) => c.id === targetId);
  if (index < 0) throw new Error("Contacto no encontrado.");

  const oldPhone = normalizePhone(contacts[index].phone);
  const duplicate = contacts.some(
    (c) => c.id !== targetId && normalizePhone(c.phone) === normalizedPhone
  );
  if (duplicate) throw new Error("Ya existe otro contacto con ese numero.");

  const updated = {
    ...contacts[index],
    name: trimmedName,
    phone: normalizedPhone,
    updatedAt: new Date().toISOString(),
  };
  contacts[index] = updated;
  await contactsRepo.saveAll(contacts);

  // Mantener consistencia en rutas de respuesta de tareas.
  const routes = await routesRepo.list();
  let changedRoutes = false;
  const nextRoutes = (Array.isArray(routes) ? routes : []).map((route) => {
    if (!route) return route;
    let changed = false;
    const next = { ...route };
    if (String(next.destinationContactId || "") === targetId) {
      if (normalizePhone(next.destinationPhone) !== normalizedPhone) {
        next.destinationPhone = normalizedPhone;
        changed = true;
      }
    }
    if (oldPhone && normalizePhone(next.sourcePhone) === oldPhone && oldPhone !== normalizedPhone) {
      next.sourcePhone = normalizedPhone;
      changed = true;
    }
    if (changed) {
      next.updatedAt = new Date().toISOString();
      changedRoutes = true;
    }
    return next;
  });
  if (changedRoutes) {
    await routesRepo.saveAll(nextRoutes);
  }

  return updated;
}

async function deleteContact(contactId) {
  const targetId = String(contactId || "").trim();
  if (!targetId) throw new Error("Contacto invalido.");

  const {
    contacts: contactsRepo,
    tasks: tasksRepo,
    taskReplyRoutes: routesRepo,
  } = getRepositories();
  const [contacts, tasks, routes] = await Promise.all([
    contactsRepo.list(),
    tasksRepo.list(),
    routesRepo.list(),
  ]);
  const index = contacts.findIndex((c) => c.id === targetId);
  if (index < 0) throw new Error("Contacto no encontrado.");

  const inTasks = (tasks || []).some(
    (task) => String(task && task.responseContactId) === targetId
  );
  if (inTasks) {
    throw new Error("No se puede eliminar: el contacto esta asignado como respuesta en una tarea.");
  }

  const inRoutes = (routes || []).some(
    (row) => String(row && row.destinationContactId) === targetId
  );
  if (inRoutes) {
    throw new Error("No se puede eliminar: el contacto tiene ruteos de respuesta activos.");
  }

  const [removed] = contacts.splice(index, 1);
  await contactsRepo.saveAll(contacts);
  return removed;
}

module.exports = {
  listContacts,
  createContact,
  getContactById,
  updateContact,
  deleteContact,
  normalizePhone,
};
