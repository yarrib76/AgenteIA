const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const agentsService = require("../agent/agents.service");
const rolesService = require("../agent/roles.service");
const usersService = require("../auth/users.service");
const internalChatGroupsService = require("../internal-chat/internal-chat-groups.service");
const filesService = require("../file/files.service");
const modelsService = require("../model/models.service");
const modelTestService = require("../model/model-test.service");
const contactsService = require("../agenda/contacts.service");
const integrationsService = require("../integration/api-integrations.service");
const messagingGateway = require("../messaging/messaging.gateway");
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

function normalizeActionType(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === "send_whatsapp") return "send_message";
  return type;
}

function getExecutionTimeoutMs() {
  const parsed = Number.parseInt(String(process.env.TASK_EXECUTION_TIMEOUT_MS || "240000"), 10);
  if (!Number.isFinite(parsed) || parsed < 10000) return 240000;
  return parsed;
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout ${label} tras ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function buildActionContractPrompt({ allowApiActions = false } = {}) {
  if (allowApiActions) {
    return [
      "Responde SOLO en JSON valido, sin markdown.",
      "Esquema de salida:",
      '{"result_summary":"texto", "actions":[{"type":"call_external_api","integrationId":"id_integracion","query":{},"body":{},"evidence":{"source":"texto","reason":"texto"}},{"type":"send_message","contactId":"id_opcional","contact":"nombre o numero","message":"texto","evidence":{"source":"texto","reason":"texto","rows":[{"numero_pedido":0,"vendedora":"texto","vencida":"SI|NO","notas_presentes":true}]}}] }',
      "Si no hay accion, enviar actions: [].",
      "Usa call_external_api solo cuando necesites consultar APIs externas.",
      "Si la accion es send_message, el campo message debe comenzar exactamente con el detalle del rol del agente.",
      "Si hay lista de contactos disponible, prioriza devolver contactId.",
      "Si hay lista de integraciones disponible, prioriza devolver integrationId.",
      "Cada accion debe incluir evidence breve y verificable usando SOLO datos del input.",
      "No inventes contactos inexistentes.",
    ].join("\n");
  }

  return [
    "Responde SOLO en JSON valido, sin markdown.",
    "Esquema de salida:",
    '{"result_summary":"texto", "actions":[{"type":"send_message","contactId":"id_opcional","contact":"nombre o numero","message":"texto","evidence":{"source":"texto","reason":"texto","rows":[{"numero_pedido":0,"vendedora":"texto","vencida":"SI|NO","notas_presentes":true}]}}] }',
    "Si no hay accion, enviar actions: [].",
    "Si la accion es send_message, el campo message debe comenzar exactamente con el detalle del rol del agente.",
    "Si hay lista de contactos disponible, prioriza devolver contactId.",
    "Cada accion debe incluir evidence breve y verificable usando SOLO datos del input.",
    "No inventes contactos inexistentes.",
  ].join("\n");
}

function buildForceMessageRetryPrompt({
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
    "La tarea requiere enviar un mensaje.",
    "Responde SOLO en JSON valido, sin markdown.",
    "Devuelve EXACTAMENTE 1 accion en actions con type=send_message.",
    "No permitas actions vacio.",
    "Si result_summary ya contiene el contenido, usalo para el campo message.",
    "Si hay lista de contactos, devuelve contactId para evitar ambiguedad.",
    "No devuelvas call_external_api en este reintento.",
    "Esquema estricto:",
    '{"result_summary":"texto", "actions":[{"type":"send_message","contactId":"id_opcional","contact":"nombre o numero","message":"texto","evidence":{"source":"texto","reason":"texto","rows":[{"numero_pedido":0,"vendedora":"texto","vencida":"SI|NO","notas_presentes":true}]}}]}',
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
    whatsappTarget: contactsService.getContactMessageTarget(c, "whatsapp"),
    telegramTarget: contactsService.getContactMessageTarget(c, "telegram"),
  }));
  return [
    "Contactos disponibles (usar contactId cuando corresponda):",
    JSON.stringify(compact),
  ].join("\n");
}

function buildUsersReferenceText(users) {
  const rows = Array.isArray(users) ? users : [];
  if (rows.length === 0) return "";
  const compact = rows.slice(0, 200).map((u) => ({
    id: u.id,
    name: u.name || "",
    email: u.email,
  }));
  return [
    "Usuarios internos disponibles (usar userId o contactId cuando corresponda):",
    JSON.stringify(compact),
  ].join("\n");
}

function normalizeInternalTargetId(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  return "user:" + raw;
}

async function resolveInternalTaskTarget(value) {
  const normalized = normalizeInternalTargetId(value);
  if (!normalized) return null;
  const [kind, rawId] = normalized.split(":");
  const entityId = normalizeText(rawId);
  if (!entityId) return null;
  if (kind === "group") {
    const group = await internalChatGroupsService.getGroupById(entityId);
    if (!group) return null;
    return {
      type: "group",
      id: group.id,
      storageId: "group:" + group.id,
      target: "group:" + group.id,
      name: group.name,
      label: "[Grupo] " + group.name,
    };
  }
  const user = await usersService.getUserById(entityId);
  if (!user) return null;
  return {
    type: "user",
    id: user.id,
    storageId: "user:" + user.id,
    target: user.id,
    name: user.name || user.email,
    email: user.email,
    label: "[Usuario] " + (user.name ? (user.name + " (" + user.email + ")") : user.email),
  };
}

