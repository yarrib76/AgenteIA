const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");
const agentsService = require("../agent/agents.service");
const rolesService = require("../agent/roles.service");
const filesService = require("../file/files.service");
const modelsService = require("../model/models.service");
const modelTestService = require("../model/model-test.service");
const contactsService = require("../agenda/contacts.service");
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

function normalizeCompareText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]/g, "")
    .trim();
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
    '{"result_summary":"texto", "actions":[{"type":"send_whatsapp","contactId":"id_opcional","contact":"nombre o numero","message":"texto"}] }',
    "Si no hay accion, enviar actions: [].",
    "Si la accion es send_whatsapp, el campo message debe comenzar exactamente con el detalle del rol del agente.",
    "Si hay lista de contactos disponible, prioriza devolver contactId.",
    "No inventes contactos inexistentes.",
  ].join("\n");
}

function buildForceWhatsAppRetryPrompt({
  mergedPrompt,
  runtimeFileContext,
  contactsReferenceText,
  lastResultSummary,
}) {
  return [
    mergedPrompt,
    runtimeFileContext || "",
    contactsReferenceText || "",
    "",
    "REINTENTO OBLIGATORIO.",
    "La tarea requiere enviar WhatsApp.",
    "Responde SOLO en JSON valido, sin markdown.",
    "Devuelve EXACTAMENTE 1 accion en actions con type=send_whatsapp.",
    "No permitas actions vacio.",
    "Si result_summary ya contiene el contenido, usalo para el campo message.",
    "Si hay lista de contactos, devuelve contactId para evitar ambiguedad.",
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
    const schedule = normalizeTaskSchedule(task);
    if (task.taskPromptTemplate || task.taskInput) {
      return {
        status: "draft",
        ...task,
        responseContactId,
        ...schedule,
      };
    }
    return {
      status: task.status || "draft",
      ...task,
      taskPromptTemplate: task.taskPrompt || "",
      taskInput: "",
      responseContactId,
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
  responseContactId,
  scheduleEnabled,
  scheduleDays,
  scheduleTime,
  scheduleTimezone,
}) {
  const nextAgentId = normalizeText(agentId);
  const nextTaskPromptTemplate = normalizeText(taskPromptTemplate);
  const nextTaskInput = normalizeText(taskInput);
  const nextFileId = normalizeText(fileId);
  const nextResponseContactId = normalizeText(responseContactId);
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

  if (nextResponseContactId) {
    const targetContact = await contactsService.getContactById(nextResponseContactId);
    if (!targetContact) {
      throw new Error("Contacto destino de respuesta invalido.");
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
    responseContactId: nextResponseContactId || null,
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
    responseContactId,
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
  const nextResponseContactId = normalizeText(responseContactId);
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

  if (nextResponseContactId) {
    const targetContact = await contactsService.getContactById(nextResponseContactId);
    if (!targetContact) {
      throw new Error("Contacto destino de respuesta invalido.");
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
    responseContactId: nextResponseContactId || null,
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

async function executeSendWhatsAppAction(task, action, context) {
  const contact = await resolveContactFromAction(action);
  const contactTarget = contactsService.getContactMessageTarget(contact);
  const roleDetail = normalizeText(context && context.role ? context.role.detail : "");
  const message = normalizeText(action.message);
  if (!message) throw new Error("Accion send_whatsapp sin mensaje.");

  await whatsappGateway.sendMessage(contactTarget, message);
  await messagesService.addMessage({
    contactPhone: contactTarget,
    direction: "out",
    text: message,
    status: "sent",
  });

  let replyRoute = null;
  if (task && task.responseContactId) {
    const destination = await contactsService.getContactById(task.responseContactId);
    if (destination) {
      const destinationTarget = contactsService.getContactMessageTarget(destination);
      replyRoute = await taskReplyRoutesService.upsertRouteForTask({
        taskId: task.id,
        sourcePhone: contactTarget,
        destinationContactId: destination.id,
        destinationPhone: destinationTarget,
      });
    }
  }

  return {
    contactId: contact.id,
    contactName: contact.name,
    phone: contactTarget,
    finalMessage: message,
    sent: true,
    roleDetailPrepended: false,
    roleDetailExpected: roleDetail || null,
    modelMessageStartsWithRoleDetail:
      Boolean(roleDetail) &&
      normalizeCompareText(message).startsWith(normalizeCompareText(roleDetail)),
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

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i] || {};
    const type = normalizeText(action.type).toLowerCase();

    if (type === "send_whatsapp") {
      const result = await executeSendWhatsAppAction(task, action, context);
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
    const availableContacts = await contactsService.listContacts();
    const contactsReferenceText = buildContactsReferenceText(availableContacts);
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
      runtimeFileContext,
      contactsReferenceText,
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

    if (requiresWhatsAppAction(task)) {
      const initialActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const hasWhatsAppAction = initialActions.some(
        (a) => normalizeText(a && a.type).toLowerCase() === "send_whatsapp"
      );
      if (!hasWhatsAppAction) {
        const retryPrompt = buildForceWhatsAppRetryPrompt({
          mergedPrompt: task.mergedPrompt,
          runtimeFileContext,
          contactsReferenceText,
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

    const actionResults = await executeActions(task, parsed, { agent, role });
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
