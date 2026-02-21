const fs = require("fs/promises");
const path = require("path");

async function ensureFile(filePath, defaultValue) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch (error) {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), "utf-8");
  }
}

async function readJson(filePath, defaultValue) {
  await ensureFile(filePath, defaultValue);
  const raw = await fs.readFile(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    return defaultValue;
  }
}

async function writeJson(filePath, value) {
  await ensureFile(filePath, value);
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

module.exports = {
  readJson,
  writeJson,
  ensureFile,
};