async function resolveInternalTargetFromAction(action, fallbackTargetId = "") {
  const explicitGroupId = normalizeText(action && (action.groupId || action.group));
  if (explicitGroupId) {
    return resolveInternalTaskTarget("group:" + explicitGroupId);
  }

  const explicitContactId = normalizeText(action && action.contactId);
  if (explicitContactId) {
    const byPrefixed = await resolveInternalTaskTarget(explicitContactId);
    if (byPrefixed) return byPrefixed;
    const byLegacyUser = await resolveInternalTaskTarget("user:" + explicitContactId);
    if (byLegacyUser) return byLegacyUser;
    const byLegacyGroup = await resolveInternalTaskTarget("group:" + explicitContactId);
    if (byLegacyGroup) return byLegacyGroup;
  }

  const explicitUserId = normalizeText(action && action.userId);
  if (explicitUserId) {
    const byUserId = await resolveInternalTaskTarget("user:" + explicitUserId);
    if (byUserId) return byUserId;
  }

  const contactLookup = normalizeText(action && (action.contact || action.user));
  if (contactLookup) {
    const byEmail = usersService.getUserByEmail
      ? await usersService.getUserByEmail(contactLookup)
      : null;
    if (byEmail) {
      return {
        type: "user",
        id: byEmail.id,
        storageId: "user:" + byEmail.id,
        target: byEmail.id,
        name: byEmail.name || byEmail.email,
        email: byEmail.email,
        label: "[Usuario] " + (byEmail.name ? (byEmail.name + " (" + byEmail.email + ")") : byEmail.email),
      };
    }
    const users = await usersService.listUsers();
    const normalizedLookupName = contactLookup.toLowerCase();
    const byName = users.find((user) => String(user.name || "").trim().toLowerCase() === normalizedLookupName)
      || users.find((user) => String(user.name || "").toLowerCase().includes(normalizedLookupName));
    if (byName) {
      return {
        type: "user",
        id: byName.id,
        storageId: "user:" + byName.id,
        target: byName.id,
        name: byName.name || byName.email,
        email: byName.email,
        label: "[Usuario] " + (byName.name ? (byName.name + " (" + byName.email + ")") : byName.email),
      };
    }
    const groups = await internalChatGroupsService.listGroups();
    const normalizedLookup = contactLookup.toLowerCase();
    const group = groups.find((item) => String(item.name || "").trim().toLowerCase() === normalizedLookup)
      || groups.find((item) => String(item.name || "").toLowerCase().includes(normalizedLookup));
    if (group) {
      return {
        type: "group",
        id: group.id,
        storageId: "group:" + group.id,
        target: "group:" + group.id,
        name: group.name,
        label: "[Grupo] " + group.name,
      };
    }
  }

  if (fallbackTargetId) {
    return resolveInternalTaskTarget(fallbackTargetId);
  }
  return null;
}

