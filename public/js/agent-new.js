(function () {
  const agentForm = document.getElementById("agentForm");
  const roleSelect = document.getElementById("roleSelect");
  const modelSelect = document.getElementById("modelSelect");
  const agentMsg = document.getElementById("agentMsg");
  const agentIdInput = document.getElementById("agentId");
  const agentNameInput = document.getElementById("agentName");
  const agentFormTitle = document.getElementById("agentFormTitle");
  const saveAgentBtn = document.getElementById("saveAgentBtn");
  const cancelEditAgentBtn = document.getElementById("cancelEditAgentBtn");
  const editAgentButtons = document.querySelectorAll(".edit-agent-btn");
  const deleteAgentButtons = document.querySelectorAll(".delete-agent-btn");

  const roleModal = document.getElementById("roleModal");
  const openRoleModalBtn = document.getElementById("openRoleModalBtn");
  const closeRoleModalBtn = document.getElementById("closeRoleModalBtn");
  const roleForm = document.getElementById("roleForm");
  const roleMsg = document.getElementById("roleMsg");

  if (!agentForm || !roleForm) return;

  function setAgentCreateMode() {
    agentIdInput.value = "";
    agentFormTitle.textContent = "Crear agente";
    saveAgentBtn.textContent = "Guardar agente";
    cancelEditAgentBtn.classList.add("hidden");
    agentForm.reset();
  }

  function setAgentEditMode(agent) {
    agentIdInput.value = agent.id;
    agentNameInput.value = agent.name;
    roleSelect.value = agent.roleId;
    modelSelect.value = agent.modelId || "";
    agentFormTitle.textContent = "Editar agente";
    saveAgentBtn.textContent = "Guardar cambios";
    cancelEditAgentBtn.classList.remove("hidden");
    agentMsg.textContent = `Editando agente: ${agent.name}`;
  }

  function openRoleModal() {
    roleModal.classList.remove("hidden");
  }

  function closeRoleModal() {
    roleModal.classList.add("hidden");
    roleMsg.textContent = "";
    roleForm.reset();
  }

  async function refreshRoles(selectRoleId) {
    const response = await fetch("/api/roles");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudieron cargar los roles.");
    }

    roleSelect.innerHTML = '<option value="">Seleccionar...</option>';
    (data.roles || []).forEach((role) => {
      const option = document.createElement("option");
      option.value = role.id;
      option.textContent = role.name;
      roleSelect.appendChild(option);
    });

    if (selectRoleId) roleSelect.value = selectRoleId;
  }

  openRoleModalBtn.addEventListener("click", openRoleModal);
  closeRoleModalBtn.addEventListener("click", closeRoleModal);
  cancelEditAgentBtn.addEventListener("click", setAgentCreateMode);

  roleModal.addEventListener("click", (event) => {
    if (event.target === roleModal) closeRoleModal();
  });

  roleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    roleMsg.textContent = "Guardando rol...";

    const formData = new FormData(roleForm);
    const payload = {
      name: formData.get("name"),
      detail: formData.get("detail"),
    };

    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo crear el rol.");
      }
      await refreshRoles(data.role.id);
      closeRoleModal();
      agentMsg.textContent = `Rol creado: ${data.role.name}`;
    } catch (error) {
      roleMsg.textContent = error.message;
    }
  });

  agentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    agentMsg.textContent = "Guardando agente...";

    const formData = new FormData(agentForm);
    const payload = {
      name: formData.get("name"),
      roleId: formData.get("roleId"),
      modelId: formData.get("modelId"),
    };
    const agentId = formData.get("agentId");

    try {
      const isEdit = Boolean(agentId);
      const url = isEdit ? `/api/agents/${agentId}` : "/api/agents";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo crear el agente.");
      }
      agentMsg.textContent = isEdit
        ? "Agente actualizado."
        : "Agente guardado.";
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      agentMsg.textContent = error.message;
    }
  });

  editAgentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAgentEditMode({
        id: button.dataset.id,
        name: button.dataset.name,
        roleId: button.dataset.roleId,
        modelId: button.dataset.modelId,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  deleteAgentButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const agentId = button.dataset.id;
      const confirmed = window.confirm(
        "Se eliminara el agente. Esta accion no se puede deshacer."
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/agents/${agentId}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar el agente.");
        }
        window.location.reload();
      } catch (error) {
        agentMsg.textContent = error.message;
      }
    });
  });
})();
