const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const usersService = require("../auth/users.service");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeIdList(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  return Array.from(new Set(source.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeGroup(row) {
  return {
    id: normalizeText(row && row.id),
    name: normalizeText(row && row.name),
    description: normalizeText(row && row.description),
    memberUserIds: normalizeIdList(row && row.memberUserIds),
    createdAt: row && row.createdAt || new Date().toISOString(),
    updatedAt: row && row.updatedAt || new Date().toISOString(),
    createdByUserId: normalizeText(row && row.createdByUserId) || null,
  };
}

async function listRawGroups() {
  const { internalGroups } = getRepositories();
  const rows = await internalGroups.list();
  return (Array.isArray(rows) ? rows : []).map(normalizeGroup);
}

async function saveAll(rows) {
  const { internalGroups } = getRepositories();
  await internalGroups.saveAll(rows.map(normalizeGroup));
}

async function listGroups() {
  const [groups, users] = await Promise.all([listRawGroups(), usersService.listUsers()]);
  return groups.map((group) => ({
    ...group,
    members: group.memberUserIds
      .map((userId) => users.find((user) => user.id === userId))
      .filter(Boolean)
      .map((user) => ({ id: user.id, email: user.email })),
    membersCount: group.memberUserIds.length,
  }));
}

async function getGroupById(groupId) {
  const groups = await listGroups();
  return groups.find((group) => group.id === normalizeText(groupId)) || null;
}

async function validateMembers(memberUserIds) {
  const nextIds = normalizeIdList(memberUserIds);
  if (nextIds.length === 0) {
    throw new Error("Debes seleccionar al menos un usuario para el grupo.");
  }
  const users = await usersService.listUsers();
  for (const userId of nextIds) {
    if (!users.some((user) => user.id === userId)) {
      throw new Error("La lista de miembros contiene un usuario invalido.");
    }
  }
  return nextIds;
}

async function createGroup({ name, description = "", memberUserIds, createdByUserId = null }) {
  const nextName = normalizeText(name);
  if (!nextName) {
    throw new Error("Debes ingresar un nombre para el grupo.");
  }
  const nextMembers = await validateMembers(memberUserIds);
  const groups = await listRawGroups();
  if (groups.some((group) => group.name.toLowerCase() === nextName.toLowerCase())) {
    throw new Error("Ya existe un grupo interno con ese nombre.");
  }
  const now = new Date().toISOString();
  const group = normalizeGroup({
    id: randomUUID(),
    name: nextName,
    description,
    memberUserIds: nextMembers,
    createdAt: now,
    updatedAt: now,
    createdByUserId,
  });
  groups.push(group);
  await saveAll(groups);
  return getGroupById(group.id);
}

async function updateGroup(groupId, { name, description = "", memberUserIds }) {
  const targetId = normalizeText(groupId);
  const nextName = normalizeText(name);
  if (!nextName) {
    throw new Error("Debes ingresar un nombre para el grupo.");
  }
  const nextMembers = await validateMembers(memberUserIds);
  const groups = await listRawGroups();
  const index = groups.findIndex((group) => group.id === targetId);
  if (index < 0) {
    throw new Error("Grupo interno no encontrado.");
  }
  if (groups.some((group) => group.id !== targetId && group.name.toLowerCase() === nextName.toLowerCase())) {
    throw new Error("Ya existe otro grupo interno con ese nombre.");
  }
  groups[index] = normalizeGroup({
    ...groups[index],
    name: nextName,
    description,
    memberUserIds: nextMembers,
    updatedAt: new Date().toISOString(),
  });
  await saveAll(groups);
  return getGroupById(targetId);
}

async function deleteGroup(groupId) {
  const targetId = normalizeText(groupId);
  const groups = await listRawGroups();
  const kept = groups.filter((group) => group.id !== targetId);
  const deleted = groups.length - kept.length;
  if (deleted > 0) {
    await saveAll(kept);
  }
  return deleted;
}

module.exports = {
  listGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
};
