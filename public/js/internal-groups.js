(function () {
  const form = document.getElementById("internalGroupForm");
  const idInput = document.getElementById("internalGroupId");
  const nameInput = document.getElementById("internalGroupName");
  const descriptionInput = document.getElementById("internalGroupDescription");
  const membersSelect = document.getElementById("internalGroupMembers");
  const msg = document.getElementById("internalGroupMsg");
  const formTitle = document.getElementById("internalGroupFormTitle");
  const cancelBtn = document.getElementById("cancelInternalGroupEditBtn");
  const preview = document.getElementById("internalGroupMembersPreview");

  if (!form || !membersSelect) return;

  function selectedMemberIds() {
    return Array.from(membersSelect.selectedOptions).map((option) => option.value).filter(Boolean);
  }

  function updatePreview() {
    const names = Array.from(membersSelect.selectedOptions).map((option) => option.textContent.trim());
    preview.textContent = names.length ? names.join(", ") : "Sin usuarios seleccionados.";
  }

  function resetForm() {
    idInput.value = "";
    nameInput.value = "";
    descriptionInput.value = "";
    Array.from(membersSelect.options).forEach((option) => {
      option.selected = false;
    });
    formTitle.textContent = "Nuevo grupo interno";
    cancelBtn.classList.add("hidden");
    updatePreview();
  }

  function fillForm(button) {
    idInput.value = button.dataset.id || "";
    nameInput.value = button.dataset.name || "";
    descriptionInput.value = button.dataset.description || "";
    const memberIds = String(button.dataset.memberUserIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    Array.from(membersSelect.options).forEach((option) => {
      option.selected = memberIds.includes(option.value);
    });
    formTitle.textContent = "Editar grupo interno";
    cancelBtn.classList.remove("hidden");
    updatePreview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitForm(event) {
    event.preventDefault();
    msg.textContent = "";
    const payload = {
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      memberUserIds: selectedMemberIds(),
    };
    const groupId = idInput.value.trim();
    const method = groupId ? "PUT" : "POST";
    const url = groupId ? `/api/internal-chat/groups/${groupId}` : "/api/internal-chat/groups";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el grupo.");
      }
      window.location.reload();
    } catch (error) {
      msg.textContent = error.message;
    }
  }

  async function deleteGroup(button) {
    const groupId = button.dataset.id || "";
    if (!groupId) return;
    const confirmed = window.confirm("Se eliminara el grupo interno. Continuar?");
    if (!confirmed) return;
    msg.textContent = "";
    try {
      const response = await fetch(`/api/internal-chat/groups/${groupId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo eliminar el grupo.");
      }
      window.location.reload();
    } catch (error) {
      msg.textContent = error.message;
    }
  }

  membersSelect.addEventListener("change", updatePreview);
  cancelBtn.addEventListener("click", resetForm);
  form.addEventListener("submit", submitForm);

  document.querySelectorAll(".edit-internal-group-btn").forEach((button) => {
    button.addEventListener("click", () => fillForm(button));
  });
  document.querySelectorAll(".delete-internal-group-btn").forEach((button) => {
    button.addEventListener("click", () => deleteGroup(button));
  });

  updatePreview();
})();
