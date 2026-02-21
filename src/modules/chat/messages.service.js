const { randomUUID } = require("crypto");
const { normalizePhone } = require("../agenda/contacts.service");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeContactKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@g.us")) return raw;
  return normalizePhone(raw);
}

async function listMessagesByPhone(phone, limit = 40) {
  const normalized = normalizeContactKey(phone);
  if (!normalized) return [];
  return listMessagesByPhones([normalized], limit);
}

async function listMessagesByPhones(phones, limit = 40) {
  const normalizedPhones = Array.from(
    new Set((phones || []).map((p) => normalizeContactKey(p)).filter(Boolean))
  );
  if (normalizedPhones.length === 0) return [];

  const { messages: messagesRepo } = getRepositories();
  const messages = await messagesRepo.list();
  return messages
    .filter((m) => normalizedPhones.includes(normalizeContactKey(m.contactPhone)))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-limit);
}

async function addMessage({ contactPhone, direction, text, status = "ok" }) {
  const normalizedPhone = normalizeContactKey(contactPhone);
  if (!normalizedPhone) throw new Error("Identificador de contacto invalido.");
  if (!text || !String(text).trim()) throw new Error("Mensaje vacio.");

  const message = {
    id: randomUUID(),
    contactPhone: normalizedPhone,
    direction,
    text: String(text).trim(),
    status,
    timestamp: new Date().toISOString(),
  };

  const { messages: messagesRepo } = getRepositories();
  const messages = await messagesRepo.list();
  messages.push(message);
  await messagesRepo.saveAll(messages);

  return message;
}

async function deleteMessagesByPhones(phones) {
  const normalizedPhones = Array.from(
    new Set((phones || []).map((p) => normalizeContactKey(p)).filter(Boolean))
  );
  if (normalizedPhones.length === 0) return 0;

  const { messages: messagesRepo } = getRepositories();
  const messages = await messagesRepo.list();
  const kept = messages.filter(
    (m) => !normalizedPhones.includes(normalizeContactKey(m.contactPhone))
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
};
