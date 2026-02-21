const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const { normalizePhone } = require("../agenda/contacts.service");

function normalizeRouteRow(row) {
  return {
    id: row.id || randomUUID(),
    taskId: String(row.taskId || "").trim(),
    sourcePhone: normalizePhone(row.sourcePhone),
    destinationContactId: String(row.destinationContactId || "").trim(),
    destinationPhone: normalizePhone(row.destinationPhone),
    enabled: row.enabled !== false,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

async function listRoutes() {
  const { taskReplyRoutes: routesRepo } = getRepositories();
  const rows = await routesRepo.list();
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeRouteRow)
    .filter(
      (row) =>
        row.taskId &&
        row.sourcePhone &&
        row.destinationContactId &&
        row.destinationPhone
    )
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function saveAll(rows) {
  const { taskReplyRoutes: routesRepo } = getRepositories();
  await routesRepo.saveAll(rows);
}

async function upsertRouteForTask({
  taskId,
  sourcePhone,
  destinationContactId,
  destinationPhone,
}) {
  const nextTaskId = String(taskId || "").trim();
  const nextSourcePhone = normalizePhone(sourcePhone);
  const nextDestinationContactId = String(destinationContactId || "").trim();
  const nextDestinationPhone = normalizePhone(destinationPhone);

  if (!nextTaskId || !nextSourcePhone || !nextDestinationContactId || !nextDestinationPhone) {
    throw new Error("No se pudo crear ruta de respuesta por datos incompletos.");
  }

  const rows = await listRoutes();
  const now = new Date().toISOString();

  let found = false;
  const updated = rows.map((row) => {
    if (row.taskId !== nextTaskId || row.sourcePhone !== nextSourcePhone) return row;
    found = true;
    return {
      ...row,
      destinationContactId: nextDestinationContactId,
      destinationPhone: nextDestinationPhone,
      enabled: true,
      updatedAt: now,
    };
  });

  if (!found) {
    updated.push({
      id: randomUUID(),
      taskId: nextTaskId,
      sourcePhone: nextSourcePhone,
      destinationContactId: nextDestinationContactId,
      destinationPhone: nextDestinationPhone,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  await saveAll(updated);
  return updated.find(
    (row) => row.taskId === nextTaskId && row.sourcePhone === nextSourcePhone
  );
}

async function findActiveRoutesBySourcePhone(sourcePhone) {
  const key = normalizePhone(sourcePhone);
  if (!key) return [];
  const rows = await listRoutes();
  return rows.filter((row) => row.enabled && row.sourcePhone === key);
}

module.exports = {
  listRoutes,
  upsertRouteForTask,
  findActiveRoutesBySourcePhone,
};
