(function () {
  const roleForm = document.getElementById("roleCrudForm");
  const roleIdInput = document.getElementById("roleCrudId");
  const roleNameInput = document.getElementById("roleCrudName");
  const roleDetailInput = document.getElementById("roleCrudDetail");
  const roleMsg = document.getElementById("roleCrudMsg");
  const formTitle = document.getElementById("rolePageFormTitle");
  const saveRoleBtn = document.getElementById("saveRoleBtn");
  const cancelRoleEditBtn = document.getElementById("cancelRoleEditBtn");

  const editButtons = document.querySelectorAll(".edit-role-btn");
  const deleteButtons = document.querySelectorAll(".delete-role-btn");

  if (!roleForm) return;

  function setCreateMode() {
    roleForm.reset();
    roleIdInput.value = "";
    formTitle.textContent = "Crear rol";
    saveRoleBtn.textContent = "Guardar rol";
    cancelRoleEditBtn.classList.add("hidden");
    roleMsg.textContent = "";
  }

  function setEditMode(role) {
    roleIdInput.value = role.id;
    roleNameInput.value = role.name;
    roleDetailInput.value = role.detail;
    formTitle.textContent = "Editar rol";
    saveRoleBtn.textContent = "Guardar cambios";
    cancelRoleEditBtn.classList.remove("hidden");
    roleMsg.textContent = `Editando rol: ${role.name}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelRoleEditBtn.addEventListener("click", setCreateMode);

  roleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    roleMsg.textContent = "Guardando...";

    const formData = new FormData(roleForm);
    const roleId = formData.get("roleId");
    const payload = {
      name: formData.get("name"),
      detail: formData.get("detail"),
    };

    try {
      const isEdit = Boolean(roleId);
      const url = isEdit ? `/api/roles/${roleId}` : "/api/roles";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el rol.");
      }

      roleMsg.textContent = isEdit ? "Rol actualizado." : "Rol creado.";
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      roleMsg.textContent = error.message;
    }
  });

  editButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("tr");
      const detailSource = row ? row.querySelector(".role-detail-source") : null;
      setEditMode({
        id: button.dataset.id,
        name: button.dataset.name,
        detail: detailSource ? detailSource.value : "",
      });
    });
  });

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const roleId = button.dataset.id;
      const confirmed = window.confirm(
        "Se eliminara el rol. Esta accion no se puede deshacer."
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/roles/${roleId}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar el rol.");
        }
        window.location.reload();
      } catch (error) {
        roleMsg.textContent = error.message;
      }
    });
  });
})();
