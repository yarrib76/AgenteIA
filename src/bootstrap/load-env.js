const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(process.cwd(), ".env");

function parseEnvLine(line) {
  const match = String(line || "").match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  return {
    key: match[1],
    value: match[2],
  };
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const raw = fs.readFileSync(ENV_FILE, "utf-8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (typeof process.env[parsed.key] === "undefined") {
      process.env[parsed.key] = parsed.value;
    }
  }
}

module.exports = loadEnvFile;
