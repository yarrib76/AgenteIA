const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeMethod(value) {
  const method = normalizeText(value).toUpperCase();
  const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  if (!allowed.has(method)) throw new Error("Metodo HTTP invalido.");
  return method;
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers === "string") {
    const raw = normalizeText(headers);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return normalizeHeaders(parsed);
    } catch (error) {
      throw new Error("Headers JSON invalido.");
    }
  }
  if (typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("Headers debe ser un objeto JSON.");
  }
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = normalizeText(key);
    if (!k) continue;
    result[k] = String(value == null ? "" : value);
  }
  return result;
}

function normalizeTimeoutMs(value) {
  const parsed = Number.parseInt(String(value || "15000"), 10);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 120000) {
    return 15000;
  }
  return parsed;
}

function normalizeIntegration(row) {
  return {
    id: row.id,
    name: normalizeText(row.name),
    method: normalizeMethod(row.method || "GET"),
    url: normalizeText(row.url),
    headers: normalizeHeaders(row.headers || {}),
    timeoutMs: normalizeTimeoutMs(row.timeoutMs),
    isActive: row.isActive !== false,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || null,
  };
}

async function listIntegrations() {
  const { apiIntegrations: integrationsRepo } = getRepositories();
  const rows = await integrationsRepo.list();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeIntegration(row))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function getIntegrationById(integrationId) {
  const rows = await listIntegrations();
  return rows.find((row) => row.id === integrationId) || null;
}

async function createIntegration({ name, method, url, headers, timeoutMs, isActive }) {
  const nextName = normalizeText(name);
  const nextUrl = normalizeText(url);
  if (!nextName) throw new Error("El nombre es obligatorio.");
  if (!nextUrl) throw new Error("La URL es obligatoria.");

  const rows = await listIntegrations();
  const duplicated = rows.some((row) => row.name.toLowerCase() === nextName.toLowerCase());
  if (duplicated) throw new Error("Ya existe una integracion con ese nombre.");

  const created = normalizeIntegration({
    id: randomUUID(),
    name: nextName,
    method,
    url: nextUrl,
    headers,
    timeoutMs,
    isActive: isActive !== false,
    createdAt: new Date().toISOString(),
  });
  rows.push(created);

  const { apiIntegrations: integrationsRepo } = getRepositories();
  await integrationsRepo.saveAll(rows);
  return created;
}

async function updateIntegration(
  integrationId,
  { name, method, url, headers, timeoutMs, isActive }
) {
  const targetId = normalizeText(integrationId);
  if (!targetId) throw new Error("Integracion invalida.");
  const nextName = normalizeText(name);
  const nextUrl = normalizeText(url);
  if (!nextName) throw new Error("El nombre es obligatorio.");
  if (!nextUrl) throw new Error("La URL es obligatoria.");

  const rows = await listIntegrations();
  const index = rows.findIndex((row) => row.id === targetId);
  if (index < 0) throw new Error("Integracion no encontrada.");
  const duplicated = rows.some(
    (row) => row.id !== targetId && row.name.toLowerCase() === nextName.toLowerCase()
  );
  if (duplicated) throw new Error("Ya existe una integracion con ese nombre.");

  rows[index] = normalizeIntegration({
    ...rows[index],
    name: nextName,
    method,
    url: nextUrl,
    headers,
    timeoutMs,
    isActive: isActive !== false,
    updatedAt: new Date().toISOString(),
  });

  const { apiIntegrations: integrationsRepo } = getRepositories();
  await integrationsRepo.saveAll(rows);
  return rows[index];
}

async function deleteIntegration(integrationId) {
  const targetId = normalizeText(integrationId);
  if (!targetId) throw new Error("Integracion invalida.");

  const { apiIntegrations: integrationsRepo, tasks: tasksRepo } = getRepositories();
  const [rows, tasks] = await Promise.all([integrationsRepo.list(), tasksRepo.list()]);
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => normalizeIntegration(row));
  const index = normalizedRows.findIndex((row) => row.id === targetId);
  if (index < 0) throw new Error("Integracion no encontrada.");

  const inUse = (Array.isArray(tasks) ? tasks : []).some(
    (task) => normalizeText(task && task.integrationId) === targetId
  );
  if (inUse) {
    throw new Error("No se puede eliminar: la integracion esta asociada a una tarea.");
  }

  const [removed] = normalizedRows.splice(index, 1);
  await integrationsRepo.saveAll(normalizedRows);
  return removed;
}

module.exports = {
  listIntegrations,
  getIntegrationById,
  createIntegration,
  updateIntegration,
  deleteIntegration,
};
