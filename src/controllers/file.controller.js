const filesService = require("../modules/file/files.service");
const tasksService = require("../modules/task/tasks.service");
const path = require("path");

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

async function renderManageFilesPage(req, res) {
  const [files, tasks] = await Promise.all([
    filesService.listFiles(),
    tasksService.listTasks(),
  ]);

  const rows = files.map((file) => {
    const usageCount = (tasks || []).filter((task) => task && task.fileId === file.id).length;
    return {
      ...file,
      usageCount,
      createdAtFormatted: formatDateTime(file.createdAt),
    };
  });

  res.render("layouts/main", {
    pageTitle: "Gestionar Archivos",
    activeMenu: "files-manage",
    headerTitle: "Gestionar Archivos",
    moduleView: "files-manage",
    moduleData: {
      files: rows,
    },
    pageScripts: ["/js/files-manage.js"],
  });
}

async function listFiles(req, res) {
  const files = await filesService.listFiles();
  res.json({ ok: true, files });
}

async function uploadFile(req, res) {
  try {
    const file = await filesService.uploadFile(req.body);
    res.status(201).json({ ok: true, file });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteFile(req, res) {
  try {
    const removed = await filesService.deleteFile(req.params.fileId);
    res.json({ ok: true, file: removed });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function getFileContent(req, res) {
  try {
    const file = await filesService.getFileById(req.params.fileId);
    if (!file) {
      return res.status(404).send("Archivo no encontrado.");
    }
    const absolutePath = path.join(process.cwd(), file.relativePath);
    if (file.mimeType) {
      res.type(file.mimeType);
    }
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(400).send(error.message || "No se pudo abrir el archivo.");
  }
}

module.exports = {
  renderManageFilesPage,
  listFiles,
  uploadFile,
  deleteFile,
  getFileContent,
};
