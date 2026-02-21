const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function normalizeGroupId(groupId) {
  const raw = String(groupId || "").trim().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.endsWith("@g.us")) return raw;
  if (/^\d[\d\-_.:]+$/.test(raw)) return `${raw}@g.us`;
  return "";
}

function normalizeContactType(type) {
  const value = String(type || "").trim().toLowerCase();
  return value === "group" ? "group" : "contact";
}

function toNormalizedContact(contact) {
  const type = normalizeContactType(contact && contact.type);
  const phone = normalizePhone(contact && contact.phone);
  const groupId = normalizeGroupId(contact && (contact.groupId || contact.whatsappId));
  const whatsappId = type === "group" ? groupId : phone;
  return {
    ...contact,
    type,
    phone: type === "contact" ? phone : "",
    groupId: type === "group" ? groupId : "",
    whatsappId,
  };
}

function getContactMessageTarget(contact) {
  const normalized = toNormalizedContact(contact || {});
  return normalized.type === "group" ? normalized.groupId : normalized.phone;
}

async function listContacts() {
  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  return contacts
    .map((c) => toNormalizedContact(c))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createContact({ name, phone, type, groupId, whatsappId }) {
  const nextType = normalizeContactType(type);
  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(phone);
  const normalizedGroupId = normalizeGroupId(groupId || whatsappId);

  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (nextType === "contact" && !normalizedPhone) {
    throw new Error("El numero de WhatsApp es obligatorio.");
  }
  if (nextType === "group" && !normalizedGroupId) {
    throw new Error("El ID de grupo es obligatorio (ej: 123456@g.us).");
  }

  const { contacts: contactsRepo } = getRepositories();
  const contacts = (await contactsRepo.list()).map((c) => toNormalizedContact(c));
  if (nextType === "contact") {
    const exists = contacts.some(
      (c) => c.type === "contact" && normalizePhone(c.phone) === normalizedPhone
    );
    if (exists) throw new Error("Ya existe un contacto con ese numero.");
  }
  if (nextType === "group") {
    const exists = contacts.some(
      (c) => c.type === "group" && normalizeGroupId(c.groupId) === normalizedGroupId
    );
    if (exists) throw new Error("Ya existe un contacto con ese grupo.");
  }

  const contact = {
    id: randomUUID(),
    name: trimmedName,
    type: nextType,
    phone: nextType === "contact" ? normalizedPhone : "",
    groupId: nextType === "group" ? normalizedGroupId : "",
    whatsappId: nextType === "group" ? normalizedGroupId : normalizedPhone,
    createdAt: new Date().toISOString(),
  };

  await contactsRepo.insert(contact);
  return toNormalizedContact(contact);
}

async function getContactById(id) {
  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  const found = contacts.find((c) => c.id === id) || null;
  return found ? toNormalizedContact(found) : null;
}

async function updateContact(contactId, { name, phone, type, groupId, whatsappId }) {
  const targetId = String(contactId || "").trim();
  if (!targetId) throw new Error("Contacto invalido.");

  const nextType = normalizeContactType(type);
  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(phone);
  const normalizedGroupId = normalizeGroupId(groupId || whatsappId);
  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (nextType === "contact" && !normalizedPhone) {
    throw new Error("El numero de WhatsApp es obligatorio.");
  }
  if (nextType === "group" && !normalizedGroupId) {
    throw new Error("El ID de grupo es obligatorio (ej: 123456@g.us).");
  }

  const { contacts: contactsRepo, taskReplyRoutes: routesRepo } = getRepositories();
  const contacts = (await contactsRepo.list()).map((c) => toNormalizedContact(c));
  const index = contacts.findIndex((c) => c.id === targetId);
  if (index < 0) throw new Error("Contacto no encontrado.");

  const oldTarget = getContactMessageTarget(contacts[index]);
  if (nextType === "contact") {
    const duplicate = contacts.some(
      (c) =>
        c.id !== targetId &&
        c.type === "contact" &&
        normalizePhone(c.phone) === normalizedPhone
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese numero.");
  }
  if (nextType === "group") {
    const duplicate = contacts.some(
      (c) =>
        c.id !== targetId &&
        c.type === "group" &&
        normalizeGroupId(c.groupId) === normalizedGroupId
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese grupo.");
  }

  const updated = {
    ...contacts[index],
    name: trimmedName,
    type: nextType,
    phone: nextType === "contact" ? normalizedPhone : "",
    groupId: nextType === "group" ? normalizedGroupId : "",
    whatsappId: nextType === "group" ? normalizedGroupId : normalizedPhone,
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
      const nextDestination = getContactMessageTarget(updated);
      if (String(next.destinationPhone || "") !== nextDestination) {
        next.destinationPhone = nextDestination;
        changed = true;
      }
    }
    const newTarget = getContactMessageTarget(updated);
    if (oldTarget && String(next.sourcePhone || "") === oldTarget && oldTarget !== newTarget) {
      next.sourcePhone = newTarget;
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

  return toNormalizedContact(updated);
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
  normalizeGroupId,
  getContactMessageTarget,
};
