const { randomBytes, createHash } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const usersService = require("../auth/users.service");

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeText(value) {
  return String(value || "").trim();
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeSession(row) {
  return {
    id: String(row && row.id || "").trim(),
    tokenHash: String(row && row.tokenHash || "").trim(),
    userId: String(row && row.userId || "").trim(),
    deviceName: normalizeText(row && row.deviceName),
    createdAt: row && row.createdAt || new Date().toISOString(),
    updatedAt: row && row.updatedAt || new Date().toISOString(),
    expiresAt: row && row.expiresAt || new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    lastUsedAt: row && row.lastUsedAt || null,
  };
}

async function listSessions() {
  const { mobileAuthTokens } = getRepositories();
  const rows = await mobileAuthTokens.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeSession);
}

async function saveSessions(rows) {
  const { mobileAuthTokens } = getRepositories();
  await mobileAuthTokens.saveAll(rows);
}

async function createSession({ userId, deviceName = "" }) {
  const token = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const session = normalizeSession({
    id: randomBytes(16).toString("hex"),
    tokenHash: hashToken(token),
    userId,
    deviceName,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    lastUsedAt: now,
  });
  const sessions = await listSessions();
  sessions.push(session);
  await saveSessions(sessions);
  return {
    token,
    session,
  };
}

async function getSessionByToken(rawToken) {
  const token = normalizeText(rawToken);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const sessions = await listSessions();
  const found = sessions.find((row) => row.tokenHash === tokenHash) || null;
  if (!found) return null;
  if (new Date(found.expiresAt).getTime() < Date.now()) {
    await revokeSession(token);
    return null;
  }
  return found;
}

async function touchSession(rawToken) {
  const token = normalizeText(rawToken);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const sessions = await listSessions();
  let nextSession = null;
  const updated = sessions.map((row) => {
    if (row.tokenHash !== tokenHash) return row;
    nextSession = {
      ...row,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    };
    return nextSession;
  });
  if (!nextSession) return null;
  await saveSessions(updated);
  return nextSession;
}

async function revokeSession(rawToken) {
  const token = normalizeText(rawToken);
  if (!token) return 0;
  const tokenHash = hashToken(token);
  const sessions = await listSessions();
  const kept = sessions.filter((row) => row.tokenHash !== tokenHash);
  const deleted = sessions.length - kept.length;
  if (deleted > 0) {
    await saveSessions(kept);
  }
  return deleted;
}

async function authenticateToken(rawToken) {
  const session = await getSessionByToken(rawToken);
  if (!session) return null;
  const touched = await touchSession(rawToken);
  const user = await usersService.getUserById(session.userId);
  if (!user) {
    await revokeSession(rawToken);
    return null;
  }
  return {
    session: touched || session,
    user,
  };
}

module.exports = {
  createSession,
  getSessionByToken,
  revokeSession,
  authenticateToken,
};
