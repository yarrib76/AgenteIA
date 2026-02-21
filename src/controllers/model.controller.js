const modelsService = require("../modules/model/models.service");
const modelTestService = require("../modules/model/model-test.service");

async function renderModelsPage(req, res) {
  const models = await modelsService.listModels();
  res.render("layouts/main", {
    pageTitle: "Modelos",
    activeMenu: "models",
    headerTitle: "Modelos",
    moduleView: "models",
    moduleData: { models },
    pageScripts: ["/js/models.js"],
  });
}

async function createModel(req, res) {
  try {
    const model = await modelsService.createModel(req.body);
    res.status(201).json({ ok: true, model });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function updateModel(req, res) {
  try {
    const model = await modelsService.updateModel(req.params.modelId, req.body);
    res.json({ ok: true, model });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function deleteModel(req, res) {
  try {
    await modelsService.deleteModel(req.params.modelId);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message });
  }
}

async function testModel(req, res) {
  try {
    const model = await modelsService.getModelById(req.params.modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: "Modelo no encontrado." });
    }

    const output = await modelTestService.testModel({
      envKey: model.envKey,
      modelName: model.name,
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      message: req.body.message,
    });

    return res.json({ ok: true, output });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}

module.exports = {
  renderModelsPage,
  createModel,
  updateModel,
  deleteModel,
  testModel,
};
