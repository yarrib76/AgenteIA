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

function normalizeTelegramId(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeContactType(type) {
  const value = String(type || "").trim().toLowerCase();
  return value === "group" ? "group" : "contact";
}

function normalizeChannel(channel) {
  const value = String(channel || "").trim().toLowerCase();
  if (value === "telegram") return "telegram";
  if (value === "internal_chat") return "internal_chat";
  return "whatsapp";
}

function toNormalizedContact(contact) {
  const type = normalizeContactType(contact && contact.type);
  const phone = normalizePhone(contact && (contact.phone || contact.whatsappPhone));
  const groupId = normalizeGroupId(contact && (contact.groupId || contact.whatsappGroupId || contact.whatsappId));
  const telegramUserId = normalizeTelegramId(contact && (contact.telegramUserId || contact.telegramChatId));
  const telegramGroupId = normalizeTelegramId(contact && contact.telegramGroupId);
  const whatsappId = type === "group" ? groupId : phone;
  return {
    ...contact,
    type,
    phone: type === "contact" ? phone : "",
    groupId: type === "group" ? groupId : "",
    whatsappPhone: type === "contact" ? phone : "",
    whatsappGroupId: type === "group" ? groupId : "",
    whatsappId,
    telegramUserId: type === "contact" ? telegramUserId : "",
    telegramChatId: type === "contact" ? telegramUserId : "",
    telegramGroupId: type === "group" ? telegramGroupId : "",
  };
}

function normalizeTarget(channel, value) {
  const nextChannel = normalizeChannel(channel);
  if (nextChannel === "telegram") return normalizeTelegramId(value);
  if (nextChannel === "internal_chat") return String(value || "").trim();
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@g.us")) return raw;
  return normalizePhone(raw);
}

function getContactMessageTarget(contact, channel = "whatsapp") {
  const normalized = toNormalizedContact(contact || {});
  const nextChannel = normalizeChannel(channel);
  if (nextChannel === "telegram") {
    return normalized.type === "group" ? normalized.telegramGroupId : normalized.telegramUserId;
  }
  return normalized.type === "group" ? normalized.groupId : normalized.phone;
}

function hasTargetForChannel(contact, channel = "whatsapp") {
  return Boolean(getContactMessageTarget(contact, channel));
}

function getContactTargetLabel(contact, channel = "whatsapp") {
  return getContactMessageTarget(contact, channel) || "No configurado para este canal";
}

async function listContacts() {
  const { contacts: contactsRepo } = getRepositories();
  const contacts = await contactsRepo.list();
  return contacts
    .map((c) => toNormalizedContact(c))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createContact({
  name,
  phone,
  type,
  groupId,
  whatsappPhone,
  whatsappGroupId,
  telegramUserId,
  telegramGroupId,
}) {
  const nextType = normalizeContactType(type);
  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(whatsappPhone || phone);
  const normalizedGroupId = normalizeGroupId(whatsappGroupId || groupId);
  const normalizedTelegramUserId = normalizeTelegramId(telegramUserId);
  const normalizedTelegramGroupId = normalizeTelegramId(telegramGroupId);

  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (nextType === "contact" && !normalizedPhone && !normalizedTelegramUserId) {
    throw new Error("Debes cargar al menos WhatsApp o Telegram para el contacto.");
  }
  if (nextType === "group" && !normalizedGroupId && !normalizedTelegramGroupId) {
    throw new Error("Debes cargar al menos un grupo de WhatsApp o Telegram.");
  }

  const { contacts: contactsRepo } = getRepositories();
  const contacts = (await contactsRepo.list()).map((c) => toNormalizedContact(c));
  if (nextType === "contact" && normalizedPhone) {
    const exists = contacts.some(
      (c) => c.type === "contact" && normalizePhone(c.phone) === normalizedPhone
    );
    if (exists) throw new Error("Ya existe un contacto con ese numero de WhatsApp.");
  }
  if (nextType === "group" && normalizedGroupId) {
    const exists = contacts.some(
      (c) => c.type === "group" && normalizeGroupId(c.groupId) === normalizedGroupId
    );
    if (exists) throw new Error("Ya existe un contacto con ese grupo de WhatsApp.");
  }
  if (nextType === "contact" && normalizedTelegramUserId) {
    const exists = contacts.some(
      (c) => c.type === "contact" && normalizeTelegramId(c.telegramUserId) === normalizedTelegramUserId
    );
    if (exists) throw new Error("Ya existe un contacto con ese usuario de Telegram.");
  }
  if (nextType === "group" && normalizedTelegramGroupId) {
    const exists = contacts.some(
      (c) => c.type === "group" && normalizeTelegramId(c.telegramGroupId) === normalizedTelegramGroupId
    );
    if (exists) throw new Error("Ya existe un contacto con ese grupo de Telegram.");
  }

  const contact = {
    id: randomUUID(),
    name: trimmedName,
    type: nextType,
    phone: nextType === "contact" ? normalizedPhone : "",
    groupId: nextType === "group" ? normalizedGroupId : "",
    whatsappPhone: nextType === "contact" ? normalizedPhone : "",
    whatsappGroupId: nextType === "group" ? normalizedGroupId : "",
    whatsappId: nextType === "group" ? normalizedGroupId : normalizedPhone,
    telegramUserId: nextType === "contact" ? normalizedTelegramUserId : "",
    telegramChatId: nextType === "contact" ? normalizedTelegramUserId : "",
    telegramGroupId: nextType === "group" ? normalizedTelegramGroupId : "",
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

async function updateContact(contactId, {
  name,
  phone,
  type,
  groupId,
  whatsappPhone,
  whatsappGroupId,
  telegramUserId,
  telegramGroupId,
}) {
  const targetId = String(contactId || "").trim();
  if (!targetId) throw new Error("Contacto invalido.");

  const nextType = normalizeContactType(type);
  const trimmedName = String(name || "").trim();
  const normalizedPhone = normalizePhone(whatsappPhone || phone);
  const normalizedGroupId = normalizeGroupId(whatsappGroupId || groupId);
  const normalizedTelegramUserId = normalizeTelegramId(telegramUserId);
  const normalizedTelegramGroupId = normalizeTelegramId(telegramGroupId);

  if (!trimmedName) throw new Error("El nombre es obligatorio.");
  if (nextType === "contact" && !normalizedPhone && !normalizedTelegramUserId) {
    throw new Error("Debes cargar al menos WhatsApp o Telegram para el contacto.");
  }
  if (nextType === "group" && !normalizedGroupId && !normalizedTelegramGroupId) {
    throw new Error("Debes cargar al menos un grupo de WhatsApp o Telegram.");
  }

  const { contacts: contactsRepo, taskReplyRoutes: routesRepo } = getRepositories();
  const contacts = (await contactsRepo.list()).map((c) => toNormalizedContact(c));
  const index = contacts.findIndex((c) => c.id === targetId);
  if (index < 0) throw new Error("Contacto no encontrado.");

  if (nextType === "contact" && normalizedPhone) {
    const duplicate = contacts.some(
      (c) => c.id !== targetId && c.type === "contact" && normalizePhone(c.phone) === normalizedPhone
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese numero de WhatsApp.");
  }
  if (nextType === "group" && normalizedGroupId) {
    const duplicate = contacts.some(
      (c) => c.id !== targetId && c.type === "group" && normalizeGroupId(c.groupId) === normalizedGroupId
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese grupo de WhatsApp.");
  }
  if (nextType === "contact" && normalizedTelegramUserId) {
    const duplicate = contacts.some(
      (c) =>
        c.id !== targetId &&
        c.type === "contact" &&
        normalizeTelegramId(c.telegramUserId) === normalizedTelegramUserId
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese usuario de Telegram.");
  }
  if (nextType === "group" && normalizedTelegramGroupId) {
    const duplicate = contacts.some(
      (c) =>
        c.id !== targetId &&
        c.type === "group" &&
        normalizeTelegramId(c.telegramGroupId) === normalizedTelegramGroupId
    );
    if (duplicate) throw new Error("Ya existe otro contacto con ese grupo de Telegram.");
  }

  const previous = contacts[index];
  const updated = {
    ...previous,
    name: trimmedName,
    type: nextType,
    phone: nextType === "contact" ? normalizedPhone : "",
    groupId: nextType === "group" ? normalizedGroupId : "",
    whatsappPhone: nextType === "contact" ? normalizedPhone : "",
    whatsappGroupId: nextType === "group" ? normalizedGroupId : "",
    whatsappId: nextType === "group" ? normalizedGroupId : normalizedPhone,
    telegramUserId: nextType === "contact" ? normalizedTelegramUserId : "",
    telegramChatId: nextType === "contact" ? normalizedTelegramUserId : "",
    telegramGroupId: nextType === "group" ? normalizedTelegramGroupId : "",
    updatedAt: new Date().toISOString(),
  };
  contacts[index] = updated;
  await contactsRepo.saveAll(contacts);

  const routes = await routesRepo.list();
  let changedRoutes = false;
  const channels = ["whatsapp", "telegram"];
  const nextRoutes = (Array.isArray(routes) ? routes : []).map((route) => {
    if (!route) return route;
    let changed = false;
    const next = { ...route };
    const routeChannel = normalizeChannel(route.channel || "whatsapp");
    const oldTarget = getContactMessageTarget(previous, routeChannel);
    const newTarget = getContactMessageTarget(updated, routeChannel);
    if (String(next.destinationContactId || "") === targetId) {
      if (String(next.destinationPhone || "") !== newTarget) {
        next.destinationPhone = newTarget;
        changed = true;
      }
    }
    if (channels.includes(routeChannel) && oldTarget && String(next.sourcePhone || "") === oldTarget && oldTarget !== newTarget) {
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
    (row) =>
      String(row && row.destinationContactId) === targetId &&
      row &&
      row.enabled !== false &&
      row.routingEnabled !== false
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
  normalizeTelegramId,
  normalizeChannel,
  normalizeTarget,
  getContactMessageTarget,
  getContactTargetLabel,
  hasTargetForChannel,
  toNormalizedContact,
};
