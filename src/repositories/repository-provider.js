const { createJsonDriver } = require("./json/json.driver");

let cached = null;

function getRepositories() {
  if (cached) return cached;

  const driver = String(process.env.STORAGE_DRIVER || "json")
    .trim()
    .toLowerCase();

  if (driver !== "json") {
    throw new Error(`STORAGE_DRIVER no soportado: ${driver}`);
  }

  cached = createJsonDriver();
  return cached;
}

module.exports = {
  getRepositories,
};

