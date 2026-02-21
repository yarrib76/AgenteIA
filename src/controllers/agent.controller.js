const agentsService = require("../modules/agent/agents.service");
const rolesService = require("../modules/agent/roles.service");
const modelsService = require("../modules/model/models.service");

async function renderNewAgentPage(req, res) {
  const [roles, agents, models] = await Promise.all([
    rolesService.listRoles(),
    agentsService.listAgents(),
    modelsService.listModels(),
  ]);

  res.render("layouts/main", {
    pageTitle: "Agente - Nuevo Agente",
    activeMenu: "agent-new",
    headerTitle: "Nuevo Agente",
    moduleView: "agent-new",
    moduleData: {
      roles,
      agents,
      models,
    },
    pageScripts: ["/js/agent-new.js"],
  });
}

async function renderRolesPage(req, res) {
  const [roles, agents] = await Promise.all([
    rolesService.listRoles(),
    agentsService.listAgents(),
  ]);

  const usageByRoleId = agents.reduce((acc, agent) => {
    acc[agent.roleId] = (acc[agent.roleId] || 0) + 1;
    return acc;
  }, {});

  res.render("layouts/main", {
    pageTitle: "Agente - Roles",
    activeMenu: "agent-roles",
    headerTitle: "Roles",
    moduleView: "agent-roles",
    moduleData: {
      roles,
      usageByRoleId,
    },
    pageScripts: ["/js/agent-roles.js"],
  });
}

async function listRoles(req, res) {
  const roles = await rolesService.listRoles();
  res.json({ ok: true, roles });
}

async function createRole(req, res) {
  try {
    const role = await rolesService.createRole(req.body);
    res.status(201).json({ ok: true, role });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function createAgent(req, res) {
  try {
    const { roleId, modelId } = req.body;
    const role = await rolesService.getRoleById(roleId);
    if (!role) {
      return res.status(400).json({ ok: false, message: "Rol invalido." });
    }
    const model = await modelsService.getModelById(modelId);
    if (!model) {
      return res.status(400).json({ ok: false, message: "Modelo invalido." });
    }
    const agent = await agentsService.createAgent(req.body);
    return res.status(201).json({ ok: true, agent });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateAgent(req, res) {
  try {
    const { agentId } = req.params;
    const { roleId, modelId } = req.body;
    const role = await rolesService.getRoleById(roleId);
    if (!role) {
      return res.status(400).json({ ok: false, message: "Rol invalido." });
    }
    const model = await modelsService.getModelById(modelId);
    if (!model) {
      return res.status(400).json({ ok: false, message: "Modelo invalido." });
    }

    const agent = await agentsService.updateAgent(agentId, req.body);
    return res.json({ ok: true, agent });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteAgent(req, res) {
  try {
    await agentsService.deleteAgent(req.params.agentId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateRole(req, res) {
  try {
    const role = await rolesService.updateRole(req.params.roleId, req.body);
    return res.json({ ok: true, role });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteRole(req, res) {
  try {
    const roleId = req.params.roleId;
    const agents = await agentsService.listAgents();
    const inUse = agents.some((agent) => agent.roleId === roleId);
    if (inUse) {
      return res.status(400).json({
        ok: false,
        message: "No se puede eliminar un rol que esta asignado a agentes.",
      });
    }

    await rolesService.deleteRole(roleId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderNewAgentPage,
  renderRolesPage,
  listRoles,
  createRole,
  createAgent,
  updateAgent,
  deleteAgent,
  updateRole,
  deleteRole,
};
