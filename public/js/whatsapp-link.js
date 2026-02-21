(function () {
  const qrContainer = document.getElementById("qrContainer");
  const statusText = document.getElementById("statusText");
  const phoneText = document.getElementById("phoneText");
  const lastUpdate = document.getElementById("lastUpdate");
  const refreshBtn = document.getElementById("refreshQrBtn");

  function renderStatus(status) {
    if (!status) return;

    statusText.textContent = status.statusText || "Sin estado";
    phoneText.textContent = status.phoneNumber || "Sin vincular";
    lastUpdate.textContent = status.lastUpdate || "-";

    if (status.qrDataUrl) {
      qrContainer.innerHTML = `<img src="${status.qrDataUrl}" alt="QR de WhatsApp" id="qrImage" />`;
    } else if (!status.linked) {
      qrContainer.innerHTML = '<p id="qrPlaceholder">Esperando generacion de QR...</p>';
    } else {
      qrContainer.innerHTML = "<p>Ya vinculado. No se requiere QR.</p>";
    }
  }

  async function fetchStatus() {
    try {
      const response = await fetch("/api/whatsapp/status");
      const data = await response.json();
      renderStatus(data);
    } catch (error) {
      statusText.textContent = "Error consultando estado";
    }
  }

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      const response = await fetch("/api/whatsapp/qr/refresh", {
        method: "POST",
      });
      const payload = await response.json();
      if (payload && payload.status) {
        renderStatus(payload.status);
      }

      // El QR puede tardar unos segundos en regenerarse en el backend.
      setTimeout(fetchStatus, 1200);
      setTimeout(fetchStatus, 2800);
    } catch (error) {
      statusText.textContent = "Error al refrescar QR";
    } finally {
      refreshBtn.disabled = false;
    }
  });

  const socket = io();
  socket.on("whatsapp-status", renderStatus);

  fetchStatus();
  setInterval(fetchStatus, 10000);
})();
