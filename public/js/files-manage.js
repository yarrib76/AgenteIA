(function () {
  const msg = document.getElementById("filesManageMsg");
  const deleteButtons = document.querySelectorAll(".delete-file-btn");
  if (!deleteButtons.length) return;

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const fileId = button.dataset.id;
      const fileName = button.dataset.name || "archivo";
      const confirmed = window.confirm(
        `Se eliminara el archivo "${fileName}". Esta accion no se puede deshacer.`
      );
      if (!confirmed) return;

      try {
        button.disabled = true;
        if (msg) msg.textContent = "Eliminando archivo...";
        const response = await fetch(`/api/files/${fileId}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar el archivo.");
        }
        if (msg) msg.textContent = "Archivo eliminado.";
        setTimeout(() => window.location.reload(), 300);
      } catch (error) {
        if (msg) msg.textContent = error.message;
        button.disabled = false;
      }
    });
  });
})();
