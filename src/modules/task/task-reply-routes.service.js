const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const { normalizePhone } = require("../agenda/contacts.service");

function normalizeContactKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@g.us")) return raw;
  return normalizePhone(raw);
}

function normalizeRouteRow(row) {
  return {
    id: row.id || randomUUID(),
    taskId: String(row.taskId || "").trim(),
    sourcePhone: normalizeContactKey(row.sourcePhone),
    destinationContactId: String(row.destinationContactId || "").trim(),
    destinationPhone: normalizeContactKey(row.destinationPhone),
    originalMessage: String(row.originalMessage || "").trim(),
    lastOutboundMessageId: String(row.lastOutboundMessageId || "").trim(),
    lastOutboundAt: row.lastOutboundAt || null,
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
  originalMessage,
  lastOutboundMessageId,
  lastOutboundAt,
}) {
  const nextTaskId = String(taskId || "").trim();
  const nextSourcePhone = normalizeContactKey(sourcePhone);
  const nextDestinationContactId = String(destinationContactId || "").trim();
  const nextDestinationPhone = normalizeContactKey(destinationPhone);
  const nextOriginalMessage = String(originalMessage || "").trim();
  const nextLastOutboundMessageId = String(lastOutboundMessageId || "").trim();
  const nextLastOutboundAt = lastOutboundAt || null;

  if (!nextTaskId || !nextSourcePhone || !nextDestinationContactId || !nextDestinationPhone) {
    throw new Error("No se pudo crear ruta de respuesta por datos incompletos.");
  }

  const rows = await listRoutes();
  const now = new Date().toISOString();

  let found = false;
  let upsertedRouteId = "";
  const updated = rows.map((row) => {
    if (row.taskId !== nextTaskId || row.sourcePhone !== nextSourcePhone) return row;
    found = true;
    upsertedRouteId = row.id;
    return {
      ...row,
      destinationContactId: nextDestinationContactId,
      destinationPhone: nextDestinationPhone,
      originalMessage: nextOriginalMessage,
      lastOutboundMessageId: nextLastOutboundMessageId,
      lastOutboundAt: nextLastOutboundAt,
      enabled: true,
      updatedAt: now,
    };
  });

  if (!found) {
    upsertedRouteId = randomUUID();
    updated.push({
      id: upsertedRouteId,
      taskId: nextTaskId,
      sourcePhone: nextSourcePhone,
      destinationContactId: nextDestinationContactId,
      destinationPhone: nextDestinationPhone,
      originalMessage: nextOriginalMessage,
      lastOutboundMessageId: nextLastOutboundMessageId,
      lastOutboundAt: nextLastOutboundAt,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Mantener una sola ruta activa por origen+destino para evitar cruces de contexto.
  for (let i = 0; i < updated.length; i += 1) {
    const row = updated[i];
    if (
      row.id !== upsertedRouteId
      && row.sourcePhone === nextSourcePhone
      && row.destinationPhone === nextDestinationPhone
      && row.enabled
    ) {
      updated[i] = {
        ...row,
        enabled: false,
        updatedAt: now,
      };
    }
  }

  await saveAll(updated);
  return updated.find((row) => row.id === upsertedRouteId) || null;
}

async function findActiveRoutesBySourcePhone(sourcePhone) {
  const key = normalizeContactKey(sourcePhone);
  if (!key) return [];
  const rows = await listRoutes();
  return rows.filter((row) => row.enabled && row.sourcePhone === key);
}

function dedupByDestinationLatest(rows) {
  const dedup = new Map();
  for (const row of rows || []) {
    if (!row.destinationPhone) continue;
    if (!dedup.has(row.destinationPhone)) {
      dedup.set(row.destinationPhone, row);
    }
  }
  return Array.from(dedup.values());
}

async function findRoutesForIncoming({
  sourcePhone,
  quotedMessageId,
  maxAgeHours = 168,
}) {
  const active = await findActiveRoutesBySourcePhone(sourcePhone);
  if (!active || active.length === 0) {
    return { routes: [], strategy: "none" };
  }

  const quotedId = String(quotedMessageId || "").trim();
  if (quotedId) {
    const byQuoted = active.filter(
      (row) => String(row.lastOutboundMessageId || "").trim() === quotedId
    );
    if (byQuoted.length > 0) {
      return {
        routes: dedupByDestinationLatest(byQuoted),
        strategy: "quoted_message_id",
      };
    }
  }

  const hours = Number.parseInt(String(maxAgeHours), 10);
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const cutoffMs = Date.now() - ttlHours * 60 * 60 * 1000;
  const byRecency = active.filter((row) => {
    const at = new Date(row.updatedAt || row.lastOutboundAt || 0).getTime();
    return Number.isFinite(at) && at >= cutoffMs;
  });
  if (byRecency.length === 0) {
    return { routes: [], strategy: "recency_no_match" };
  }
  return {
    routes: dedupByDestinationLatest(byRecency),
    strategy: "recency",
  };
}

module.exports = {
  listRoutes,
  upsertRouteForTask,
  findActiveRoutesBySourcePhone,
  findRoutesForIncoming,
};
