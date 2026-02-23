const integrationsService = require("../modules/integration/api-integrations.service");

async function renderIntegrationsPage(req, res) {
  const integrations = await integrationsService.listIntegrations();
  res.render("layouts/main", {
    pageTitle: "Integraciones API",
    activeMenu: "integrations",
    headerTitle: "Integraciones API",
    moduleView: "integrations",
    moduleData: { integrations },
    pageScripts: ["/js/integrations.js"],
  });
}

async function listIntegrations(req, res) {
  const integrations = await integrationsService.listIntegrations();
  res.json({ ok: true, integrations });
}

async function createIntegration(req, res) {
  try {
    const integration = await integrationsService.createIntegration(req.body);
    res.status(201).json({ ok: true, integration });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateIntegration(req, res) {
  try {
    const integration = await integrationsService.updateIntegration(
      req.params.integrationId,
      req.body
    );
    res.json({ ok: true, integration });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteIntegration(req, res) {
  try {
    const integration = await integrationsService.deleteIntegration(req.params.integrationId);
    res.json({ ok: true, integration });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderIntegrationsPage,
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
};
