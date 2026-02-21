const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const XLSX = require("xlsx");
const { getRepositories } = require("../../repositories/repository-provider");

const STORAGE_DIR = path.join(process.cwd(), "archivos");
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 120000;
const MAX_EXCEL_ROWS_PER_SHEET = 300;
const MAX_EXCEL_COLS = 20;

function sanitizeBaseName(value) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.\- ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned || "archivo";
}

function splitName(fileName) {
  const parsed = path.parse(String(fileName || "archivo"));
  return {
    name: sanitizeBaseName(parsed.name),
    ext: sanitizeBaseName(parsed.ext || "").replace(/[^\w.]/g, ""),
  };
}

function decodeBase64(input) {
  const raw = String(input || "");
  const match = raw.match(/^data:.*;base64,(.*)$/);
  const base64 = match ? match[1] : raw;
  return Buffer.from(base64, "base64");
}

async function listFiles() {
  const { files: filesRepo } = getRepositories();
  const files = await filesRepo.list();
  return files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getFileById(fileId) {
  const files = await listFiles();
  return files.find((file) => file.id === fileId) || null;
}

async function uploadFile({ originalName, mimeType, contentBase64 }) {
  const name = String(originalName || "").trim();
  if (!name) throw new Error("Nombre de archivo requerido.");

  const binary = decodeBase64(contentBase64);
  if (!binary || binary.length === 0) throw new Error("Archivo vacio.");
  if (binary.length > MAX_BYTES) {
    throw new Error("Archivo demasiado grande. Maximo 10MB.");
  }

  const { name: baseName, ext } = splitName(name);
  const fileId = randomUUID();
  const storedName = `${Date.now()}_${baseName}_${fileId.slice(0, 8)}${ext}`;

  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const absolutePath = path.join(STORAGE_DIR, storedName);
  await fs.writeFile(absolutePath, binary);

  const row = {
    id: fileId,
    originalName: name,
    mimeType: String(mimeType || "").trim(),
    storedName,
    relativePath: path.join("archivos", storedName).replace(/\\/g, "/"),
    sizeBytes: binary.length,
    createdAt: new Date().toISOString(),
  };

  const { files: filesRepo } = getRepositories();
  const files = await filesRepo.list();
  files.push(row);
  await filesRepo.saveAll(files);
  return row;
}

async function deleteFile(fileId) {
  const id = String(fileId || "").trim();
  if (!id) throw new Error("Archivo invalido.");

  const { files: filesRepo, tasks: tasksRepo } = getRepositories();
  const [files, tasks] = await Promise.all([filesRepo.list(), tasksRepo.list()]);
  const index = files.findIndex((file) => file.id === id);
  if (index < 0) throw new Error("Archivo no encontrado.");

  const file = files[index];
  const usageCount = (tasks || []).filter((task) => task && task.fileId === id).length;
  if (usageCount > 0) {
    throw new Error(
      `No se puede eliminar el archivo porque esta asociado a ${usageCount} tarea(s).`
    );
  }

  const absPath = path.join(process.cwd(), file.relativePath);
  try {
    await fs.unlink(absPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw new Error(`No se pudo eliminar archivo fisico: ${error.message}`);
    }
  }

  files.splice(index, 1);
  await filesRepo.saveAll(files);
  return file;
}

async function getFileRuntimeContext(fileId) {
  const file = await getFileById(fileId);
  if (!file) return null;

  const absPath = path.join(process.cwd(), file.relativePath);
  const ext = path.extname(file.originalName || "").toLowerCase();
  const isTextLike = [".txt", ".md", ".csv", ".json", ".xml", ".html"].includes(ext);

  const context = {
    fileId: file.id,
    originalName: file.originalName,
    relativePath: file.relativePath,
    absolutePath: absPath,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    extension: ext,
    contentText: null,
    note: "",
  };

  if (isTextLike) {
    try {
      const raw = await fs.readFile(absPath, "utf-8");
      context.contentText = raw.slice(0, MAX_TEXT_CHARS);
      if (raw.length > context.contentText.length) {
        context.note = `Archivo truncado para el contexto (max ${MAX_TEXT_CHARS} caracteres).`;
      }
      return context;
    } catch (error) {
      context.note = `No se pudo leer contenido de archivo: ${error.message}`;
      return context;
    }
  }

  if (ext === ".xlsx" || ext === ".xls") {
    try {
      const binary = await fs.readFile(absPath);
      const workbook = XLSX.read(binary, { type: "buffer" });
      const chunks = [];

      for (const sheetName of workbook.SheetNames || []) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        });

        chunks.push(`[Hoja] ${sheetName}`);
        const rowLimit = Math.min(rows.length, MAX_EXCEL_ROWS_PER_SHEET);
        for (let r = 0; r < rowLimit; r += 1) {
          const row = Array.isArray(rows[r]) ? rows[r] : [];
          const cols = row.slice(0, MAX_EXCEL_COLS).map((cell) => String(cell || "").trim());
          chunks.push(cols.join(" | "));
        }
        if (rows.length > rowLimit) {
          chunks.push(
            `[Truncado] Se omitieron ${rows.length - rowLimit} filas en hoja ${sheetName}.`
          );
        }
        chunks.push("");
      }

      const text = chunks.join("\n").trim();
      context.contentText = text.slice(0, MAX_TEXT_CHARS);
      if (text.length > context.contentText.length) {
        context.note = `Excel truncado para el contexto (max ${MAX_TEXT_CHARS} caracteres).`;
      } else {
        context.note = "Excel parseado a texto estructurado para contexto del modelo.";
      }
      return context;
    } catch (error) {
      context.note = `No se pudo parsear Excel: ${error.message}`;
      return context;
    }
  }

  if (ext === ".pdf") {
    context.note = "PDF detectado. Se puede adjuntar al modelo OpenAI y tambien enviar metadata.";
    return context;
  }

  context.note = "Tipo de archivo no textual; se envia solo metadata.";
  return context;
}

module.exports = {
  listFiles,
  getFileById,
  uploadFile,
  deleteFile,
  getFileRuntimeContext,
};
