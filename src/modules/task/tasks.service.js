const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const agentsService = require("../agent/agents.service");
const rolesService = require("../agent/roles.service");
const filesService = require("../file/files.service");
const modelsService = require("../model/models.service");
const modelTestService = require("../model/model-test.service");
const contactsService = require("../agenda/contacts.service");
const integrationsService = require("../integration/api-integrations.service");
const whatsappGateway = require("../whatsapp/whatsapp.gateway");
const messagesService = require("../chat/messages.service");
const taskReplyRoutesService = require("./task-reply-routes.service");

function normalizeText(value) {
  return String(value || "").trim();
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function normalizeIdList(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const values = source.map((item) => normalizeText(item)).filter(Boolean);
  return Array.from(new Set(values));
}

function normalizeReplyRoutingMode(value, fallbackResponseContactId = "") {
  const mode = normalizeText(value).toLowerCase();
  if (mode === "contact") return "contact";
  if (mode === "none") return "none";
  return normalizeText(fallbackResponseContactId) ? "contact" : "none";
}

function normalizeCompareText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]/g, "")
    .trim();
}

function getZonedDateParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = {};
  for (const part of parts) {
    if (part && part.type && part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return {
    year: map.year || "1970",
    month: map.month || "01",
    day: map.day || "01",
  };
}

function buildTodayIsoAndToken(timeZone = "America/Argentina/Buenos_Aires") {
  const parts = getZonedDateParts(timeZone);
  const y = Number.parseInt(parts.year, 10);
  const m = Number.parseInt(parts.month, 10);
  const d = Number.parseInt(parts.day, 10);
  const monthEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    fechaHoyIso: `${parts.year}-${parts.month}-${parts.day}`,
    tokenFechaHoy: `${d}-${monthEn[Math.max(1, Math.min(12, m)) - 1]}`,
    year: y,
  };
}

function buildTodayContextText(timeZone = "America/Argentina/Buenos_Aires") {
  const { fechaHoyIso, tokenFechaHoy } = buildTodayIsoAndToken(timeZone);
  return [
    `FECHA_HOY (obligatoria, no la adivines): ${fechaHoyIso}`,
    `TZ (para interpretacion): ${timeZone}`,
    `Token de fecha de hoy (D-MMM): ${tokenFechaHoy}`,
  ].join("\n");
}

function normalizeScheduleDays(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const values = source
    .map((item) => Number.parseInt(String(item).trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function validateScheduleTime(value) {
  const text = normalizeText(value);
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw new Error("Hora de programacion invalida. Usa formato HH:mm.");
  }
  const [hour, minute] = text.split(":").map((n) => Number.parseInt(n, 10));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Hora de programacion fuera de rango.");
  }
  return { time: text, hour, minute };
}

function validateTimezone(value) {
  const timezone = normalizeText(value) || "America/Argentina/Buenos_Aires";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (error) {
    throw new Error("Zona horaria invalida.");
  }
  return timezone;
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const item of parts) {
    if (item && item.type && item.type !== "literal") {
      map[item.type] = item.value;
    }
  }
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[map.weekday],
    hour: Number.parseInt(map.hour || "0", 10),
    minute: Number.parseInt(map.minute || "0", 10),
  };
}

