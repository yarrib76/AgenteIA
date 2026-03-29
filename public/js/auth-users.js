(function () {
  const userForm = document.getElementById("userForm");
  const modeInput = document.getElementById("userFormMode");
  const formTitle = document.getElementById("usersFormTitle");
  const formCopy = document.getElementById("usersFormCopy");
  const nameInput = document.getElementById("userNameInput");
  const emailInput = document.getElementById("userEmailInput");
  const passwordInput = document.getElementById("userPasswordInput");
  const confirmPasswordInput = document.getElementById("userConfirmPasswordInput");
  const passwordLabel = document.getElementById("userPasswordLabel");
  const confirmPasswordLabel = document.getElementById("userConfirmPasswordLabel");
  const passwordHint = document.getElementById("userPasswordHint");
  const captchaField = document.getElementById("captchaField");
  const captchaInput = document.getElementById("captchaInput");
  const submitBtn = document.getElementById("userSubmitBtn");
  const cancelBtn = document.getElementById("cancelUserEditBtn");
  const searchInput = document.getElementById("usersTableSearch");
  const usersTable = document.getElementById("usersTable");
  const editButtons = Array.from(document.querySelectorAll(".edit-user-btn"));

  if (!userForm) return;

  function setCreateMode() {
    modeInput.value = "create";
    userForm.action = "/register";
    if (formTitle) formTitle.textContent = "Crear nuevo usuario";
    if (formCopy) formCopy.textContent = "El nombre ayuda a identificar a la persona dentro del sistema. El email sigue siendo el identificador de acceso.";
    if (submitBtn) submitBtn.textContent = "Crear usuario";
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (passwordLabel) passwordLabel.textContent = "Contraseña";
    if (confirmPasswordLabel) confirmPasswordLabel.textContent = "Confirmar contraseña";
    if (passwordHint) passwordHint.textContent = "Mínimo 8 caracteres, con mayúsculas, minúsculas y números.";
    if (passwordInput) {
      passwordInput.required = true;
      passwordInput.value = "";
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.required = true;
      confirmPasswordInput.value = "";
    }
    if (captchaField) captchaField.classList.remove("hidden");
    if (captchaInput) {
      captchaInput.required = true;
      captchaInput.value = "";
    }
    userForm.reset();
  }

  function setEditMode(button) {
    const userId = String(button.dataset.userId || "").trim();
    if (!userId) return;
    modeInput.value = "edit";
    userForm.action = `/usuarios/${userId}/actualizar`;
    if (formTitle) formTitle.textContent = "Editando usuario";
    if (formCopy) formCopy.textContent = "Actualiza nombre, email o contraseña del usuario seleccionado.";
    if (submitBtn) submitBtn.textContent = "Guardar cambios";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (nameInput) nameInput.value = button.dataset.userName || "";
    if (emailInput) emailInput.value = button.dataset.userEmail || "";
    if (passwordLabel) passwordLabel.textContent = "Nueva contraseña";
    if (confirmPasswordLabel) confirmPasswordLabel.textContent = "Confirmar nueva contraseña";
    if (passwordHint) passwordHint.textContent = "Opcional. Completa ambas contraseñas solo si querés cambiarla.";
    if (passwordInput) {
      passwordInput.required = false;
      passwordInput.value = "";
    }
    if (confirmPasswordInput) {
      confirmPasswordInput.required = false;
      confirmPasswordInput.value = "";
    }
    if (captchaField) captchaField.classList.add("hidden");
    if (captchaInput) {
      captchaInput.required = false;
      captchaInput.value = "";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  editButtons.forEach((button) => {
    button.addEventListener("click", () => setEditMode(button));
  });

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => setCreateMode());
  }

  if (searchInput && usersTable) {
    const rows = Array.from(usersTable.querySelectorAll("tbody tr"));
    searchInput.addEventListener("input", () => {
      const term = String(searchInput.value || "").toLowerCase().trim();
      rows.forEach((row) => {
        const match = !term || String(row.textContent || "").toLowerCase().includes(term);
        row.style.display = match ? "" : "none";
      });
    });
  }
})();