function buildInternalTargetsReferenceText(users, groups, responseContactId = "") {
  const compactUsers = (Array.isArray(users) ? users : []).slice(0, 200).map((u) => ({
    contactId: "user:" + u.id,
    type: "user",
    email: u.email,
  }));
  const compactGroups = (Array.isArray(groups) ? groups : []).slice(0, 200).map((g) => ({
    contactId: "group:" + g.id,
    type: "group",
    name: g.name,
    membersCount: g.membersCount || 0,
  }));
  const sections = [];
  const normalizedResponseId = normalizeInternalTargetId(responseContactId);
  if (normalizedResponseId.startsWith("user:")) {
    const responseUserId = normalizedResponseId.slice(5);
    const responseUser = (Array.isArray(users) ? users : []).find((u) => u.id === responseUserId);
    if (responseUser) {
      sections.push(
        "Usuario destino de respuesta para derivaciones posteriores:\n" + JSON.stringify({
          contactId: "user:" + responseUser.id,
          type: "user",
          name: responseUser.name || "",
          email: responseUser.email,
        })
      );
    }
  }
  if (compactUsers.length > 0) {
    sections.push(
      "Usuarios internos disponibles para send_message (usar contactId cuando corresponda):\n" + JSON.stringify(compactUsers)
    );
  }
  if (compactGroups.length > 0) {
    sections.push(
      "Grupos internos permitidos para send_message (usar contactId solo si corresponde enviar al grupo):\n" + JSON.stringify(compactGroups)
    );
  }
  return sections.join("\n\n");
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

function requiresMessagingAction(task) {
  const text = [
    task.taskPromptTemplate || "",
    task.taskInput || "",
    task.mergedPrompt || "",
  ]
    .join(" ")
    .toLowerCase();
  return text.includes("whatsapp") || text.includes("whatssap") || text.includes("telegram");
}

async function listTasks() {
  const { tasks: tasksRepo } = getRepositories();
  const activeChannel = await messagingGateway.getChannel();
  const tasks = await tasksRepo.list();
  const normalized = tasks.map((task) => {
    const responseContactIdRaw =
      normalizeText(task.responseContactId) || normalizeText(task.replyToContactId) || null;
    const responseContactId = activeChannel === "internal_chat"
      ? normalizeInternalTargetId(responseContactIdRaw)
      : responseContactIdRaw;
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
  const activeChannel = await messagingGateway.getChannel();
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
      throw new Error(
        activeChannel === "internal_chat"
          ? "Debes seleccionar un usuario o grupo destino de respuesta o usar Sin ruteo."
          : "Debes seleccionar un contacto destino de respuesta o usar Sin ruteo."
      );
    }
    if (activeChannel === "internal_chat") {
      const target = await resolveInternalTaskTarget(nextResponseContactId);
      if (!target || target.type !== "user") {
        throw new Error("Destino de respuesta invalido. Debe ser un usuario interno.");
      }
    } else {
      const targetContact = await contactsService.getContactById(nextResponseContactId);
      if (!targetContact) {
        throw new Error("Contacto destino de respuesta invalido.");
      }
    }
  }
  if (nextAllowedGroupContactIds.length > 0) {
    if (activeChannel === "internal_chat") {
      const internalGroups = await internalChatGroupsService.listGroups();
      for (const groupId of nextAllowedGroupContactIds) {
        const group = internalGroups.find((item) => item.id === groupId);
        if (!group) {
          throw new Error("La lista de grupos permitidos contiene un grupo interno invalido.");
        }
      }
    } else {
      const allContacts = await contactsService.listContacts();
      for (const contactId of nextAllowedGroupContactIds) {
        const group = allContacts.find((c) => c.id === contactId);
        if (!group || String(group.type || "contact") !== "group") {
          throw new Error("La lista de grupos permitidos contiene un grupo invalido.");
        }
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
    responseContactId: nextReplyRoutingMode === "contact" && activeChannel === "internal_chat"
      ? normalizeInternalTargetId(nextResponseContactId)
      : nextReplyRoutingMode === "contact" ? nextResponseContactId : null,
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
  const activeChannel = await messagingGateway.getChannel();
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
      throw new Error(
        activeChannel === "internal_chat"
          ? "Debes seleccionar un usuario o grupo destino de respuesta o usar Sin ruteo."
          : "Debes seleccionar un contacto destino de respuesta o usar Sin ruteo."
      );
    }
    if (activeChannel === "internal_chat") {
      const target = await resolveInternalTaskTarget(nextResponseContactId);
      if (!target || target.type !== "user") {
        throw new Error("Destino de respuesta invalido. Debe ser un usuario interno.");
      }
    } else {
      const targetContact = await contactsService.getContactById(nextResponseContactId);
      if (!targetContact) {
        throw new Error("Contacto destino de respuesta invalido.");
      }
    }
  }
  if (nextAllowedGroupContactIds.length > 0) {
    if (activeChannel === "internal_chat") {
      const internalGroups = await internalChatGroupsService.listGroups();
      for (const groupId of nextAllowedGroupContactIds) {
        const group = internalGroups.find((item) => item.id === groupId);
        if (!group) {
          throw new Error("La lista de grupos permitidos contiene un grupo interno invalido.");
        }
      }
    } else {
      const allContacts = await contactsService.listContacts();
      for (const contactId of nextAllowedGroupContactIds) {
        const group = allContacts.find((c) => c.id === contactId);
        if (!group || String(group.type || "contact") !== "group") {
          throw new Error("La lista de grupos permitidos contiene un grupo invalido.");
        }
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
    responseContactId: nextReplyRoutingMode === "contact" && activeChannel === "internal_chat"
      ? normalizeInternalTargetId(nextResponseContactId)
      : nextReplyRoutingMode === "contact" ? nextResponseContactId : null,
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
  if (!lookup) throw new Error("Accion send_message sin contacto.");

  const contacts = await contactsService.listContacts();
  const normalizedLookup = contactsService.normalizePhone(lookup);
  const normalizedGroupLookup = contactsService.normalizeGroupId(lookup);
  const normalizedTelegramLookup = contactsService.normalizeTelegramId(lookup);

  const directPhone = contacts.find((c) => c.type === "contact" && c.phone === normalizedLookup);
  if (directPhone) return directPhone;
  const directGroup = contacts.find((c) => c.type === "group" && c.groupId === normalizedGroupLookup);
  if (directGroup) return directGroup;
  const directTelegramUser = contacts.find(
    (c) => c.type === "contact" && c.telegramUserId === normalizedTelegramLookup
  );
  if (directTelegramUser) return directTelegramUser;
  const directTelegramGroup = contacts.find(
    (c) => c.type === "group" && c.telegramGroupId === normalizedTelegramLookup
  );
  if (directTelegramGroup) return directTelegramGroup;

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

async function resolveInternalUserFromAction(action) {
  const explicitUserId = normalizeText(action && (action.userId || action.contactId));
  if (explicitUserId) {
    const byId = await usersService.getUserById(explicitUserId);
    if (byId) return byId;
  }
  return usersService.getUserByEmail
    ? (await usersService.getUserByEmail(action && action.contact)) || (await usersService.getUserByEmail(action && action.user))
    : null;
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
    "Cada accion debe incluir evidence breve y verificable usando SOLO datos del input.",
    "Esquema:",
    '{"result_summary":"texto", "actions":[{"type":"send_message","contactId":"id_opcional","contact":"nombre o numero","message":"texto","evidence":{"source":"texto","reason":"texto","rows":[{"numero_pedido":0,"vendedora":"texto","vencida":"SI|NO","notas_presentes":true}]}}]}',
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

function hasNoDataInApiResults(apiResults) {
  const rows = Array.isArray(apiResults) ? apiResults : [];
  if (rows.length === 0) return true;
  for (const item of rows) {
    const result = item && item.result ? item.result : {};
    const payload = result.responseJson || {};
    const dataRows = Array.isArray(payload.rows) ? payload.rows : [];
    const rowCountRaw = payload.rowCount;
    const rowCount = Number.isFinite(Number(rowCountRaw)) ? Number(rowCountRaw) : null;
    const noRows = dataRows.length === 0;
    const noCount = rowCount === 0;
    if (!(noRows || noCount)) {
      return false;
    }
  }
  return true;
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

function collectRowsFromApiResults(apiResults) {
  const collected = [];
  const rows = Array.isArray(apiResults) ? apiResults : [];
  for (const item of rows) {
    const result = item && item.result ? item.result : {};
    const payload = result.responseJson || {};
    const dataRows = Array.isArray(payload.rows) ? payload.rows : [];
    for (const row of dataRows) {
      if (row && typeof row === "object") collected.push(row);
    }
  }
  return collected;
}

function isYesValue(value) {
  return normalizeCompareText(value) === "si";
}

function isNoValue(value) {
  return normalizeCompareText(value) === "no";
}

function hasAnyNotes(rawNotes) {
  return normalizeText(rawNotes).length > 0;
}

function hasHappyFaceNote(rawNotes) {
  const notes = normalizeText(rawNotes).toLowerCase();
  if (!notes) return false;
  return /(:\)|:-\)|😀|😃|😄|🙂|😊|☺|carita feliz)/i.test(notes);
}

function buildOverdueReminderMessage(contactName, rows) {
  const name = normalizeText(contactName) || "Vendedora";
  const orderRows = Array.isArray(rows) ? rows : [];
  const lines = orderRows
    .map((row) => {
      const orderNumber = row && row.numero_pedido != null ? String(row.numero_pedido) : "";
      const customer = normalizeText(row && row.cliente);
      if (orderNumber && customer) return `- Pedido ${orderNumber} (cliente: ${customer})`;
      if (orderNumber) return `- Pedido ${orderNumber}`;
      return "";
    })
    .filter(Boolean);
  const includeHappyFaceNote = orderRows.some((row) => hasHappyFaceNote(row && row.notas));
  const suffix = includeHappyFaceNote
    ? "\n\nEn la nota del pedido agrega que ya realizó el pago."
    : "";
  return [
    `Hola ${name}, tenés pedidos vencidos pendientes de pago:`,
    lines.join("\n"),
    "Hoy debés realizar el reclamo de pago correspondiente e informar a Yamil cuando lo hagas.",
  ]
    .filter(Boolean)
    .join("\n")
    .concat(suffix);
}

function buildMissingPaymentNoteMessage(contactName, rows) {
  const name = normalizeText(contactName) || "Vendedora";
  const details = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const orderNumber = row && row.numero_pedido != null ? String(row.numero_pedido) : "";
      const customer = normalizeText(row && row.cliente);
      if (orderNumber && customer) return `${orderNumber} (${customer})`;
      if (orderNumber) return orderNumber;
      return "";
    })
    .filter(Boolean);
  const prefix =
    details.length > 1
      ? `Hola ${name}. Los pedidos pendientes deben tener nota de reclamo de pago.`
      : `Hola ${name}. El pedido pendiente debe tener nota de reclamo de pago.`;
  const suffix = details.length > 0 ? `Pedidos: ${details.join(", ")}.` : "";
  return [prefix, suffix].filter(Boolean).join(" ");
}

function isPendingPaymentsTask(task) {
  const text = [
    task && task.taskPromptTemplate,
    task && task.taskInput,
    task && task.mergedPrompt,
  ]
    .map((value) => normalizeCompareText(value))
    .join(" ");
  return (
    text.includes('si vencida = "si"')
    || text.includes("si vencida = si")
  ) && text.includes("nota de reclamo de pago");
}

function classifyPendingPaymentsRow(row) {
  if (isYesValue(row && row.vencida)) return "overdue";
  if (isNoValue(row && row.vencida) && !hasAnyNotes(row && row.notas)) return "missing_note";
  return "none";
}

function findMatchingContactIdsForVendorName(contacts, vendorName) {
  const vendorKey = normalizeCompareText(vendorName);
  if (!vendorKey) return [];
  const rows = Array.isArray(contacts) ? contacts : [];
  return rows
    .filter((contact) => String(contact.type || "contact") === "contact")
    .filter((contact) => {
      const contactKey = normalizeCompareText(contact.name);
      return Boolean(
        contactKey
          && (contactKey === vendorKey || contactKey.includes(vendorKey) || vendorKey.includes(contactKey))
      );
    })
    .map((contact) => contact.id);
}

function collectEvidenceWarnings(actions, apiRows, contacts) {
  const warnings = [];
  const normalizedActions = Array.isArray(actions) ? actions : [];
  for (let i = 0; i < normalizedActions.length; i += 1) {
    const action = normalizedActions[i] || {};
    const type = normalizeText(action.type).toLowerCase();
    if (normalizeActionType(type) !== "send_message") continue;
    const evidence = normalizeActionObject(action.evidence);
    if (Object.keys(evidence).length === 0) {
      warnings.push({
        code: "missing_action_evidence",
        actionIndex: i,
      });
      continue;
    }
    const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
    for (const row of rows) {
      const orderNumber = row && row.numero_pedido != null ? Number(row.numero_pedido) : null;
      if (orderNumber == null) continue;
      const matchedRow = apiRows.find((item) => Number(item && item.numero_pedido) === orderNumber);
      if (!matchedRow) {
        warnings.push({
          code: "evidence_row_not_found",
          actionIndex: i,
          numero_pedido: orderNumber,
        });
        continue;
      }
      const evidenceVendor = normalizeCompareText(row && row.vendedora);
      const actualVendor = normalizeCompareText(matchedRow && matchedRow.vendedora);
      if (evidenceVendor && actualVendor && evidenceVendor !== actualVendor) {
        warnings.push({
          code: "evidence_vendor_mismatch",
          actionIndex: i,
          numero_pedido: orderNumber,
          expectedVendor: matchedRow.vendedora || null,
          evidenceVendor: row.vendedora || null,
        });
      }
    }
  }

  const byVendor = new Map();
  for (const row of apiRows) {
    const vendorName = normalizeText(row && (row.vendedora || row.vendedor || row.seller || row.vendor));
    if (!vendorName) continue;
    const key = normalizeCompareText(vendorName);
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendorName,
        orderNumbers: [],
      });
    }
    const bucket = byVendor.get(key);
    if (row && row.numero_pedido != null) {
      bucket.orderNumbers.push(row.numero_pedido);
    }
  }

  for (const item of byVendor.values()) {
    const matches = findMatchingContactIdsForVendorName(contacts, item.vendorName);
    if (matches.length === 0) {
      warnings.push({
        code: "api_vendor_without_contact_reference",
        vendorName: item.vendorName,
        orders: item.orderNumbers,
      });
    }
  }

  return warnings;
}

function buildPendingPaymentsRequirements(apiRows, contacts) {
  const requirementsByContactId = new Map();
  const unresolvedVendors = [];
  const groupedByVendor = new Map();

  for (const row of Array.isArray(apiRows) ? apiRows : []) {
    const classification = classifyPendingPaymentsRow(row);
    if (classification === "none") continue;
    const vendorName = normalizeText(row && row.vendedora);
    const vendorKey = normalizeCompareText(vendorName);
    if (!vendorKey) continue;
    if (!groupedByVendor.has(vendorKey)) {
      groupedByVendor.set(vendorKey, {
        vendorName,
        overdueRows: [],
        missingNoteRows: [],
      });
    }
    const bucket = groupedByVendor.get(vendorKey);
    if (classification === "overdue") bucket.overdueRows.push(row);
    if (classification === "missing_note") bucket.missingNoteRows.push(row);
  }

  for (const bucket of groupedByVendor.values()) {
    const matches = findMatchingContactIdsForVendorName(contacts, bucket.vendorName);
    if (matches.length === 0) {
      unresolvedVendors.push({
        vendorName: bucket.vendorName,
        orders: [...bucket.overdueRows, ...bucket.missingNoteRows]
          .map((row) => row && row.numero_pedido)
          .filter((value) => value != null),
      });
      continue;
    }
    for (const contactId of matches) {
      const contact = contacts.find((item) => item.id === contactId);
      if (!contact) continue;
      requirementsByContactId.set(contactId, {
        contact,
        overdueRows: bucket.overdueRows.slice(),
        missingNoteRows: bucket.missingNoteRows.slice(),
      });
    }
  }

  return { requirementsByContactId, unresolvedVendors };
}

function normalizeEvidenceRows(action, apiRows) {
  const evidence = normalizeActionObject(action.evidence);
  const rawRows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const matchedRows = [];
  for (const row of rawRows) {
    const orderNumber = row && row.numero_pedido != null ? Number(row.numero_pedido) : null;
    if (!Number.isFinite(orderNumber)) continue;
    const matched = apiRows.find((item) => Number(item && item.numero_pedido) === orderNumber);
    if (matched) matchedRows.push(matched);
  }
  return matchedRows;
}

async function applyPendingPaymentsConsistency({
  actions,
  apiRows,
  contacts,
}) {
  const warnings = [];
  const validActions = [];
  const coveredKinds = new Set();
  const { requirementsByContactId, unresolvedVendors } = buildPendingPaymentsRequirements(apiRows, contacts);

  for (const unresolved of unresolvedVendors) {
    warnings.push({
      code: "required_vendor_without_resolvable_contact",
      vendorName: unresolved.vendorName,
      orders: unresolved.orders,
    });
  }

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i] || {};
    const type = normalizeText(action.type).toLowerCase();
    if (normalizeActionType(type) !== "send_message") {
      validActions.push(action);
      continue;
    }
    const contactId = normalizeText(action.contactId);
    const evidenceRows = normalizeEvidenceRows(action, apiRows);
    if (evidenceRows.length === 0) {
      warnings.push({
        code: "pending_payments_action_without_matching_rows_skipped",
        actionIndex: i,
        contactId: contactId || null,
      });
      continue;
    }

    const classifications = new Set(evidenceRows.map((row) => classifyPendingPaymentsRow(row)));
    classifications.delete("none");
    if (classifications.size !== 1) {
      warnings.push({
        code: "pending_payments_mixed_or_invalid_rows_skipped",
        actionIndex: i,
        contactId: contactId || null,
        orders: evidenceRows.map((row) => row.numero_pedido),
      });
      continue;
    }

    const kind = Array.from(classifications)[0];
    if (!kind) {
      warnings.push({
        code: "pending_payments_non_actionable_rows_skipped",
        actionIndex: i,
        contactId: contactId || null,
        orders: evidenceRows.map((row) => row.numero_pedido),
      });
      continue;
    }

    const requirement = requirementsByContactId.get(contactId);
    if (!requirement) {
      warnings.push({
        code: "pending_payments_contact_without_requirement_skipped",
        actionIndex: i,
        contactId: contactId || null,
        orders: evidenceRows.map((row) => row.numero_pedido),
      });
      continue;
    }

    const vendorOrders = (kind === "overdue" ? requirement.overdueRows : requirement.missingNoteRows)
      .map((row) => Number(row.numero_pedido));
    const evidenceOrders = evidenceRows.map((row) => Number(row.numero_pedido));
    const allOrdersMatch = evidenceOrders.every((order) => vendorOrders.includes(order));
    if (!allOrdersMatch) {
      warnings.push({
        code: "pending_payments_evidence_not_allowed_for_contact_skipped",
        actionIndex: i,
        contactId: contactId || null,
        orders: evidenceOrders,
      });
      continue;
    }

    coveredKinds.add(`${kind}:${contactId}`);
    validActions.push(action);
  }

  for (const [contactId, requirement] of requirementsByContactId.entries()) {
    if (requirement.overdueRows.length > 0 && !coveredKinds.has(`overdue:${contactId}`)) {
      validActions.push({
        type: "send_message",
        contactId,
        contact: requirement.contact.name,
        message: buildOverdueReminderMessage(requirement.contact.name, requirement.overdueRows),
        evidence: {
          source: "backend_pending_payments_consistency",
          reason: "Autocorrección: faltaba accion para pedidos vencidos.",
          rows: requirement.overdueRows.map((row) => ({
            numero_pedido: row.numero_pedido,
            vendedora: row.vendedora,
            vencida: row.vencida,
            notas_presentes: hasAnyNotes(row.notas),
          })),
        },
      });
      warnings.push({
        code: "overdue_missing_action_autocorrected",
        contactId,
        contactName: requirement.contact.name,
        orders: requirement.overdueRows.map((row) => row.numero_pedido),
      });
    }
    if (requirement.missingNoteRows.length > 0 && !coveredKinds.has(`missing_note:${contactId}`)) {
      validActions.push({
        type: "send_message",
        contactId,
        contact: requirement.contact.name,
        message: buildMissingPaymentNoteMessage(requirement.contact.name, requirement.missingNoteRows),
        evidence: {
          source: "backend_pending_payments_consistency",
          reason: "Autocorrección: faltaba accion para pedidos sin nota de reclamo.",
          rows: requirement.missingNoteRows.map((row) => ({
            numero_pedido: row.numero_pedido,
            vendedora: row.vendedora,
            vencida: row.vencida,
            notas_presentes: hasAnyNotes(row.notas),
          })),
        },
      });
      warnings.push({
        code: "missing_note_action_autocorrected",
        contactId,
        contactName: requirement.contact.name,
        orders: requirement.missingNoteRows.map((row) => row.numero_pedido),
      });
    }
  }

  return { actions: validActions, warnings };
}

