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
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key === key) return parsed.value;
  }
  return String(process.env[key] || "");
}

async function upsertKey(key, value = "") {
  const lines = await readEnvLines();
  let found = false;
  const next = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
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
