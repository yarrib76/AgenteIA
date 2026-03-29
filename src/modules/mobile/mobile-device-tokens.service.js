const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeRow(row) {
  return {
    id: normalizeText(row && row.id) || randomUUID(),
    userId: normalizeText(row && row.userId),
    token: normalizeText(row && row.token),
    platform: normalizeText(row && row.platform) || "android",
    deviceName: normalizeText(row && row.deviceName),
    appVersion: normalizeText(row && row.appVersion),
    createdAt: row && row.createdAt || new Date().toISOString(),
    updatedAt: row && row.updatedAt || new Date().toISOString(),
    lastUsedAt: row && row.lastUsedAt || null,
  };
}

async function listTokens() {
  const { deviceTokens } = getRepositories();
  const rows = await deviceTokens.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeRow);
}

async function saveAll(rows) {
  const { deviceTokens } = getRepositories();
  await deviceTokens.saveAll(rows);
}

async function registerToken({ userId, token, platform = "android", deviceName = "", appVersion = "" }) {
  const nextUserId = normalizeText(userId);
  const nextToken = normalizeText(token);
  if (!nextUserId || !nextToken) {
    throw new Error("Token FCM invalido.");
  }
  const rows = await listTokens();
  const now = new Date().toISOString();
  const existingIndex = rows.findIndex((row) => row.token === nextToken);
  const next = normalizeRow({
    ...(existingIndex >= 0 ? rows[existingIndex] : {}),
    userId: nextUserId,
    token: nextToken,
    platform,
    deviceName,
    appVersion,
    updatedAt: now,
    lastUsedAt: now,
  });
  if (existingIndex >= 0) {
    rows[existingIndex] = next;
  } else {
    rows.push({
      ...next,
      createdAt: now,
    });
  }
  await saveAll(rows);
  return next;
}

async function unregisterToken(token) {
  const nextToken = normalizeText(token);
  if (!nextToken) return 0;
  const rows = await listTokens();
  const kept = rows.filter((row) => row.token !== nextToken);
  const deleted = rows.length - kept.length;
  if (deleted > 0) {
    await saveAll(kept);
  }
  return deleted;
}

async function listTokensByUserId(userId) {
  const nextUserId = normalizeText(userId);
  const rows = await listTokens();
  return rows.filter((row) => row.userId === nextUserId);
}

module.exports = {
  registerToken,
  unregisterToken,
  listTokensByUserId,
  listTokens,
};