async function applyGlobalGuardrails({
  task,
  parsed,
  availableContacts,
  apiResults,
  allowNoWhatsappOnNoData,
}) {
  const activeChannel = await messagingGateway.getChannel();
  if (activeChannel === "internal_chat") {
    const warnings = [];
    const allowedInternalGroupIds = new Set(normalizeIdList(task && task.allowedGroupContactIds));
    const sourceActions = Array.isArray(parsed && parsed.actions) ? parsed.actions : [];
    const keptActions = [];
    for (let i = 0; i < sourceActions.length; i += 1) {
      const action = sourceActions[i] || {};
      const type = normalizeText(action.type).toLowerCase();
      if (normalizeActionType(type) !== "send_message") {
        keptActions.push(action);
        continue;
      }
      const fallbackTarget = allowedInternalGroupIds.size === 1
        ? "group:" + Array.from(allowedInternalGroupIds)[0]
        : "";
      const resolvedTarget = await resolveInternalTargetFromAction(action, fallbackTarget);
      if (!resolvedTarget) {
        warnings.push({
          code: "internal_target_missing_skipped",
          actionIndex: i,
        });
        continue;
      }
      if (resolvedTarget.type === "group" && !allowedInternalGroupIds.has(resolvedTarget.id)) {
        warnings.push({
          code: "internal_group_not_allowed_skipped",
          actionIndex: i,
          contactId: resolvedTarget.storageId,
        });
        continue;
      }
      keptActions.push({
        ...action,
        contactId: resolvedTarget.storageId,
        contact: normalizeText(action.contact) || resolvedTarget.name,
      });
    }
    return {
      parsed: {
        ...(parsed || {}),
        actions: keptActions,
      },
      warnings,
    };
  }
  const warnings = [];
  const contacts = Array.isArray(availableContacts) ? availableContacts : [];
  const allowedGroupContactIds = new Set(normalizeIdList(task && task.allowedGroupContactIds));
  const sourceActions = Array.isArray(parsed && parsed.actions) ? parsed.actions : [];
  const apiRows = collectRowsFromApiResults(apiResults);
  const keptActions = [];

  for (let i = 0; i < sourceActions.length; i += 1) {
    const action = sourceActions[i] || {};
    const type = normalizeText(action.type).toLowerCase();
    if (normalizeActionType(type) !== "send_message") {
      keptActions.push(action);
      continue;
    }

    let resolvedContact = null;
    try {
      resolvedContact = await resolveContactFromAction(action);
    } catch (error) {
      warnings.push({
        code: "unknown_contact_skipped",
        actionIndex: i,
        reason: error.message,
      });
      continue;
    }

    const isGroup = String(resolvedContact.type || "contact") === "group";
    if (isGroup && !allowedGroupContactIds.has(resolvedContact.id)) {
      warnings.push({
        code: "group_not_allowed_skipped",
        actionIndex: i,
        contactId: resolvedContact.id,
        contactName: resolvedContact.name,
      });
      continue;
    }

    keptActions.push({
      ...action,
      contactId: resolvedContact.id,
      contact: normalizeText(action.contact) || resolvedContact.name,
    });
  }

  if (allowNoWhatsappOnNoData) {
    if (keptActions.length > 0) {
      warnings.push({
        code: "no_data_actions_cleared",
        removedActions: keptActions.length,
      });
    }
    return {
      parsed: {
        ...(parsed || {}),
        actions: [],
      },
      warnings,
    };
  }

  warnings.push(...collectEvidenceWarnings(keptActions, apiRows, contacts));

  if (isPendingPaymentsTask(task)) {
    const consistency = await applyPendingPaymentsConsistency({
      actions: keptActions,
      apiRows,
      contacts,
    });
    keptActions.length = 0;
    keptActions.push(...consistency.actions);
    warnings.push(...consistency.warnings);
  }

  return {
    parsed: {
      ...(parsed || {}),
      actions: keptActions,
    },
    warnings,
  };
}

