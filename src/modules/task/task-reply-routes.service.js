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
  const hasDestination = Boolean(
    String(row.destinationContactId || "").trim() && String(row.destinationPhone || "").trim()
  );
  return {
    id: row.id || randomUUID(),
    taskId: String(row.taskId || "").trim(),
    sourcePhone: normalizeContactKey(row.sourcePhone),
    destinationContactId: String(row.destinationContactId || "").trim(),
    destinationPhone: normalizeContactKey(row.destinationPhone),
    routingEnabled:
      typeof row.routingEnabled === "boolean" ? row.routingEnabled : hasDestination,
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
    .filter((row) => row.taskId && row.sourcePhone)
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
  routingEnabled = true,
  originalMessage,
  lastOutboundMessageId,
  lastOutboundAt,
}) {
  const nextTaskId = String(taskId || "").trim();
  const nextSourcePhone = normalizeContactKey(sourcePhone);
  const nextDestinationContactId = String(destinationContactId || "").trim();
  const nextDestinationPhone = normalizeContactKey(destinationPhone);
  const nextRoutingEnabled = Boolean(routingEnabled);
  const nextOriginalMessage = String(originalMessage || "").trim();
  const nextLastOutboundMessageId = String(lastOutboundMessageId || "").trim();
  const nextLastOutboundAt = lastOutboundAt || null;

  if (!nextTaskId || !nextSourcePhone) {
    throw new Error("No se pudo crear ruta de respuesta por datos incompletos.");
  }
  if (nextRoutingEnabled && (!nextDestinationContactId || !nextDestinationPhone)) {
    throw new Error("No se pudo crear ruta de respuesta por datos incompletos.");
  }

  const rows = await listRoutes();
  const now = new Date().toISOString();

  const upsertedRouteId = randomUUID();
  const updated = [
    ...rows,
    {
      id: upsertedRouteId,
      taskId: nextTaskId,
      sourcePhone: nextSourcePhone,
      destinationContactId: nextRoutingEnabled ? nextDestinationContactId : "",
      destinationPhone: nextRoutingEnabled ? nextDestinationPhone : "",
      routingEnabled: nextRoutingEnabled,
      originalMessage: nextOriginalMessage,
      lastOutboundMessageId: nextLastOutboundMessageId,
      lastOutboundAt: nextLastOutboundAt,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  await saveAll(updated);
  return updated.find((row) => row.id === upsertedRouteId) || null;
}

async function findActiveRoutesBySourcePhone(sourcePhone) {
  const key = normalizeContactKey(sourcePhone);
  if (!key) return [];
  const rows = await listRoutes();
  return rows.filter((row) => row.enabled && row.sourcePhone === key);
}

async function disableRoutesByTaskId(taskId) {
  const targetTaskId = String(taskId || "").trim();
  if (!targetTaskId) return 0;
  const rows = await listRoutes();
  const now = new Date().toISOString();
  let changed = 0;
  const updated = rows.map((row) => {
    if (row.taskId !== targetTaskId || row.enabled !== true) return row;
    changed += 1;
    return {
      ...row,
      enabled: false,
      updatedAt: now,
    };
  });
  if (changed > 0) {
    await saveAll(updated);
  }
  return changed;
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

function getRouteEventTimeMs(row) {
  const at = new Date(row.lastOutboundAt || row.updatedAt || row.createdAt || 0).getTime();
  return Number.isFinite(at) ? at : 0;
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

  const sortedActive = active
    .slice()
    .sort((a, b) => getRouteEventTimeMs(b) - getRouteEventTimeMs(a));

  const quotedId = String(quotedMessageId || "").trim();
  if (quotedId) {
    const byQuoted = sortedActive.find(
      (row) => String(row.lastOutboundMessageId || "").trim() === quotedId
    );
    if (byQuoted) {
      if (!byQuoted.routingEnabled || !byQuoted.destinationPhone || !byQuoted.destinationContactId) {
        return { routes: [], strategy: "quoted_routing_disabled" };
      }
      return {
        routes: [byQuoted],
        strategy: "quoted_message_id",
      };
    }
    // Si el usuario respondio a un mensaje puntual, no aplicar fallback por recencia:
    // evita mezclar con rutas antiguas de otras tareas.
    return { routes: [], strategy: "quoted_no_match" };
  }

  const hours = Number.parseInt(String(maxAgeHours), 10);
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const cutoffMs = Date.now() - ttlHours * 60 * 60 * 1000;
  const byRecency = sortedActive.filter((row) => {
    const at = getRouteEventTimeMs(row);
    return at >= cutoffMs;
  });
  if (byRecency.length === 0) {
    return { routes: [], strategy: "recency_no_match" };
  }
  const latest = byRecency[0];
  if (!latest.routingEnabled || !latest.destinationPhone || !latest.destinationContactId) {
    return { routes: [], strategy: "latest_message_no_routing" };
  }
  return {
    routes: [latest],
    strategy: "latest_message",
  };
}

module.exports = {
  listRoutes,
  upsertRouteForTask,
  findActiveRoutesBySourcePhone,
  findRoutesForIncoming,
  disableRoutesByTaskId,
};
