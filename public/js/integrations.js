(function () {
  const form = document.getElementById("integrationForm");
  const idInput = document.getElementById("integrationId");
  const nameInput = document.getElementById("integrationName");
  const methodInput = document.getElementById("integrationMethod");
  const urlInput = document.getElementById("integrationUrl");
  const headersInput = document.getElementById("integrationHeaders");
  const timeoutInput = document.getElementById("integrationTimeoutMs");
  const isActiveInput = document.getElementById("integrationIsActive");
  const saveBtn = document.getElementById("saveIntegrationBtn");
  const cancelBtn = document.getElementById("cancelIntegrationEditBtn");
  const title = document.getElementById("integrationFormTitle");
  const msg = document.getElementById("integrationMsg");
  const editButtons = document.querySelectorAll(".edit-integration-btn");
  const deleteButtons = document.querySelectorAll(".delete-integration-btn");

  if (!form) return;

  function setCreateMode() {
    form.reset();
    idInput.value = "";
    methodInput.value = "GET";
    timeoutInput.value = "15000";
    isActiveInput.checked = true;
    saveBtn.textContent = "Guardar integracion";
    title.textContent = "Nueva integracion API";
    cancelBtn.classList.add("hidden");
    msg.textContent = "";
  }

  function setEditMode(item) {
    idInput.value = item.id;
    nameInput.value = item.name || "";
    methodInput.value = item.method || "GET";
    urlInput.value = item.url || "";
    headersInput.value = item.headers || "{}";
    timeoutInput.value = String(item.timeoutMs || 15000);
    isActiveInput.checked = item.isActive === true;
    saveBtn.textContent = "Guardar cambios";
    title.textContent = "Editar integracion API";
    cancelBtn.classList.remove("hidden");
    msg.textContent = `Editando integracion: ${item.name}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelBtn.addEventListener("click", setCreateMode);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "Guardando...";
    const formData = new FormData(form);
    const integrationId = formData.get("integrationId");
    const payload = {
      name: formData.get("name"),
      method: formData.get("method"),
      url: formData.get("url"),
      headers: formData.get("headers"),
      timeoutMs: formData.get("timeoutMs"),
      isActive: Boolean(formData.get("isActive")),
    };

    try {
      const isEdit = Boolean(integrationId);
      const response = await fetch(
        isEdit ? `/api/integrations/${integrationId}` : "/api/integrations",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar la integracion.");
      }
      msg.textContent = isEdit ? "Integracion actualizada." : "Integracion creada.";
      setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  editButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setEditMode({
        id: button.dataset.id,
        name: button.dataset.name,
        method: button.dataset.method,
        url: button.dataset.url,
        headers: button.dataset.headers,
        timeoutMs: Number.parseInt(button.dataset.timeoutMs || "15000", 10),
        isActive: button.dataset.isActive === "true",
      });
    });
  });

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Se eliminara la integracion "${button.dataset.name}". Continuar?`
      );
      if (!confirmed) return;
      try {
        const response = await fetch(`/api/integrations/${button.dataset.id}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar la integracion.");
        }
        window.location.reload();
      } catch (error) {
        msg.textContent = error.message;
      }
    });
  });
})();