function computeNextRunAt({ days, hour, minute, timezone }, fromDate = new Date()) {
  const start = new Date(fromDate.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const maxChecks = 60 * 24 * 14;
  const daySet = new Set(days);

  for (let i = 0; i < maxChecks; i += 1) {
    const candidate = new Date(start.getTime() + i * 60000);
    const zoned = getZonedParts(candidate, timezone);
    if (!daySet.has(zoned.weekday)) continue;
    if (zoned.hour === hour && zoned.minute === minute) {
      return candidate.toISOString();
    }
  }

  throw new Error("No se pudo calcular la proxima ejecucion programada.");
}

function normalizeTaskSchedule(rawTask) {
  const scheduleEnabled = Boolean(rawTask && rawTask.scheduleEnabled);
  const scheduleDays = normalizeScheduleDays(rawTask && rawTask.scheduleDays);
  const scheduleTime = normalizeText(rawTask && rawTask.scheduleTime);
  const scheduleTimezone = normalizeText(rawTask && rawTask.scheduleTimezone)
    || "America/Argentina/Buenos_Aires";

  return {
    scheduleEnabled,
    scheduleDays,
    scheduleTime,
    scheduleTimezone,
    nextRunAt: rawTask && rawTask.nextRunAt ? rawTask.nextRunAt : null,
    scheduleLastRunAt: rawTask && rawTask.scheduleLastRunAt ? rawTask.scheduleLastRunAt : null,
    scheduleLastStatus: rawTask && rawTask.scheduleLastStatus ? rawTask.scheduleLastStatus : null,
    scheduleLastError: rawTask && rawTask.scheduleLastError ? rawTask.scheduleLastError : null,
  };
}

function buildSchedulePayload({
  scheduleEnabled,
  scheduleDays,
  scheduleTime,
  scheduleTimezone,
}, baseDate = new Date()) {
  const enabled = parseBool(scheduleEnabled);
  if (!enabled) {
    return {
      scheduleEnabled: false,
      scheduleDays: [],
      scheduleTime: "",
      scheduleTimezone: "America/Argentina/Buenos_Aires",
      nextRunAt: null,
    };
  }

  const days = normalizeScheduleDays(scheduleDays);
  if (days.length === 0) {
    throw new Error("Debes seleccionar al menos un dia para la programacion.");
  }
  const { time, hour, minute } = validateScheduleTime(scheduleTime);
  const timezone = validateTimezone(scheduleTimezone);
  const nextRunAt = computeNextRunAt({ days, hour, minute, timezone }, baseDate);

  return {
    scheduleEnabled: true,
    scheduleDays: days,
    scheduleTime: time,
    scheduleTimezone: timezone,
    nextRunAt,
  };
}

function composePrompt(agentRoleDetail, taskPromptTemplate, taskInput, fileContext) {
  const roleText = normalizeText(agentRoleDetail);
  const templateText = normalizeText(taskPromptTemplate);
  const inputText = normalizeText(taskInput);
  if (!templateText) throw new Error("La plantilla de tarea es obligatoria.");
  if (!inputText) throw new Error("El input de tarea es obligatorio.");

  const sections = [];
  if (roleText) sections.push(roleText);
  sections.push(`Instruccion de la tarea:\n${templateText}`);
  sections.push(`Input de la tarea:\n${inputText}`);
  if (fileContext) sections.push(`Archivo de referencia:\n${fileContext}`);
  return sections.join("\n\n");
}

function buildActionContractPrompt() {
  return [
    "Responde SOLO en JSON valido, sin markdown.",
    "Esquema de salida:",
    '{"result_summary":"texto", "actions":[{"type":"call_external_api","integrationId":"id_integracion","query":{},"body":{}},{"type":"send_whatsapp","contactId":"id_opcional","contact":"nombre o numero","message":"texto"}] }',
    "Si no hay accion, enviar actions: [].",
    "Usa call_external_api solo cuando necesites consultar APIs externas.",
    "Si la accion es send_whatsapp, el campo message debe comenzar exactamente con el detalle del rol del agente.",
    "Si hay lista de contactos disponible, prioriza devolver contactId.",
    "Si hay lista de integraciones disponible, prioriza devolver integrationId.",
    "No inventes contactos inexistentes.",
  ].join("\n");
}

function buildForceWhatsAppRetryPrompt({
  mergedPrompt,
  runtimeFileContext,
  contactsReferenceText,
  integrationsReferenceText,
  lastResultSummary,
}) {
  return [
    mergedPrompt,
    runtimeFileContext || "",
    contactsReferenceText || "",
    integrationsReferenceText || "",
    "",
    "REINTENTO OBLIGATORIO.",
    "La tarea requiere enviar WhatsApp.",
    "Responde SOLO en JSON valido, sin markdown.",
    "Devuelve EXACTAMENTE 1 accion en actions con type=send_whatsapp.",
    "No permitas actions vacio.",
    "Si result_summary ya contiene el contenido, usalo para el campo message.",
    "Si hay lista de contactos, devuelve contactId para evitar ambiguedad.",
    "No devuelvas call_external_api en este reintento.",
    "Esquema estricto:",
    '{"result_summary":"texto", "actions":[{"type":"send_whatsapp","contactId":"id_opcional","contact":"nombre o numero","message":"texto"}]}',
    lastResultSummary
      ? `Resultado previo disponible: ${String(lastResultSummary)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function toPromptPreview(text, maxChars = 12000) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n\n[TRUNCADO ${raw.length - maxChars} caracteres]`;
}

function buildContactsReferenceText(contacts) {
  const rows = Array.isArray(contacts) ? contacts : [];
  if (rows.length === 0) return "";
  const compact = rows.slice(0, 200).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type || "contact",
    target: contactsService.getContactMessageTarget(c),
  }));
  return [
    "Contactos disponibles (usar contactId cuando corresponda):",
    JSON.stringify(compact),
  ].join("\n");
}

function buildIntegrationsReferenceText(integrations) {
  const rows = Array.isArray(integrations) ? integrations : [];
  if (rows.length === 0) return "";
  const compact = rows.slice(0, 200).map((i) => ({
    id: i.id,
    name: i.name,
    method: i.method,
    url: i.url,
    timeoutMs: i.timeoutMs,
    isActive: i.isActive !== false,
    headerKeys: Object.keys(i.headers || {}),
  }));
  return [
    "Integraciones API disponibles (usar integrationId cuando corresponda):",
    JSON.stringify(compact),
  ].join("\n");
}

function normalizeActionObject(value) {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const raw = normalizeText(value);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (error) {
      return {};
    }
  }
  return {};
}

function parseModelOutputToJson(rawOutput) {
  const text = String(rawOutput || "").trim();
  if (!text) throw new Error("Salida vacia del modelo.");

  try {
    return JSON.parse(text);
  } catch (error) {
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      return JSON.parse(fenced[1]);
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("No se pudo parsear JSON de la respuesta del modelo.");
  }
}

function appendLog(task, step, status, message, data) {
  const logs = Array.isArray(task.executionLogs) ? task.executionLogs : [];
  logs.push({
    at: new Date().toISOString(),
    step,
    status,
    message,
    data: data || null,
  });
  return {
    ...task,
    executionLogs: logs,
  };
}

function requiresWhatsAppAction(task) {
  const text = [
    task.taskPromptTemplate || "",
    task.taskInput || "",
    task.mergedPrompt || "",
  ]
    .join(" ")
    .toLowerCase();
  return text.includes("whatsapp") || text.includes("whatssap");
}

