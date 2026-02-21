(function () {
  const form = document.getElementById("agendaForm");
  const msg = document.getElementById("agendaMsg");
  const contactIdInput = document.getElementById("contactId");
  const contactTypeInput = document.getElementById("contactType");
  const contactPhoneField = document.getElementById("contactPhoneField");
  const contactGroupField = document.getElementById("contactGroupField");
  const contactGroupIdSelect = document.getElementById("contactGroupId");
  const refreshGroupsBtn = document.getElementById("refreshGroupsBtn");
  const saveContactBtn = document.getElementById("saveContactBtn");
  const cancelEditBtn = document.getElementById("cancelEditContactBtn");
  const nameInput = form ? form.querySelector('input[name="name"]') : null;
  const phoneInput = form ? form.querySelector('input[name="phone"]') : null;
  const groupIdInput = form ? form.querySelector('[name="groupId"]') : null;
  const editButtons = document.querySelectorAll(".edit-contact-btn");
  const deleteButtons = document.querySelectorAll(".delete-contact-btn");

  if (!form) return;

  function updateTypeFields() {
    const isGroup = String(contactTypeInput && contactTypeInput.value) === "group";
    if (contactPhoneField) contactPhoneField.classList.toggle("hidden", isGroup);
    if (contactGroupField) contactGroupField.classList.toggle("hidden", !isGroup);
    if (phoneInput) phoneInput.required = !isGroup;
    if (groupIdInput) groupIdInput.required = isGroup;
    if (isGroup) {
      loadGroups(groupIdInput ? groupIdInput.value : "");
    }
  }

  async function loadGroups(selectedGroupId) {
    if (!contactGroupIdSelect) return;
    const selected = String(selectedGroupId || "").trim();
    contactGroupIdSelect.innerHTML = '<option value="">Cargando grupos...</option>';
    if (refreshGroupsBtn) refreshGroupsBtn.disabled = true;
    try {
      const response = await fetch("/api/whatsapp/groups");
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudieron cargar los grupos.");
      }
      const groups = Array.isArray(data.groups) ? data.groups : [];
      contactGroupIdSelect.innerHTML = '<option value="">Seleccionar grupo...</option>';
      groups.forEach((group) => {
        const option = document.createElement("option");
        option.value = String(group.id || "").trim();
        option.dataset.groupName = String(group.name || "Grupo").trim();
        option.textContent = `${group.name || "Grupo"} (${group.id || ""})`;
        contactGroupIdSelect.appendChild(option);
      });

      if (selected) {
        const exists = groups.some((group) => String(group.id || "").trim() === selected);
        if (!exists) {
          const legacyOption = document.createElement("option");
          legacyOption.value = selected;
          legacyOption.dataset.groupName = "";
          legacyOption.textContent = `Grupo guardado (${selected})`;
          contactGroupIdSelect.appendChild(legacyOption);
        }
        contactGroupIdSelect.value = selected;
      }
    } catch (error) {
      contactGroupIdSelect.innerHTML =
        '<option value="">No se pudieron cargar grupos</option>';
      msg.textContent = error.message;
    } finally {
      if (refreshGroupsBtn) refreshGroupsBtn.disabled = false;
    }
  }

  function setCreateMode() {
    form.reset();
    if (contactIdInput) contactIdInput.value = "";
    if (contactTypeInput) contactTypeInput.value = "contact";
    if (saveContactBtn) saveContactBtn.textContent = "Guardar contacto";
    if (cancelEditBtn) cancelEditBtn.classList.add("hidden");
    msg.textContent = "";
    updateTypeFields();
  }

  function setEditMode(contact) {
    if (contactIdInput) contactIdInput.value = contact.id;
    if (contactTypeInput) contactTypeInput.value = contact.type || "contact";
    if (nameInput) nameInput.value = contact.name || "";
    if (phoneInput) phoneInput.value = contact.phone || "";
    if (groupIdInput) groupIdInput.value = contact.groupId || "";
    if (saveContactBtn) saveContactBtn.textContent = "Guardar cambios";
    if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");
    msg.textContent = `Editando contacto: ${contact.name}`;
    updateTypeFields();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", setCreateMode);
  }
  if (contactTypeInput) {
    contactTypeInput.addEventListener("change", updateTypeFields);
  }
  if (refreshGroupsBtn) {
    refreshGroupsBtn.addEventListener("click", () => {
      loadGroups(groupIdInput ? groupIdInput.value : "");
    });
  }
  if (contactGroupIdSelect) {
    contactGroupIdSelect.addEventListener("change", () => {
      const selectedOption =
        contactGroupIdSelect.options[contactGroupIdSelect.selectedIndex] || null;
      const groupName = selectedOption ? String(selectedOption.dataset.groupName || "").trim() : "";
      if (groupName && nameInput) {
        nameInput.value = groupName;
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "Guardando...";

    const formData = new FormData(form);
    const contactId = String(formData.get("contactId") || "").trim();
    const payload = {
      type: formData.get("type"),
      name: formData.get("name"),
      phone: formData.get("phone"),
      groupId: formData.get("groupId"),
    };

    try {
      const isEdit = Boolean(contactId);
      const response = await fetch(isEdit ? `/api/contacts/${contactId}` : "/api/contacts", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el contacto.");
      }
      msg.textContent = isEdit ? "Contacto actualizado." : "Contacto guardado.";
      setCreateMode();
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  editButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setEditMode({
        id: button.dataset.id,
        name: button.dataset.name,
        type: button.dataset.type || "contact",
        phone: button.dataset.phone,
        groupId: button.dataset.groupId || "",
      });
    });
  });

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Se eliminara el contacto "${button.dataset.name}". Esta accion no se puede deshacer.`
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/contacts/${button.dataset.id}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar el contacto.");
        }
        msg.textContent = "Contacto eliminado.";
        setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        msg.textContent = error.message;
      }
    });
  });

  updateTypeFields();
  if (contactTypeInput && contactTypeInput.value === "group") {
    loadGroups(groupIdInput ? groupIdInput.value : "");
  }
})();
