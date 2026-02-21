const { randomUUID } = require("crypto");
const modelEnvService = require("./model-env.service");
const { getRepositories } = require("../../repositories/repository-provider");

function buildApiKeyName(modelName) {
  const cleaned = String(modelName || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (!cleaned) throw new Error("Nombre de modelo invalido.");
  return `${cleaned}_ApiKey`;
}

function normalizeProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (!value) return "openai";
  if (["openai", "deepseek", "openai_compatible"].includes(value)) return value;
  throw new Error("Proveedor invalido.");
}

async function listModels() {
  const { models: modelsRepo } = getRepositories();
  const models = await modelsRepo.list();
  return models
    .map((model) => ({
      provider: "openai",
      modelId: model.name,
      baseUrl: "",
      ...model,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function getModelById(modelId) {
  const models = await listModels();
  return models.find((model) => model.id === modelId) || null;
}

async function createModel({ name, provider, modelId, baseUrl }) {
  const modelName = String(name || "").trim();
  const nextProvider = normalizeProvider(provider);
  const nextModelId = String(modelId || "").trim();
  const nextBaseUrl = String(baseUrl || "").trim();
  if (!modelName) throw new Error("El nombre del modelo es obligatorio.");
  if (!nextModelId) throw new Error("El Model ID es obligatorio.");

  const { models: modelsRepo } = getRepositories();
  const models = await listModels();
  const exists = models.some(
    (model) => model.name.toLowerCase() === modelName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un modelo con ese nombre.");
  if (nextProvider === "openai_compatible" && !nextBaseUrl) {
    throw new Error("Para OpenAI Compatible debes informar Base URL.");
  }

  const envKey = buildApiKeyName(modelName);
  const model = {
    id: randomUUID(),
    name: modelName,
    provider: nextProvider,
    modelId: nextModelId,
    baseUrl: nextBaseUrl,
    envKey,
    createdAt: new Date().toISOString(),
  };

  models.push(model);
  await modelsRepo.saveAll(models);
  await modelEnvService.upsertKey(envKey, "");
  return model;
}

async function updateModel(modelId, { name, provider, modelId: providerModelId, baseUrl }) {
  const modelName = String(name || "").trim();
  const nextProvider = normalizeProvider(provider);
  const nextModelId = String(providerModelId || "").trim();
  const nextBaseUrl = String(baseUrl || "").trim();
  if (!modelName) throw new Error("El nombre del modelo es obligatorio.");
  if (!nextModelId) throw new Error("El Model ID es obligatorio.");
  if (nextProvider === "openai_compatible" && !nextBaseUrl) {
    throw new Error("Para OpenAI Compatible debes informar Base URL.");
  }

  const { models: modelsRepo } = getRepositories();
  const models = await listModels();
  const index = models.findIndex((model) => model.id === modelId);
  if (index < 0) throw new Error("Modelo no encontrado.");

  const exists = models.some(
    (model) => model.id !== modelId && model.name.toLowerCase() === modelName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un modelo con ese nombre.");

  const oldEnvKey = models[index].envKey;
  const newEnvKey = buildApiKeyName(modelName);
  const oldValue = await modelEnvService.getKeyValue(oldEnvKey);

  models[index] = {
    ...models[index],
    name: modelName,
    provider: nextProvider,
    modelId: nextModelId,
    baseUrl: nextBaseUrl,
    envKey: newEnvKey,
    updatedAt: new Date().toISOString(),
  };
  await modelsRepo.saveAll(models);

  if (oldEnvKey !== newEnvKey) {
    await modelEnvService.removeKey(oldEnvKey);
    await modelEnvService.upsertKey(newEnvKey, oldValue);
  } else {
    await modelEnvService.upsertKey(newEnvKey, oldValue);
  }

  return models[index];
}

async function deleteModel(modelId) {
  const { models: modelsRepo } = getRepositories();
  const models = await listModels();
  const index = models.findIndex((model) => model.id === modelId);
  if (index < 0) throw new Error("Modelo no encontrado.");

  const [removed] = models.splice(index, 1);
  await modelsRepo.saveAll(models);
  await modelEnvService.removeKey(removed.envKey);
  return removed;
}

module.exports = {
  listModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
};
