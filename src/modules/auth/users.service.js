const { randomUUID, scryptSync, timingSafeEqual } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeUser(row) {
  return {
    id: normalizeText(row && row.id),
    name: normalizeText(row && row.name),
    email: normalizeEmail(row && row.email),
    passwordHash: normalizeText(row && row.passwordHash),
    createdAt: row && row.createdAt ? row.createdAt : new Date().toISOString(),
    updatedAt: row && row.updatedAt ? row.updatedAt : new Date().toISOString(),
    createdByUserId: normalizeText(row && row.createdByUserId) || null,
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error("La contraseña debe incluir mayúsculas, minúsculas y números.");
  }
}

function hashPassword(password, salt = randomUUID().replace(/-/g, "")) {
  const derived = scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const value = normalizeText(storedHash);
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, storedDigest] = parts;
  const computedDigest = scryptSync(String(password || ""), salt, 64).toString("hex");
  const left = Buffer.from(storedDigest, "hex");
  const right = Buffer.from(computedDigest, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function listUsers() {
  const { users } = getRepositories();
  const rows = await users.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeUser);
}

async function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const rows = await listUsers();
  return rows.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
}

async function getUserById(userId) {
  const targetId = normalizeText(userId);
  const rows = await listUsers();
  return rows.find((user) => user.id === targetId) || null;
}

async function hasAnyUsers() {
  const rows = await listUsers();
  return rows.length > 0;
}

async function createUser({ name = "", email, password, createdByUserId = null }) {
  const normalizedName = normalizeText(name);
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Debes ingresar un email válido.");
  }
  validatePassword(password);

  const { users } = getRepositories();
  const rows = await listUsers();
  if (rows.some((user) => normalizeEmail(user.email) === normalizedEmail)) {
    throw new Error("Ya existe un usuario con ese email.");
  }

  const nowIso = new Date().toISOString();
  const user = normalizeUser({
    id: randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByUserId: createdByUserId || null,
  });

  rows.push(user);
  await users.saveAll(rows);
  return user;
}

async function updateUser(userId, { name = "", email, password = "" }) {
  const targetId = normalizeText(userId);
  const normalizedName = normalizeText(name);
  const normalizedEmail = normalizeEmail(email);
  if (!targetId) throw new Error("Usuario inválido.");
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Debes ingresar un email válido.");
  }

  const { users } = getRepositories();
  const rows = await listUsers();
  const index = rows.findIndex((user) => user.id === targetId);
  if (index < 0) {
    throw new Error("Usuario no encontrado.");
  }
  if (rows.some((user) => user.id !== targetId && normalizeEmail(user.email) === normalizedEmail)) {
    throw new Error("Ya existe un usuario con ese email.");
  }

  const next = {
    ...rows[index],
    name: normalizedName,
    email: normalizedEmail,
    updatedAt: new Date().toISOString(),
  };
  if (normalizeText(password)) {
    validatePassword(password);
    next.passwordHash = hashPassword(password);
  }

  rows[index] = normalizeUser(next);
  await users.saveAll(rows);
  return rows[index];
}

async function deleteUser(userId, { currentUserId = null } = {}) {
  const targetId = normalizeText(userId);
  const rows = await listUsers();
  const target = rows.find((user) => user.id === targetId);
  if (!target) {
    throw new Error("Usuario no encontrado.");
  }
  if (currentUserId && targetId === normalizeText(currentUserId)) {
    throw new Error("No puedes eliminar el usuario con el que estás autenticado.");
  }
  if (rows.length <= 1) {
    throw new Error("No puedes eliminar el último usuario del sistema.");
  }

  const { users } = getRepositories();
  const kept = rows.filter((user) => user.id !== targetId);
  await users.saveAll(kept);
  return true;
}

async function authenticateUser({ email, password }) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

module.exports = {
  authenticateUser,
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  hasAnyUsers,
  listUsers,
  updateUser,
};