async function listTasks() {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await tasksRepo.list();
  const normalized = tasks.map((task) => {
    const responseContactId =
      normalizeText(task.responseContactId) || normalizeText(task.replyToContactId) || null;
    const replyRoutingMode = normalizeReplyRoutingMode(task.replyRoutingMode, responseContactId);
    const integrationId = normalizeText(task.integrationId) || null;
    const allowedGroupContactIds = normalizeIdList(task.allowedGroupContactIds);
    const schedule = normalizeTaskSchedule(task);
    if (task.taskPromptTemplate || task.taskInput) {
      return {
        status: "draft",
        ...task,
        responseContactId,
        replyRoutingMode,
        integrationId,
        allowedGroupContactIds,
        ...schedule,
      };
    }
    return {
      status: task.status || "draft",
      ...task,
      taskPromptTemplate: task.taskPrompt || "",
      taskInput: "",
      responseContactId,
      replyRoutingMode,
      integrationId,
      allowedGroupContactIds,
      ...schedule,
    };
  });
  return normalized.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createTask({
  agentId,
  taskPromptTemplate,
  taskInput,
  fileId,
  integrationId,
  responseContactId,
  replyRoutingMode,
  allowedGroupContactIds,
  scheduleEnabled,
  scheduleDays,
  scheduleTime,
  scheduleTimezone,
}) {
  const nextAgentId = normalizeText(agentId);
  const nextTaskPromptTemplate = normalizeText(taskPromptTemplate);
  const nextTaskInput = normalizeText(taskInput);
  const nextFileId = normalizeText(fileId);
  const nextIntegrationId = normalizeText(integrationId);
  const nextResponseContactId = normalizeText(responseContactId);
  const nextReplyRoutingMode = normalizeReplyRoutingMode(replyRoutingMode, nextResponseContactId);
  const nextAllowedGroupContactIds = normalizeIdList(allowedGroupContactIds);
  const schedule = buildSchedulePayload({
    scheduleEnabled,
    scheduleDays,
    scheduleTime,
    scheduleTimezone,
  });
  if (!nextAgentId) throw new Error("Debes seleccionar un agente.");
  if (!nextTaskPromptTemplate) {
    throw new Error("La plantilla de tarea es obligatoria.");
  }
  if (!nextTaskInput) throw new Error("El input de tarea es obligatorio.");

  const agent = await agentsService.getAgentById(nextAgentId);
  if (!agent) throw new Error("Agente invalido.");

  const role = await rolesService.getRoleById(agent.roleId);
  if (!role) throw new Error("El agente seleccionado no tiene rol valido.");
  if (nextIntegrationId) {
    const integration = await integrationsService.getIntegrationById(nextIntegrationId);
    if (!integration) throw new Error("Integracion API invalida.");
  }

  if (nextReplyRoutingMode === "contact") {
    if (!nextResponseContactId) {
      throw new Error("Debes seleccionar un contacto destino de respuesta o usar Sin ruteo.");
    }
    const targetContact = await contactsService.getContactById(nextResponseContactId);
    if (!targetContact) {
      throw new Error("Contacto destino de respuesta invalido.");
    }
  }
  if (nextAllowedGroupContactIds.length > 0) {
    const allContacts = await contactsService.listContacts();
    for (const contactId of nextAllowedGroupContactIds) {
      const group = allContacts.find((c) => c.id === contactId);
      if (!group || String(group.type || "contact") !== "group") {
        throw new Error("La lista de grupos permitidos contiene un grupo invalido.");
      }
    }
  }

  let fileContext = "";
  if (nextFileId) {
    const fileRow = await filesService.getFileById(nextFileId);
    if (!fileRow) throw new Error("Archivo seleccionado invalido.");
    fileContext = `Nombre: ${fileRow.originalName}\nRuta local: ${fileRow.relativePath}`;
  }

  const mergedPrompt = composePrompt(
    role.detail,
    nextTaskPromptTemplate,
    nextTaskInput,
    fileContext
  );
  const task = {
    id: randomUUID(),
    agentId: nextAgentId,
    taskPromptTemplate: nextTaskPromptTemplate,
    taskInput: nextTaskInput,
    fileId: nextFileId || null,
    integrationId: nextIntegrationId || null,
    responseContactId: nextReplyRoutingMode === "contact" ? nextResponseContactId : null,
    replyRoutingMode: nextReplyRoutingMode,
    allowedGroupContactIds: nextAllowedGroupContactIds,
    scheduleEnabled: schedule.scheduleEnabled,
    scheduleDays: schedule.scheduleDays,
    scheduleTime: schedule.scheduleTime,
    scheduleTimezone: schedule.scheduleTimezone,
    nextRunAt: schedule.nextRunAt,
    scheduleLastRunAt: null,
    scheduleLastStatus: null,
    scheduleLastError: null,
    mergedPrompt,
    status: schedule.scheduleEnabled ? "queued" : "draft",
    queuedAt: schedule.scheduleEnabled ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };

  const { tasks: tasksRepo } = getRepositories();
  const tasks = await tasksRepo.list();
  tasks.push(task);
  await tasksRepo.saveAll(tasks);
  return task;
}

async function getTaskById(taskId) {
  const tasks = await listTasks();
  return tasks.find((task) => task.id === taskId) || null;
}

async function updateTask(
  taskId,
  {
    agentId,
    taskPromptTemplate,
    taskInput,
    fileId,
    integrationId,
    responseContactId,
    replyRoutingMode,
    allowedGroupContactIds,
    scheduleEnabled,
    scheduleDays,
    scheduleTime,
    scheduleTimezone,
  }
) {
  const nextAgentId = normalizeText(agentId);
  const nextTaskPromptTemplate = normalizeText(taskPromptTemplate);
  const nextTaskInput = normalizeText(taskInput);
  const nextFileId = normalizeText(fileId);
  const nextIntegrationId = normalizeText(integrationId);
  const nextResponseContactId = normalizeText(responseContactId);
  const nextReplyRoutingMode = normalizeReplyRoutingMode(replyRoutingMode, nextResponseContactId);
  const nextAllowedGroupContactIds = normalizeIdList(allowedGroupContactIds);
  const schedule = buildSchedulePayload({
    scheduleEnabled,
    scheduleDays,
    scheduleTime,
    scheduleTimezone,
  });

  if (!nextAgentId) throw new Error("Debes seleccionar un agente.");
  if (!nextTaskPromptTemplate) {
    throw new Error("La plantilla de tarea es obligatoria.");
  }
  if (!nextTaskInput) throw new Error("El input de tarea es obligatorio.");

  const agent = await agentsService.getAgentById(nextAgentId);
  if (!agent) throw new Error("Agente invalido.");

  const role = await rolesService.getRoleById(agent.roleId);
  if (!role) throw new Error("El agente seleccionado no tiene rol valido.");
  if (nextIntegrationId) {
    const integration = await integrationsService.getIntegrationById(nextIntegrationId);
    if (!integration) throw new Error("Integracion API invalida.");
  }

  if (nextReplyRoutingMode === "contact") {
    if (!nextResponseContactId) {
      throw new Error("Debes seleccionar un contacto destino de respuesta o usar Sin ruteo.");
    }
    const targetContact = await contactsService.getContactById(nextResponseContactId);
    if (!targetContact) {
      throw new Error("Contacto destino de respuesta invalido.");
    }
  }
  if (nextAllowedGroupContactIds.length > 0) {
    const allContacts = await contactsService.listContacts();
    for (const contactId of nextAllowedGroupContactIds) {
      const group = allContacts.find((c) => c.id === contactId);
      if (!group || String(group.type || "contact") !== "group") {
        throw new Error("La lista de grupos permitidos contiene un grupo invalido.");
      }
    }
  }

  let fileContext = "";
  if (nextFileId) {
    const fileRow = await filesService.getFileById(nextFileId);
    if (!fileRow) throw new Error("Archivo seleccionado invalido.");
    fileContext = `Nombre: ${fileRow.originalName}\nRuta local: ${fileRow.relativePath}`;
  }

  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");
  const nextStatus = schedule.scheduleEnabled ? "queued" : "draft";
  const nowIso = new Date().toISOString();

  tasks[index] = {
    ...tasks[index],
    agentId: nextAgentId,
    taskPromptTemplate: nextTaskPromptTemplate,
    taskInput: nextTaskInput,
    fileId: nextFileId || null,
    integrationId: nextIntegrationId || null,
    responseContactId: nextReplyRoutingMode === "contact" ? nextResponseContactId : null,
    replyRoutingMode: nextReplyRoutingMode,
    allowedGroupContactIds: nextAllowedGroupContactIds,
    scheduleEnabled: schedule.scheduleEnabled,
    scheduleDays: schedule.scheduleDays,
    scheduleTime: schedule.scheduleTime,
    scheduleTimezone: schedule.scheduleTimezone,
    nextRunAt: schedule.nextRunAt,
    scheduleLastRunAt: null,
    scheduleLastStatus: null,
    scheduleLastError: null,
    mergedPrompt: composePrompt(
      role.detail,
      nextTaskPromptTemplate,
      nextTaskInput,
      fileContext
    ),
    status: nextStatus,
    queuedAt: nextStatus === "queued" ? nowIso : null,
    startedAt: null,
    executedAt: null,
    executionResult: null,
    executionError: null,
    modelOutputRaw: null,
    modelOutputParsed: null,
    executedActions: [],
    executionLogs: [],
    updatedAt: nowIso,
  };

  await tasksRepo.saveAll(tasks);
  if (nextReplyRoutingMode === "none") {
    await taskReplyRoutesService.disableRoutesByTaskId(taskId);
  }
  return tasks[index];
}

async function deleteTask(taskId) {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  const [removed] = tasks.splice(index, 1);
  await tasksRepo.saveAll(tasks);
  return removed;
}

async function queueTask(taskId) {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  const current = tasks[index];
  if (current.status !== "draft") {
    throw new Error("Solo se puede encolar una tarea en estado draft.");
  }

  tasks[index] = {
    ...current,
    status: "queued",
    queuedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await tasksRepo.saveAll(tasks);
  return tasks[index];
}

async function resolveContact(contactRaw) {
  const lookup = normalizeText(contactRaw);
  if (!lookup) throw new Error("Accion send_whatsapp sin contacto.");

  const contacts = await contactsService.listContacts();
  const normalizedLookup = contactsService.normalizePhone(lookup);
  const normalizedGroupLookup = contactsService.normalizeGroupId(lookup);

  const directPhone = contacts.find((c) => c.type === "contact" && c.phone === normalizedLookup);
  if (directPhone) return directPhone;
  const directGroup = contacts.find((c) => c.type === "group" && c.groupId === normalizedGroupLookup);
  if (directGroup) return directGroup;

  const byName = contacts.find(
    (c) => String(c.name || "").trim().toLowerCase() === lookup.toLowerCase()
  );
  if (byName) return byName;

  const byPartial = contacts.find((c) =>
    String(c.name || "").toLowerCase().includes(lookup.toLowerCase())
  );
  if (byPartial) return byPartial;

  throw new Error(`No se encontro contacto en Agenda: ${lookup}`);
}

async function resolveContactFromAction(action) {
  const contactId = normalizeText(action && action.contactId);
  if (contactId) {
    const byId = await contactsService.getContactById(contactId);
    if (byId) return byId;
  }
  return resolveContact(action && action.contact);
}

async function resolveIntegrationFromAction(task, action) {
  const integrationId = normalizeText(action && action.integrationId) || normalizeText(task.integrationId);
  const integrationName = normalizeText(action && action.integrationName);
  if (integrationId) {
    const byId = await integrationsService.getIntegrationById(integrationId);
    if (byId) return byId;
  }
  if (integrationName) {
    const list = await integrationsService.listIntegrations();
    const byName = list.find(
      (item) => String(item.name || "").trim().toLowerCase() === integrationName.toLowerCase()
    );
    if (byName) return byName;
  }
  throw new Error("No se pudo resolver la integracion API para call_external_api.");
}

async function executeExternalApiAction(task, action) {
  const integration = await resolveIntegrationFromAction(task, action);
  if (integration.isActive === false) {
    throw new Error(`La integracion esta inactiva: ${integration.name}`);
  }

  const method = String(integration.method || "GET").toUpperCase();
  const query = normalizeActionObject(action && action.query);
  const body = normalizeActionObject(action && action.body);
  const extraHeaders = normalizeActionObject(action && action.headers);

  const urlObj = new URL(integration.url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || String(value) === "") continue;
    urlObj.searchParams.set(key, String(value));
  }

  const headers = {
    ...(integration.headers || {}),
    ...extraHeaders,
  };
  let payloadBody = null;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    payloadBody = JSON.stringify(body || {});
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const controller = new AbortController();
  const timeoutMs = Number.parseInt(String(integration.timeoutMs || 15000), 10) || 15000;
  const timeoutHandle = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(urlObj.toString(), {
      method,
      headers,
      body: payloadBody,
      signal: controller.signal,
    });
    const rawText = await response.text();
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      json = null;
    }
    if (!response.ok) {
      const detail = json ? JSON.stringify(json) : rawText;
      throw new Error(
        `Error API ${integration.name} (${response.status}): ${String(detail || "sin detalle")}`
      );
    }

    return {
      integrationId: integration.id,
      integrationName: integration.name,
      method,
      url: urlObj.toString(),
      statusCode: response.status,
      responseJson: json,
      responseText: json ? null : rawText.slice(0, 20000),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function executeApiActions(task, parsed) {
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const apiActions = actions
    .map((action, index) => ({ action: action || {}, index }))
    .filter((item) => normalizeText(item.action.type).toLowerCase() === "call_external_api");
  const results = [];

  for (const item of apiActions) {
    const result = await executeExternalApiAction(task, item.action);
    results.push({
      index: item.index,
      type: "call_external_api",
      ok: true,
      result,
    });
  }
  return results;
}

function buildApiResultsFollowupPrompt({
  mergedPrompt,
  runtimeFileContext,
  contactsReferenceText,
  integrationsReferenceText,
  apiResults,
}) {
  const compactResults = Array.isArray(apiResults)
    ? apiResults.map((item) => {
        const result = item && item.result ? item.result : {};
        const jsonString = result.responseJson ? JSON.stringify(result.responseJson) : "";
        const compactJson = jsonString ? toPromptPreview(jsonString, 60000) : "";
        const compactText = result.responseText ? toPromptPreview(result.responseText, 60000) : "";
        return {
          integrationId: result.integrationId,
          integrationName: result.integrationName,
          method: result.method,
          url: result.url,
          statusCode: result.statusCode,
          responseJsonSnippet: compactJson || null,
          responseText: compactText || null,
        };
      })
    : [];
  return [
    mergedPrompt,
    runtimeFileContext || "",
    contactsReferenceText || "",
    integrationsReferenceText || "",
    "",
    "Resultado real de llamadas call_external_api:",
    JSON.stringify(compactResults),
    "",
    "Ahora responde SOLO con acciones finales para ejecutar.",
    "No devuelvas call_external_api nuevamente en este paso.",
    "Esquema:",
    '{"result_summary":"texto", "actions":[{"type":"send_whatsapp","contactId":"id_opcional","contact":"nombre o numero","message":"texto"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractVendorNamesFromApiResults(apiResults) {
  const names = new Set();
  const rows = Array.isArray(apiResults) ? apiResults : [];
  for (const item of rows) {
    const result = item && item.result ? item.result : {};
    const payload = result.responseJson;
    const dataRows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    for (const row of dataRows) {
      const vendor =
        normalizeText(row && (row.vendedora || row.vendedor || row.seller || row.vendor));
      const key = normalizeCompareText(vendor);
      if (key) names.add(key);
    }
  }
  return names;
}

function buildAllowedContactIdsByVendorNames(contacts, vendorNameKeys) {
  const allowed = new Set();
  if (!vendorNameKeys || vendorNameKeys.size === 0) return allowed;
  const rows = Array.isArray(contacts) ? contacts : [];
  for (const contact of rows) {
    if (String(contact.type || "contact") !== "contact") continue;
    const key = normalizeCompareText(contact.name);
    if (!key) continue;
    if (vendorNameKeys.has(key)) {
      allowed.add(contact.id);
      continue;
    }
    for (const vendorKey of vendorNameKeys) {
      if (key.includes(vendorKey) || vendorKey.includes(key)) {
        allowed.add(contact.id);
        break;
      }
    }
  }
  return allowed;
}

async function executeSendWhatsAppAction(task, action, context, resolvedContact) {
  const contact = resolvedContact || (await resolveContactFromAction(action));
  const contactTarget = contactsService.getContactMessageTarget(contact);
  const roleDetail = normalizeText(context && context.role ? context.role.detail : "");
  const message = normalizeText(action.message);
  if (!message) throw new Error("Accion send_whatsapp sin mensaje.");
  const withTraceTag = parseBool(process.env.TASK_REPLY_APPEND_TID || "false");
  const tidTag = task && task.id ? `[TID:${String(task.id).slice(0, 8)}]` : "";
  const finalMessage = withTraceTag && tidTag ? `${message}\n\n${tidTag}` : message;

  const sendResult = await whatsappGateway.sendMessage(contactTarget, finalMessage);
  await messagesService.addMessage({
    contactPhone: contactTarget,
    direction: "out",
    text: finalMessage,
    status: "sent",
  });

  let replyRoute = null;
  if (task && task.replyRoutingMode === "contact") {
    if (!task.responseContactId) {
      throw new Error("La tarea tiene ruteo a contacto pero no tiene responseContactId.");
    }
    const destination = await contactsService.getContactById(task.responseContactId);
    if (!destination) {
      throw new Error("No se pudo resolver el contacto destino de respuesta.");
    }
    const destinationTarget = contactsService.getContactMessageTarget(destination);
    replyRoute = await taskReplyRoutesService.upsertRouteForTask({
      taskId: task.id,
      sourcePhone: contactTarget,
      destinationContactId: destination.id,
      destinationPhone: destinationTarget,
      originalMessage: finalMessage,
      lastOutboundMessageId: String(sendResult && sendResult.messageId ? sendResult.messageId : ""),
      lastOutboundAt: new Date().toISOString(),
    });
  }

  return {
    contactId: contact.id,
    contactName: contact.name,
    phone: contactTarget,
    finalMessage,
    sent: true,
    outboundMessageId: sendResult && sendResult.messageId ? sendResult.messageId : null,
    traceTagEnabled: withTraceTag,
    roleDetailPrepended: false,
    roleDetailExpected: roleDetail || null,
    modelMessageStartsWithRoleDetail:
      Boolean(roleDetail) &&
      normalizeCompareText(finalMessage).startsWith(normalizeCompareText(roleDetail)),
    replyRoute: replyRoute
      ? {
          routeId: replyRoute.id,
          destinationContactId: replyRoute.destinationContactId,
          destinationPhone: replyRoute.destinationPhone,
        }
      : null,
  };
}

async function executeActions(task, parsed, context) {
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const results = [];
  const policy = (context && context.actionPolicy) || null;

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i] || {};
    const type = normalizeText(action.type).toLowerCase();

    if (type === "send_whatsapp") {
      let resolvedContact = null;
      if (policy && policy.onlyVendors === true) {
        try {
          resolvedContact = await resolveContactFromAction(action);
        } catch (error) {
          results.push({
            index: i,
            type,
            ok: true,
            skipped: true,
            reason: `Contacto no resolvible para politica de vendedoras: ${error.message}`,
          });
          continue;
        }
        const isGroup = String(resolvedContact.type || "contact") === "group";
        if (isGroup) {
          const allowedGroups = policy.allowedGroupContactIds || new Set();
          if (!allowedGroups.has(resolvedContact.id)) {
            results.push({
              index: i,
              type,
              ok: true,
              skipped: true,
              reason: `Grupo omitido por politica de grupos permitidos (${resolvedContact.name})`,
              contactId: resolvedContact.id,
            });
            continue;
          }
        } else if (!policy.allowedVendorContactIds.has(resolvedContact.id)) {
          results.push({
            index: i,
            type,
            ok: true,
            skipped: true,
            reason: `Contacto omitido por politica de vendedoras (${resolvedContact.name})`,
            contactId: resolvedContact.id,
          });
          continue;
        }
      }
      const result = await executeSendWhatsAppAction(task, action, context, resolvedContact);
      results.push({ index: i, type, result, ok: true });
      continue;
    }

    results.push({
      index: i,
      type,
      ok: false,
      error: `Accion no soportada: ${type || "(vacia)"}`,
    });
  }

  return results;
}

async function executeTask(taskId, options = {}) {
  const trigger = normalizeText(options.trigger) || "manual";
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  let task = tasks[index];
  const allowedStatuses =
    trigger === "scheduled" ? ["queued", "done", "failed"] : ["queued"];
  if (trigger !== "scheduled" && task.scheduleEnabled) {
    throw new Error("La tarea tiene programacion activa. Se ejecuta automaticamente.");
  }
  if (!allowedStatuses.includes(task.status)) {
    throw new Error(
      trigger === "scheduled"
        ? "La tarea programada debe estar en estado queued/done/failed."
        : "Solo se puede ejecutar manualmente una tarea en estado queued."
    );
  }
  if (trigger === "scheduled" && task.status !== "queued") {
    task = {
      ...task,
      status: "queued",
      updatedAt: new Date().toISOString(),
    };
    task = appendLog(task, "scheduler_prepare", "ok", "Tarea preparada para ejecucion programada", {
      previousStatus: tasks[index].status,
    });
    tasks[index] = task;
    await tasksRepo.saveAll(tasks);
  }

  const agent = await agentsService.getAgentById(task.agentId);
  if (!agent) throw new Error("Agente invalido en la tarea.");
  const role = await rolesService.getRoleById(agent.roleId);
  const model = await modelsService.getModelById(agent.modelId);
  if (!model) throw new Error("Modelo invalido en el agente.");

  task = appendLog(
    task,
    "init",
    "ok",
    trigger === "scheduled" ? "Inicio de ejecucion programada" : "Inicio de ejecucion manual",
    {
    taskId,
    agentId: agent.id,
    modelId: model.id,
    trigger,
  });

  task = {
    ...task,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks[index] = task;
  await tasksRepo.saveAll(tasks);

  try {
    let runtimeFileContext = "";
    let fileAttachment = null;
    const todayContextText = buildTodayContextText("America/Argentina/Buenos_Aires");
    const availableContacts = await contactsService.listContacts();
    const availableIntegrations = await integrationsService.listIntegrations();
    const contactsReferenceText = buildContactsReferenceText(availableContacts);
    const integrationsReferenceText = buildIntegrationsReferenceText(availableIntegrations);
    if (task.fileId) {
      const fileContext = await filesService.getFileRuntimeContext(task.fileId);
      if (fileContext) {
        const meta = [
          `Nombre: ${fileContext.originalName}`,
          `Ruta local: ${fileContext.relativePath}`,
          `MimeType: ${fileContext.mimeType || ""}`,
          `Tamano bytes: ${fileContext.sizeBytes}`,
        ].join("\n");

        runtimeFileContext = `\n\nContexto de archivo disponible:\n${meta}`;
        if (fileContext.contentText) {
          runtimeFileContext += `\n\nContenido del archivo (texto):\n${fileContext.contentText}`;
        }
        if (fileContext.note) {
          runtimeFileContext += `\n\nNota archivo: ${fileContext.note}`;
        }

        if (
          model.provider === "openai" &&
          fileContext.absolutePath &&
          String(fileContext.extension || "").toLowerCase() === ".pdf"
        ) {
          fileAttachment = {
            absolutePath: fileContext.absolutePath,
            originalName: fileContext.originalName,
            mimeType: fileContext.mimeType,
            extension: fileContext.extension,
          };
        }

        task = appendLog(task, "file_context", "ok", "Contexto de archivo preparado", {
          fileId: fileContext.fileId,
          hasContentText: Boolean(fileContext.contentText),
          note: fileContext.note,
          willAttachToModel: Boolean(fileAttachment),
          extension: fileContext.extension || "",
        });
      }
    }

    const modelPrompt = [
      task.mergedPrompt,
      todayContextText,
      runtimeFileContext,
      contactsReferenceText,
      integrationsReferenceText,
      "",
      buildActionContractPrompt(),
    ]
      .filter(Boolean)
      .join("\n\n");
    task = appendLog(task, "prompt_prepared", "ok", "Prompt preparado para modelo", {
      promptLength: modelPrompt.length,
      promptPreview: toPromptPreview(modelPrompt),
    });

    task = appendLog(task, "model_call", "running", "Llamando al modelo", {
      provider: model.provider,
      modelId: model.modelId,
    });
    tasks[index] = task;
    await tasksRepo.saveAll(tasks);

    const output = await modelTestService.testModel({
      envKey: model.envKey,
      modelName: model.name,
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      message: modelPrompt,
      fileAttachment,
    });

    task = appendLog(task, "model_call", "ok", "Respuesta de modelo recibida", {
      outputLength: String(output || "").length,
    });

    let parsed = parseModelOutputToJson(output);
    task = appendLog(task, "parse_output", "ok", "Salida parseada a JSON", {
      keys: Object.keys(parsed || {}),
      actionsCount: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
    });

    const hasApiAction = Array.isArray(parsed.actions)
      && parsed.actions.some(
        (a) => normalizeText(a && a.type).toLowerCase() === "call_external_api"
      );
    let actionPolicy = null;
    if (hasApiAction) {
      task = appendLog(
        task,
        "api_actions",
        "running",
        "Ejecutando acciones call_external_api",
        {
          count: parsed.actions.filter(
            (a) => normalizeText(a && a.type).toLowerCase() === "call_external_api"
          ).length,
        }
      );
      tasks[index] = task;
      await tasksRepo.saveAll(tasks);

      const apiResults = await executeApiActions(task, parsed);
      task = appendLog(task, "api_actions", "ok", "Acciones API ejecutadas", {
        count: apiResults.length,
      });
      for (const item of apiResults) {
        task = appendLog(task, "api_action", "ok", "Resultado call_external_api", item.result);
      }

      const followupPrompt = buildApiResultsFollowupPrompt({
        mergedPrompt: task.mergedPrompt,
        runtimeFileContext: [todayContextText, runtimeFileContext].filter(Boolean).join("\n\n"),
        contactsReferenceText,
        integrationsReferenceText,
        apiResults,
      });
      task = appendLog(task, "prompt_followup_prepared", "ok", "Prompt follow-up preparado", {
        promptLength: followupPrompt.length,
        promptPreview: toPromptPreview(followupPrompt),
      });
      task = appendLog(task, "model_call_followup", "running", "Llamando al modelo con resultados API", {
        provider: model.provider,
        modelId: model.modelId,
      });
      tasks[index] = task;
      await tasksRepo.saveAll(tasks);

      const followupOutput = await modelTestService.testModel({
        envKey: model.envKey,
        modelName: model.name,
        provider: model.provider,
        modelId: model.modelId,
        baseUrl: model.baseUrl,
        message: followupPrompt,
      });
      task = appendLog(task, "model_call_followup", "ok", "Respuesta follow-up recibida", {
        outputLength: String(followupOutput || "").length,
      });
      parsed = parseModelOutputToJson(followupOutput);
      task = appendLog(task, "parse_output_followup", "ok", "Salida follow-up parseada", {
        keys: Object.keys(parsed || {}),
        actionsCount: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
      });

      const vendorNameKeys = extractVendorNamesFromApiResults(apiResults);
      if (vendorNameKeys.size > 0) {
        const allowedVendorContactIds = buildAllowedContactIdsByVendorNames(
          availableContacts,
          vendorNameKeys
        );
        const allowedGroupContactIds = new Set(normalizeIdList(task.allowedGroupContactIds));
        actionPolicy = {
          onlyVendors: true,
          allowedVendorContactIds,
          allowedGroupContactIds,
        };
        task = appendLog(
          task,
          "vendor_policy",
          "ok",
          "Politica de envio por vendedoras aplicada",
          {
            vendorNames: Array.from(vendorNameKeys),
            allowedVendorContactIds: Array.from(allowedVendorContactIds),
            allowedGroupContactIds: Array.from(allowedGroupContactIds),
          }
        );
      }
    }

    if (requiresWhatsAppAction(task)) {
      const initialActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const hasWhatsAppAction = initialActions.some(
        (a) => normalizeText(a && a.type).toLowerCase() === "send_whatsapp"
      );
      if (!hasWhatsAppAction) {
        const retryPrompt = buildForceWhatsAppRetryPrompt({
          mergedPrompt: task.mergedPrompt,
          runtimeFileContext: [todayContextText, runtimeFileContext].filter(Boolean).join("\n\n"),
          contactsReferenceText,
          integrationsReferenceText,
          lastResultSummary: parsed.result_summary,
        });
        task = appendLog(
          task,
          "prompt_retry_prepared",
          "ok",
          "Prompt de reintento preparado",
          {
            promptLength: retryPrompt.length,
            promptPreview: toPromptPreview(retryPrompt),
          }
        );
        task = appendLog(
          task,
          "model_call_retry",
          "running",
          "Reintentando modelo para forzar accion send_whatsapp",
          {
            provider: model.provider,
            modelId: model.modelId,
          }
        );
        tasks[index] = task;
        await tasksRepo.saveAll(tasks);

        const retryOutput = await modelTestService.testModel({
          envKey: model.envKey,
          modelName: model.name,
          provider: model.provider,
          modelId: model.modelId,
          baseUrl: model.baseUrl,
          message: retryPrompt,
          fileAttachment,
        });
        task = appendLog(task, "model_call_retry", "ok", "Respuesta de reintento recibida", {
          outputLength: String(retryOutput || "").length,
        });

        const retryParsed = parseModelOutputToJson(retryOutput);
        task = appendLog(task, "parse_output_retry", "ok", "Salida de reintento parseada", {
          keys: Object.keys(retryParsed || {}),
          actionsCount: Array.isArray(retryParsed.actions) ? retryParsed.actions.length : 0,
        });
        parsed = retryParsed;
      }
    }

    const actionResults = await executeActions(task, parsed, {
      agent,
      role,
      actionPolicy,
    });
    const failedActions = actionResults.filter((a) => !a.ok);
    const okActions = actionResults.filter((a) => a.ok);

    if (requiresWhatsAppAction(task)) {
      const hasWhatsAppAction = okActions.some((a) => a.type === "send_whatsapp");
      if (!hasWhatsAppAction) {
        throw new Error(
          "La tarea requiere accion WhatsApp pero el modelo no devolvio send_whatsapp."
        );
      }
    }

    for (const item of okActions) {
      task = appendLog(task, "action", "ok", `Accion ejecutada: ${item.type}`, item.result);
    }
    for (const item of failedActions) {
      task = appendLog(task, "action", "error", item.error, item);
    }

    if (failedActions.length > 0) {
      throw new Error(`Hay acciones no soportadas o fallidas (${failedActions.length}).`);
    }

    task = {
      ...task,
      status: "done",
      executedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionResult: normalizeText(parsed.result_summary) || String(output || ""),
      executionError: null,
      modelOutputRaw: String(output || ""),
      modelOutputParsed: parsed,
      executedActions: actionResults,
    };
    task = appendLog(task, "finish", "ok", "Ejecucion finalizada correctamente", {
      executedActions: actionResults.length,
    });

    tasks[index] = task;
    await tasksRepo.saveAll(tasks);
    return task;
  } catch (error) {
    task = {
      ...task,
      status: "failed",
      executedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionError: error.message,
    };
    task = appendLog(task, "finish", "error", "Ejecucion finalizada con error", {
      error: error.message,
    });
    tasks[index] = task;
    await tasksRepo.saveAll(tasks);
    throw new Error(`Fallo la ejecucion: ${error.message}`);
  }
}

async function listDueScheduledTasks(nowDate = new Date()) {
  const nowMs = nowDate.getTime();
  const tasks = await listTasks();
  return tasks.filter((task) => {
    if (!task.scheduleEnabled) return false;
    if (!task.nextRunAt) return false;
    if (task.status === "draft" || task.status === "running") return false;
    const nextMs = new Date(task.nextRunAt).getTime();
    return Number.isFinite(nextMs) && nextMs <= nowMs;
  });
}

async function runScheduledTask(taskId, nowDate = new Date()) {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  const task = tasks[index];
  if (!task.scheduleEnabled) return null;
  const days = normalizeScheduleDays(task.scheduleDays);
  const { hour, minute } = validateScheduleTime(task.scheduleTime);
  const timezone = validateTimezone(task.scheduleTimezone);

  let runStatus = "ok";
  let runError = null;
  try {
    await executeTask(taskId, { trigger: "scheduled" });
  } catch (error) {
    runStatus = "error";
    runError = error.message;
  }

  const refreshed = await listTasks();
  const refreshedIndex = refreshed.findIndex((row) => row.id === taskId);
  if (refreshedIndex < 0) return null;

  const updated = {
    ...refreshed[refreshedIndex],
    scheduleLastRunAt: nowDate.toISOString(),
    scheduleLastStatus: runStatus,
    scheduleLastError: runError,
    nextRunAt: computeNextRunAt(
      { days, hour, minute, timezone },
      nowDate
    ),
    updatedAt: new Date().toISOString(),
  };
  updated.executionLogs = Array.isArray(updated.executionLogs) ? updated.executionLogs : [];
  updated.executionLogs.push({
    at: new Date().toISOString(),
    step: "scheduler",
    status: runStatus === "ok" ? "ok" : "error",
    message:
      runStatus === "ok"
        ? "Ejecucion programada finalizada"
        : "Ejecucion programada con error",
    data: {
      nextRunAt: updated.nextRunAt,
      timezone,
      scheduleTime: task.scheduleTime,
      scheduleDays: task.scheduleDays,
      error: runError,
    },
  });

  refreshed[refreshedIndex] = updated;
  await tasksRepo.saveAll(refreshed);

  if (runStatus !== "ok") {
    throw new Error(runError || "Fallo ejecucion programada.");
  }
  return updated;
}

async function clearTaskLogs(taskId) {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  const current = tasks[index];
  tasks[index] = {
    ...current,
    executionLogs: [],
    executedActions: [],
    executionResult: null,
    executionError: null,
    modelOutputRaw: null,
    modelOutputParsed: null,
    startedAt: null,
    executedAt: null,
    updatedAt: new Date().toISOString(),
  };

  await tasksRepo.saveAll(tasks);
  return tasks[index];
}

module.exports = {
  listTasks,
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  queueTask,
  executeTask,
  listDueScheduledTasks,
  runScheduledTask,
  clearTaskLogs,
  composePrompt,
};
