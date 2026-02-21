(function () {
  const modelForm = document.getElementById("modelForm");
  const modelIdInput = document.getElementById("modelId");
  const modelNameInput = document.getElementById("modelName");
  const modelProviderInput = document.getElementById("modelProvider");
  const modelApiIdInput = document.getElementById("modelApiId");
  const modelBaseUrlInput = document.getElementById("modelBaseUrl");
  const modelFormTitle = document.getElementById("modelFormTitle");
  const saveModelBtn = document.getElementById("saveModelBtn");
  const cancelModelEditBtn = document.getElementById("cancelModelEditBtn");
  const modelMsg = document.getElementById("modelMsg");
  const testButtons = document.querySelectorAll(".test-model-btn");
  const testModal = document.getElementById("modelTestModal");
  const closeModelTestBtn = document.getElementById("closeModelTestBtn");
  const modelTestForm = document.getElementById("modelTestForm");
  const modelTestId = document.getElementById("modelTestId");
  const modelTestTitle = document.getElementById("modelTestTitle");
  const modelTestInput = document.getElementById("modelTestInput");
  const runModelTestBtn = document.getElementById("runModelTestBtn");
  const modelTestMsg = document.getElementById("modelTestMsg");
  const modelTestOutput = document.getElementById("modelTestOutput");

  const editButtons = document.querySelectorAll(".edit-model-btn");
  const deleteButtons = document.querySelectorAll(".delete-model-btn");

  if (!modelForm) return;

  function setCreateMode() {
    modelForm.reset();
    modelIdInput.value = "";
    modelFormTitle.textContent = "Alta de modelo";
    saveModelBtn.textContent = "Guardar modelo";
    cancelModelEditBtn.classList.add("hidden");
    modelMsg.textContent = "";
    toggleBaseUrlVisibility();
  }

  function setEditMode(model) {
    modelIdInput.value = model.id;
    modelNameInput.value = model.name;
    modelProviderInput.value = model.provider || "openai";
    modelApiIdInput.value = model.modelId || model.name;
    modelBaseUrlInput.value = model.baseUrl || "";
    modelFormTitle.textContent = "Editar modelo";
    saveModelBtn.textContent = "Guardar cambios";
    cancelModelEditBtn.classList.remove("hidden");
    modelMsg.textContent = `Editando modelo: ${model.name}`;
    toggleBaseUrlVisibility();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleBaseUrlVisibility() {
    const wrap = modelBaseUrlInput.closest(".field");
    if (!wrap) return;
    const isCompatible = modelProviderInput.value === "openai_compatible";
    wrap.classList.toggle("hidden", !isCompatible);
    modelBaseUrlInput.required = isCompatible;
  }

  cancelModelEditBtn.addEventListener("click", setCreateMode);
  modelProviderInput.addEventListener("change", toggleBaseUrlVisibility);

  modelForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    modelMsg.textContent = "Guardando...";

    const formData = new FormData(modelForm);
    const modelId = formData.get("modelId");
    const payload = {
      name: formData.get("name"),
      provider: formData.get("provider"),
      modelId: formData.get("modelApiId"),
      baseUrl: formData.get("baseUrl"),
    };

    try {
      const isEdit = Boolean(modelId);
      const url = isEdit ? `/api/models/${modelId}` : "/api/models";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el modelo.");
      }

      modelMsg.textContent = isEdit ? "Modelo actualizado." : "Modelo creado.";
      setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      modelMsg.textContent = error.message;
    }
  });

  editButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setEditMode({
        id: button.dataset.id,
        name: button.dataset.name,
        provider: button.dataset.provider,
        modelId: button.dataset.modelId,
        baseUrl: button.dataset.baseUrl,
      });
    });
  });

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const modelId = button.dataset.id;
      const confirmed = window.confirm(
        "Se eliminara el modelo y su variable ApiKey del archivo .env. Continuar?"
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/models/${modelId}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar el modelo.");
        }
        window.location.reload();
      } catch (error) {
        modelMsg.textContent = error.message;
      }
    });
  });

  function openTestModal(model) {
    modelTestId.value = model.id;
    modelTestTitle.textContent = `Test de modelo: ${model.name}`;
    modelTestMsg.textContent = "";
    modelTestOutput.textContent = "";
    modelTestInput.value = "Responde brevemente: test de conexion correcto.";
    testModal.classList.remove("hidden");
  }

  function closeTestModal() {
    testModal.classList.add("hidden");
    modelTestMsg.textContent = "";
  }

  if (closeModelTestBtn) {
    closeModelTestBtn.addEventListener("click", closeTestModal);
  }

  if (testModal) {
    testModal.addEventListener("click", (event) => {
      if (event.target === testModal) closeTestModal();
    });
  }

  testButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openTestModal({
        id: button.dataset.id,
        name: button.dataset.name,
      });
    });
  });

  if (modelTestForm) {
    modelTestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      modelTestMsg.textContent = "Consultando modelo...";
      modelTestOutput.textContent = "";
      runModelTestBtn.disabled = true;

      try {
        const response = await fetch(`/api/models/${modelTestId.value}/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: modelTestInput.value }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo ejecutar el test.");
        }
        modelTestMsg.textContent = "Respuesta recibida.";
        modelTestOutput.textContent = data.output || "(sin contenido)";
      } catch (error) {
        modelTestMsg.textContent = error.message;
      } finally {
        runModelTestBtn.disabled = false;
      }
    });
  }

  toggleBaseUrlVisibility();
})();