async function executeSendMessageAction(task, action, context, resolvedContact) {
  const activeChannel = await messagingGateway.getChannel();
  const roleDetail = normalizeText(context && context.role ? context.role.detail : "");
  const message = normalizeText(action.message);
  if (!message) throw new Error("Accion send_message sin mensaje.");
  let contact = resolvedContact || null;
  let contactTarget = "";
  if (activeChannel === "internal_chat") {
    const fallbackGroupId = Array.isArray(task && task.allowedGroupContactIds) && task.allowedGroupContactIds.length === 1
      ? "group:" + String(task.allowedGroupContactIds[0] || "").trim()
      : "";
    const resolvedTarget = await resolveInternalTargetFromAction(action, fallbackGroupId);
    if (!resolvedTarget) {
      throw new Error("No se pudo resolver el destino interno.");
    }
    contact = {
      id: resolvedTarget.storageId,
      name: resolvedTarget.name,
      type: resolvedTarget.type,
    };
    contactTarget = resolvedTarget.target;
  } else {
    contact = contact || (await resolveContactFromAction(action));
    contactTarget = contactsService.getContactMessageTarget(contact, activeChannel);
    if (!contactTarget) {
      throw new Error("El contacto no esta configurado para el canal activo.");
    }
  }
  const withTraceTag = parseBool(process.env.TASK_REPLY_APPEND_TID || "false");
  const tidTag = task && task.id ? `[TID:${String(task.id).slice(0, 8)}]` : "";
  const finalMessage = withTraceTag && tidTag ? `${message}\n\n${tidTag}` : message;

  const sendResult = await messagingGateway.sendMessage(contactTarget, finalMessage, {
    channel: activeChannel,
    senderUserId: context && context.actorUserId ? context.actorUserId : "",
  });
  if (activeChannel !== "internal_chat") {
    await messagesService.addMessage({
      channel: activeChannel,
      contactPhone: contactTarget,
      direction: "out",
      text: finalMessage,
      status: "sent",
      providerMessageId: String(sendResult && sendResult.messageId || ""),
    });
  }

  let replyRoute = null;
  if (task && task.replyRoutingMode === "contact") {
    if (!task.responseContactId) {
      throw new Error("La tarea tiene ruteo a contacto pero no tiene responseContactId.");
    }
    if (activeChannel === "internal_chat") {
      const destination = await resolveInternalTaskTarget(task.responseContactId);
      if (!destination || destination.type !== "user") {
        throw new Error("No se pudo resolver el usuario destino de respuesta.");
      }
      if (String(contact && contact.type || "") !== "user") {
        replyRoute = null;
      } else {
        replyRoute = await taskReplyRoutesService.upsertRouteForTask({
          taskId: task.id,
          channel: activeChannel,
          sourcePhone: contactTarget,
          destinationContactId: destination.storageId,
          destinationPhone: destination.target,
          routingEnabled: true,
          originalMessage: finalMessage,
          lastOutboundMessageId: String(sendResult && sendResult.messageId ? sendResult.messageId : ""),
          lastOutboundAt: new Date().toISOString(),
        });
      }
    } else {
      const destination = await contactsService.getContactById(task.responseContactId);
      if (!destination) {
        throw new Error("No se pudo resolver el contacto destino de respuesta.");
      }
      const destinationTarget = contactsService.getContactMessageTarget(destination, activeChannel);
      replyRoute = await taskReplyRoutesService.upsertRouteForTask({
        taskId: task.id,
        channel: activeChannel,
        sourcePhone: contactTarget,
        destinationContactId: destination.id,
        destinationPhone: destinationTarget,
        routingEnabled: true,
        originalMessage: finalMessage,
        lastOutboundMessageId: String(sendResult && sendResult.messageId ? sendResult.messageId : ""),
        lastOutboundAt: new Date().toISOString(),
      });
    }
  } else if (task && task.replyRoutingMode === "none") {
    await taskReplyRoutesService.upsertRouteForTask({
      taskId: task.id,
      channel: activeChannel,
      sourcePhone: contactTarget,
      routingEnabled: false,
      originalMessage: finalMessage,
      lastOutboundMessageId: String(sendResult && sendResult.messageId ? sendResult.messageId : ""),
      lastOutboundAt: new Date().toISOString(),
    });
  }

  return {
    contactId: contact.id,
    contactName: contact.name,
    phone: contactTarget,
    channel: activeChannel,
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
  const activeChannel = await messagingGateway.getChannel();

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i] || {};
    const type = normalizeText(action.type).toLowerCase();

    if (normalizeActionType(type) === "send_message") {
      let resolvedContact = null;
      if (activeChannel !== "internal_chat" && policy && policy.onlyVendors === true) {
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
      const result = await executeSendMessageAction(task, action, context, resolvedContact);
      results.push({
        index: i,
        type: "send_message",
        result: {
          ...result,
          evidence: normalizeActionObject(action.evidence),
        },
        ok: true,
      });
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
  const executionTimeoutMs = getExecutionTimeoutMs();
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("Tarea no encontrada.");

  let task = tasks[index];
  const allowedStatuses = trigger === "scheduled"
    ? ["queued", "done", "failed"]
    : (task.scheduleEnabled ? ["queued", "done", "failed"] : ["queued"]);
  if (!allowedStatuses.includes(task.status)) {
    throw new Error(
      trigger === "scheduled"
        ? "La tarea programada debe estar en estado queued/done/failed."
        : (
            task.scheduleEnabled
              ? "Solo se puede ejecutar manualmente una tarea automatica en estado queued/done/failed."
              : "Solo se puede ejecutar manualmente una tarea en estado queued."
          )
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
    const activeChannel = await messagingGateway.getChannel();
    const hasConfiguredIntegration = Boolean(normalizeText(task.integrationId));
    const availableContacts = await contactsService.listContacts();
    const availableUsers = await usersService.listUsers();
    const availableInternalGroups = activeChannel === "internal_chat"
      ? await internalChatGroupsService.listGroups()
      : [];
    let availableIntegrations = [];
    if (hasConfiguredIntegration) {
      const configuredIntegration = await integrationsService.getIntegrationById(task.integrationId);
      if (!configuredIntegration) {
        throw new Error(`Integracion API configurada invalida: ${task.integrationId}`);
      }
      availableIntegrations = [configuredIntegration];
    }
    const contactsReferenceText = activeChannel === "internal_chat"
      ? buildInternalTargetsReferenceText(availableUsers, availableInternalGroups, task.responseContactId)
      : buildContactsReferenceText(availableContacts);
    const integrationsReferenceText = buildIntegrationsReferenceText(availableIntegrations);
    task = appendLog(task, "execution_route", "ok", "Ruta de ejecucion resuelta", {
      mode: hasConfiguredIntegration ? "api_configured_auto_then_model" : "model_only",
      integrationId: hasConfiguredIntegration ? task.integrationId : null,
    });
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

    let parsed = { result_summary: "", actions: [] };
    let outputForRaw = "";
    let actionPolicy = null;
    let allowNoWhatsappOnNoData = false;
    let apiResultsForGuardrails = [];

    if (hasConfiguredIntegration) {
      task = appendLog(
        task,
        "api_actions",
        "running",
        "Ejecutando integracion API configurada automaticamente",
        {
          count: 1,
          integrationId: task.integrationId,
          mode: "configured_auto",
        }
      );
      tasks[index] = task;
      await tasksRepo.saveAll(tasks);

      const apiResult = await executeExternalApiAction(task, {
        type: "call_external_api",
        integrationId: task.integrationId,
        query: {},
        body: {},
      });
      apiResultsForGuardrails = [
        {
          index: 0,
          type: "call_external_api",
          ok: true,
          result: apiResult,
        },
      ];
      allowNoWhatsappOnNoData = hasNoDataInApiResults(apiResultsForGuardrails);

      task = appendLog(task, "api_actions", "ok", "Acciones API ejecutadas", { count: 1 });
      task = appendLog(task, "api_action", "ok", "Resultado call_external_api", apiResult);

      const followupPrompt = buildApiResultsFollowupPrompt({
        mergedPrompt: task.mergedPrompt,
        runtimeFileContext: [todayContextText, runtimeFileContext].filter(Boolean).join("\n\n"),
        contactsReferenceText,
        integrationsReferenceText,
        apiResults: apiResultsForGuardrails,
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

      const followupOutput = await withTimeout(
        modelTestService.testModel({
          envKey: model.envKey,
          modelName: model.name,
          provider: model.provider,
          modelId: model.modelId,
          baseUrl: model.baseUrl,
          message: followupPrompt,
        }),
        executionTimeoutMs,
        "model_call_followup"
      );
      outputForRaw = String(followupOutput || "");
      task = appendLog(task, "model_call_followup", "ok", "Respuesta follow-up recibida", {
        outputLength: outputForRaw.length,
      });
      parsed = parseModelOutputToJson(followupOutput);
      task = appendLog(task, "parse_output_followup", "ok", "Salida follow-up parseada", {
        keys: Object.keys(parsed || {}),
        actionsCount: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
      });

      const vendorNameKeys = extractVendorNamesFromApiResults(apiResultsForGuardrails);
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
      if (allowNoWhatsappOnNoData) {
        task = appendLog(
          task,
          "whatsapp_requirement",
          "ok",
          "Sin datos en API: se permite actions=[] sin envio de WhatsApp",
          {
            rowCount: apiResult && apiResult.responseJson ? apiResult.responseJson.rowCount : null,
          }
        );
      }
    } else {
      const modelPrompt = [
        task.mergedPrompt,
        todayContextText,
        runtimeFileContext,
        contactsReferenceText,
        "",
        buildActionContractPrompt({ allowApiActions: false }),
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

      const output = await withTimeout(
        modelTestService.testModel({
          envKey: model.envKey,
          modelName: model.name,
          provider: model.provider,
          modelId: model.modelId,
          baseUrl: model.baseUrl,
          message: modelPrompt,
          fileAttachment,
        }),
        executionTimeoutMs,
        "model_call"
      );
      outputForRaw = String(output || "");

      task = appendLog(task, "model_call", "ok", "Respuesta de modelo recibida", {
        outputLength: outputForRaw.length,
      });

      parsed = parseModelOutputToJson(output);
      if (Array.isArray(parsed.actions)) {
        const kept = parsed.actions.filter(
          (a) => normalizeText(a && a.type).toLowerCase() !== "call_external_api"
        );
        if (kept.length !== parsed.actions.length) {
          task = appendLog(
            task,
            "api_action_ignored",
            "ok",
            "Se ignoraron acciones call_external_api porque la tarea no tiene integrationId",
            {
              ignoredCount: parsed.actions.length - kept.length,
            }
          );
          parsed.actions = kept;
        }
      }
      task = appendLog(task, "parse_output", "ok", "Salida parseada a JSON", {
        keys: Object.keys(parsed || {}),
        actionsCount: Array.isArray(parsed.actions) ? parsed.actions.length : 0,
      });
    }

    if (requiresMessagingAction(task) && !allowNoWhatsappOnNoData) {
      const initialActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const hasMessageAction = initialActions.some(
        (a) => normalizeActionType(a && a.type) === "send_message"
      );
      if (!hasMessageAction) {
        const retryPrompt = buildForceMessageRetryPrompt({
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
          "Reintentando modelo para forzar accion send_message",
          {
            provider: model.provider,
            modelId: model.modelId,
          }
        );
        tasks[index] = task;
        await tasksRepo.saveAll(tasks);

        const retryOutput = await withTimeout(
          modelTestService.testModel({
            envKey: model.envKey,
            modelName: model.name,
            provider: model.provider,
            modelId: model.modelId,
            baseUrl: model.baseUrl,
            message: retryPrompt,
            fileAttachment,
          }),
          executionTimeoutMs,
          "model_call_retry"
        );
        outputForRaw = String(retryOutput || "");
        task = appendLog(task, "model_call_retry", "ok", "Respuesta de reintento recibida", {
          outputLength: outputForRaw.length,
        });

        const retryParsed = parseModelOutputToJson(retryOutput);
        task = appendLog(task, "parse_output_retry", "ok", "Salida de reintento parseada", {
          keys: Object.keys(retryParsed || {}),
          actionsCount: Array.isArray(retryParsed.actions) ? retryParsed.actions.length : 0,
        });
        parsed = retryParsed;
      }
    }

    const guardrailOutcome = await applyGlobalGuardrails({
      task,
      parsed,
      availableContacts,
      apiResults: apiResultsForGuardrails,
      allowNoWhatsappOnNoData,
    });
    parsed = guardrailOutcome.parsed;
    if (Array.isArray(guardrailOutcome.warnings) && guardrailOutcome.warnings.length > 0) {
      task = appendLog(
        task,
        "guardrail_warning",
        "ok",
        "Auto-correcciones de guardrails globales aplicadas",
        {
          warningsCount: guardrailOutcome.warnings.length,
          warnings: guardrailOutcome.warnings,
        }
      );
    }

    const actionResults = await executeActions(task, parsed, {
      agent,
      role,
      actionPolicy,
      actorUserId: null,
    });
    const failedActions = actionResults.filter((a) => !a.ok);
    const okActions = actionResults.filter((a) => a.ok);

    if (requiresMessagingAction(task) && !allowNoWhatsappOnNoData) {
      const hasMessageAction = okActions.some((a) => normalizeActionType(a.type) === "send_message");
      if (!hasMessageAction) {
        throw new Error(
          "La tarea requiere accion de mensaje pero el modelo no devolvio send_message."
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
      executionResult: normalizeText(parsed.result_summary) || outputForRaw,
      executionError: null,
      modelOutputRaw: outputForRaw,
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

async function recoverStuckRunningTasks(nowDate = new Date()) {
  const { tasks: tasksRepo } = getRepositories();
  const tasks = await listTasks();
  const timeoutMs = getExecutionTimeoutMs();
  const nowMs = nowDate.getTime();
  let changed = 0;

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    if (!task || task.status !== "running") continue;
    const startedMs = new Date(task.startedAt || task.updatedAt || 0).getTime();
    if (!Number.isFinite(startedMs)) continue;
    if (nowMs - startedMs < timeoutMs) continue;

    let next = {
      ...task,
      status: "failed",
      executedAt: nowDate.toISOString(),
      updatedAt: nowDate.toISOString(),
      executionError: `Failsafe: tarea en running por mas de ${timeoutMs}ms.`,
    };
    next = appendLog(next, "failsafe", "error", "Tarea recuperada por timeout en estado running", {
      timeoutMs,
      startedAt: task.startedAt || null,
      recoveredAt: nowDate.toISOString(),
    });
    tasks[i] = next;
    changed += 1;
  }

  if (changed > 0) {
    await tasksRepo.saveAll(tasks);
  }
  return changed;
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
  recoverStuckRunningTasks,
  clearTaskLogs,
  composePrompt,
};
