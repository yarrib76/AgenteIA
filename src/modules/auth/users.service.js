const { randomUUID, scryptSync, timingSafeEqual } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
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
  return Array.isArray(rows) ? rows : [];
}

async function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const rows = await listUsers();
  return rows.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
}

async function getUserById(userId) {
  const rows = await listUsers();
  return rows.find((user) => user.id === userId) || null;
}

async function hasAnyUsers() {
  const rows = await listUsers();
  return rows.length > 0;
}

async function createUser({ email, password, createdByUserId = null }) {
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
  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByUserId: createdByUserId || null,
  };

  rows.push(user);
  await users.saveAll(rows);
  return user;
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
  getUserByEmail,
  getUserById,
  hasAnyUsers,
  listUsers,
};
