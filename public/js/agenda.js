(function () {
  const form = document.getElementById("agendaForm");
  const msg = document.getElementById("agendaMsg");
  const contactIdInput = document.getElementById("contactId");
  const saveContactBtn = document.getElementById("saveContactBtn");
  const cancelEditBtn = document.getElementById("cancelEditContactBtn");
  const nameInput = form ? form.querySelector('input[name="name"]') : null;
  const phoneInput = form ? form.querySelector('input[name="phone"]') : null;
  const editButtons = document.querySelectorAll(".edit-contact-btn");
  const deleteButtons = document.querySelectorAll(".delete-contact-btn");

  if (!form) return;

  function setCreateMode() {
    form.reset();
    if (contactIdInput) contactIdInput.value = "";
    if (saveContactBtn) saveContactBtn.textContent = "Guardar contacto";
    if (cancelEditBtn) cancelEditBtn.classList.add("hidden");
    msg.textContent = "";
  }

  function setEditMode(contact) {
    if (contactIdInput) contactIdInput.value = contact.id;
    if (nameInput) nameInput.value = contact.name || "";
    if (phoneInput) phoneInput.value = contact.phone || "";
    if (saveContactBtn) saveContactBtn.textContent = "Guardar cambios";
    if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");
    msg.textContent = `Editando contacto: ${contact.name}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", setCreateMode);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "Guardando...";

    const formData = new FormData(form);
    const contactId = String(formData.get("contactId") || "").trim();
    const payload = {
      name: formData.get("name"),
      phone: formData.get("phone"),
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
        phone: button.dataset.phone,
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
})();
