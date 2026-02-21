const { randomUUID } = require("crypto");
const { getRepositories } = require("../../repositories/repository-provider");

async function listAgents() {
  const { agents: agentsRepo } = getRepositories();
  const agents = await agentsRepo.list();
  return agents.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createAgent({ name, roleId, modelId }) {
  const agentName = String(name || "").trim();
  const nextRoleId = String(roleId || "").trim();
  const nextModelId = String(modelId || "").trim();

  if (!agentName) throw new Error("El nombre del agente es obligatorio.");
  if (!nextRoleId) throw new Error("Debes seleccionar un rol.");
  if (!nextModelId) throw new Error("Debes seleccionar un modelo.");

  const { agents: agentsRepo } = getRepositories();
  const agents = await agentsRepo.list();
  const exists = agents.some(
    (agent) => agent.name.toLowerCase() === agentName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un agente con ese nombre.");

  const agent = {
    id: randomUUID(),
    name: agentName,
    roleId: nextRoleId,
    modelId: nextModelId,
    createdAt: new Date().toISOString(),
  };

  agents.push(agent);
  await agentsRepo.saveAll(agents);
  return agent;
}

async function getAgentById(agentId) {
  const { agents: agentsRepo } = getRepositories();
  const agents = await agentsRepo.list();
  return agents.find((agent) => agent.id === agentId) || null;
}

async function updateAgent(agentId, { name, roleId, modelId }) {
  const agentName = String(name || "").trim();
  const nextRoleId = String(roleId || "").trim();
  const nextModelId = String(modelId || "").trim();

  if (!agentName) throw new Error("El nombre del agente es obligatorio.");
  if (!nextRoleId) throw new Error("Debes seleccionar un rol.");
  if (!nextModelId) throw new Error("Debes seleccionar un modelo.");

  const { agents: agentsRepo } = getRepositories();
  const agents = await agentsRepo.list();
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index < 0) throw new Error("Agente no encontrado.");

  const exists = agents.some(
    (agent) =>
      agent.id !== agentId &&
      agent.name.toLowerCase() === agentName.toLowerCase()
  );
  if (exists) throw new Error("Ya existe un agente con ese nombre.");

  agents[index] = {
    ...agents[index],
    name: agentName,
    roleId: nextRoleId,
    modelId: nextModelId,
    updatedAt: new Date().toISOString(),
  };

  await agentsRepo.saveAll(agents);
  return agents[index];
}

async function deleteAgent(agentId) {
  const { agents: agentsRepo } = getRepositories();
  const agents = await agentsRepo.list();
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index < 0) throw new Error("Agente no encontrado.");

  const [removed] = agents.splice(index, 1);
  await agentsRepo.saveAll(agents);
  return removed;
}

module.exports = {
  listAgents,
  createAgent,
  getAgentById,
  updateAgent,
  deleteAgent,
};
