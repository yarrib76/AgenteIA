(function () {
  const form = document.getElementById("agendaForm");
  const msg = document.getElementById("agendaMsg");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "Guardando...";

    const formData = new FormData(form);
    const payload = {
      name: formData.get("name"),
      phone: formData.get("phone"),
    };

    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el contacto.");
      }
      msg.textContent = "Contacto guardado.";
      form.reset();
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      msg.textContent = error.message;
    }
  });
})();

