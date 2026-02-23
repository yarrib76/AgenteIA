const tasksService = require("../modules/task/tasks.service");
const agentsService = require("../modules/agent/agents.service");
const rolesService = require("../modules/agent/roles.service");
const modelsService = require("../modules/model/models.service");
const filesService = require("../modules/file/files.service");
const contactsService = require("../modules/agenda/contacts.service");
const integrationsService = require("../modules/integration/api-integrations.service");

function formatDateTime(value, timeZone) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (timeZone) {
    options.timeZone = timeZone;
  }
  return new Intl.DateTimeFormat("es-AR", options).format(date);
}

async function renderNewTaskPage(req, res) {
  const [agents, roles, models, rawTasks, files, contacts, integrations] = await Promise.all([
    agentsService.listAgents(),
    rolesService.listRoles(),
    modelsService.listModels(),
    tasksService.listTasks(),
    filesService.listFiles(),
    contactsService.listContacts(),
    integrationsService.listIntegrations(),
  ]);
  const tasks = rawTasks.map((task) => ({
    ...task,
    nextRunAtFormatted: formatDateTime(task.nextRunAt, task.scheduleTimezone),
  }));

  res.render("layouts/main", {
    pageTitle: "Tareas - Nueva",
    activeMenu: "tasks-new",
    headerTitle: "Nueva Tarea",
    moduleView: "task-new",
    moduleData: {
      agents,
      roles,
      models,
      tasks,
      files,
      contacts,
      integrations,
    },
    pageScripts: ["/js/task-new.js"],
  });
}

async function createTask(req, res) {
  try {
    const task = await tasksService.createTask(req.body);
    res.status(201).json({ ok: true, task });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function getTaskPrompt(req, res) {
  const task = await tasksService.getTaskById(req.params.taskId);
  if (!task) {
    return res.status(404).json({ ok: false, message: "Tarea no encontrada." });
  }
  return res.json({
    ok: true,
    mergedPrompt: task.mergedPrompt,
    taskPromptTemplate: task.taskPromptTemplate || task.taskPrompt || "",
    taskInput: task.taskInput || "",
    fileId: task.fileId || null,
  });
}

async function getTaskDetails(req, res) {
  const task = await tasksService.getTaskById(req.params.taskId);
  if (!task) {
    return res.status(404).json({ ok: false, message: "Tarea no encontrada." });
  }
  return res.json({ ok: true, task });
}

async function updateTask(req, res) {
  try {
    const task = await tasksService.updateTask(req.params.taskId, req.body);
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteTask(req, res) {
  try {
    await tasksService.deleteTask(req.params.taskId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function queueTask(req, res) {
  try {
    const task = await tasksService.queueTask(req.params.taskId);
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function executeTask(req, res) {
  try {
    const task = await tasksService.executeTask(req.params.taskId);
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function clearTaskLogs(req, res) {
  try {
    const task = await tasksService.clearTaskLogs(req.params.taskId);
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderNewTaskPage,
  createTask,
  getTaskPrompt,
  getTaskDetails,
  updateTask,
  deleteTask,
  queueTask,
  executeTask,
  clearTaskLogs,
};
