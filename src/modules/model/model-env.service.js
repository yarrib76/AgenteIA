const fs = require("fs/promises");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

async function readEnvLines() {
  try {
    const raw = await fs.readFile(ENV_FILE, "utf-8");
    return raw.split(/\r?\n/);
  } catch (error) {
    return [];
  }
}

function parseEnvLine(line) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

async function writeEnvLines(lines) {
  const content = `${lines.filter((line) => line !== undefined).join("\n").trimEnd()}\n`;
  await fs.writeFile(ENV_FILE, content, "utf-8");
}

async function getKeyValue(key) {
  const lines = await readEnvLines();
  let foundInFile = false;
  let fileValue = "";
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key === key) {
      foundInFile = true;
      fileValue = parsed.value;
      break;
    }
  }
  if (foundInFile) {
    const normalized = String(fileValue || "").trim();
    if (normalized) return fileValue;
  }
  return String(process.env[key] || "");
}

async function upsertKey(key, value = "") {
  const lines = await readEnvLines();
  const nextValue = String(value || "");
  let found = false;
  const next = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key === key) {
      found = true;
      const currentValue = String(parsed.value || "");
      const currentHasValue = currentValue.trim().length > 0;
      const nextHasValue = nextValue.trim().length > 0;

      // Evita pisar una clave ya cargada con valor por un update vacio.
      if (!nextHasValue && currentHasValue) {
        return line;
      }
      return `${key}=${nextValue}`;
    }
    return line;
  });
  if (!found) {
    // Si no hay valor para guardar, no crear una entrada vacia en .env.
    if (nextValue.trim().length > 0) {
      next.push(`${key}=${nextValue}`);
    } else {
      return;
    }
  }
  await writeEnvLines(next);
}

async function removeKey(key) {
  const lines = await readEnvLines();
  const next = lines.filter((line) => {
    const parsed = parseEnvLine(line);
    return !(parsed && parsed.key === key);
  });
  await writeEnvLines(next);
}

module.exports = {
  getKeyValue,
  upsertKey,
  removeKey,
};
