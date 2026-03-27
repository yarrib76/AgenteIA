const { randomUUID } = require("crypto");
const contactsService = require("../agenda/contacts.service");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeChannel(channel) {
  return contactsService.normalizeChannel(channel);
}

function normalizeContactKey(channel, value) {
  return contactsService.normalizeTarget(channel, value);
}

function normalizeMessageRow(row) {
  const channel = normalizeChannel(row && row.channel);
  const contactKey = normalizeContactKey(
    channel,
    row && (row.contactKey || row.contactPhone)
  );
  return {
    ...row,
    channel,
    contactKey,
    contactPhone: contactKey,
    providerMessageId: String(row && row.providerMessageId || "").trim(),
  };
}

async function listMessagesByPhone(phone, limit = 40, options = {}) {
  const channel = normalizeChannel(options.channel);
  const normalized = normalizeContactKey(channel, phone);
  if (!normalized) return [];
  return listMessagesByPhones([normalized], limit, { channel });
}

async function listMessagesByPhones(phones, limit = 40, options = {}) {
  const channel = normalizeChannel(options.channel);
  const normalizedPhones = Array.from(
    new Set((phones || []).map((p) => normalizeContactKey(channel, p)).filter(Boolean))
  );
  if (normalizedPhones.length === 0) return [];

  const { messages: messagesRepo } = getRepositories();
  const messages = await messagesRepo.list();
  return messages
    .map(normalizeMessageRow)
    .filter((m) => m.channel === channel && normalizedPhones.includes(m.contactKey))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-limit);
}

async function addMessage({
  channel = "whatsapp",
  contactPhone,
  direction,
  text,
  status = "ok",
  providerMessageId = "",
}) {
  const nextChannel = normalizeChannel(channel);
  const normalizedPhone = normalizeContactKey(nextChannel, contactPhone);
  if (!normalizedPhone) throw new Error("Identificador de contacto invalido.");
  if (!text || !String(text).trim()) throw new Error("Mensaje vacio.");

  const message = {
    id: randomUUID(),
    channel: nextChannel,
    contactKey: normalizedPhone,
    contactPhone: normalizedPhone,
    direction,
    text: String(text).trim(),
    status,
    providerMessageId: String(providerMessageId || "").trim(),
    timestamp: new Date().toISOString(),
  };

  const { messages: messagesRepo } = getRepositories();
  const messages = await messagesRepo.list();
  messages.push(message);
  await messagesRepo.saveAll(messages);

  return message;
}

async function deleteMessagesByPhones(phones, options = {}) {
  const channel = normalizeChannel(options.channel);
  const normalizedPhones = Array.from(
    new Set((phones || []).map((p) => normalizeContactKey(channel, p)).filter(Boolean))
  );
  if (normalizedPhones.length === 0) return 0;

  const { messages: messagesRepo } = getRepositories();
  const messages = (await messagesRepo.list()).map(normalizeMessageRow);
  const kept = messages.filter(
    (m) => !(m.channel === channel && normalizedPhones.includes(m.contactKey))
  );
  const deletedCount = messages.length - kept.length;
  if (deletedCount > 0) {
    await messagesRepo.saveAll(kept);
  }
  return deletedCount;
}

module.exports = {
  listMessagesByPhone,
  listMessagesByPhones,
  addMessage,
  deleteMessagesByPhones,
  normalizeContactKey,
  normalizeMessageRow,
};
