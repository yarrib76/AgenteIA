(function () {
  const messagingMsg = document.getElementById("messagingMsg");
  const channelForm = document.getElementById("messagingChannelForm");
  const telegramConfigForm = document.getElementById("telegramConfigForm");
  const refreshMessagingBtn = document.getElementById("refreshMessagingBtn");
  const refreshWhatsappBtn = document.getElementById("refreshWhatsappBtn");
  const refreshTelegramBtn = document.getElementById("refreshTelegramBtn");
  const waStatusText = document.getElementById("waStatusText");
  const waPhoneText = document.getElementById("waPhoneText");
  const waQrContainer = document.getElementById("waQrContainer");
  const tgStatusText = document.getElementById("tgStatusText");
  const tgBotText = document.getElementById("tgBotText");

  if (!channelForm) return;

  function renderStatus(payload) {
    if (!payload || !payload.providers) return;
    const wa = payload.providers.whatsapp || {};
    const tg = payload.providers.telegram || {};

    if (waStatusText) waStatusText.textContent = wa.statusText || "Sin estado";
    if (waPhoneText) waPhoneText.textContent = wa.phoneNumber || "Sin vincular";
    if (waQrContainer) {
      if (wa.qrDataUrl) {
        waQrContainer.innerHTML = `<img src="${wa.qrDataUrl}" alt="QR de WhatsApp" />`;
      } else if (wa.linked) {
        waQrContainer.innerHTML = "<p>Ya vinculado.</p>";
      } else {
        waQrContainer.innerHTML = "<p>QR no disponible por el momento.</p>";
      }
    }

    if (tgStatusText) tgStatusText.textContent = tg.statusText || "Sin estado";
    if (tgBotText) tgBotText.textContent = tg.botUsername || "Sin configurar";
  }

  async function fetchStatus() {
    const response = await fetch("/api/messaging/status");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudo obtener el estado.");
    }
    renderStatus(data);
  }

  channelForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    messagingMsg.textContent = "Guardando canal...";
    const formData = new FormData(channelForm);
    try {
      const response = await fetch("/api/messaging/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeChannel: formData.get("activeChannel") }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar el canal.");
      }
      messagingMsg.textContent = "Canal actualizado.";
      setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      messagingMsg.textContent = error.message;
    }
  });

  if (telegramConfigForm) {
    telegramConfigForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      messagingMsg.textContent = "Guardando Telegram...";
      const formData = new FormData(telegramConfigForm);
      try {
        const response = await fetch("/api/messaging/telegram/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramBotToken: formData.get("telegramBotToken"),
            telegramBotUsername: formData.get("telegramBotUsername"),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo guardar la configuracion.");
        }
        messagingMsg.textContent = "Telegram actualizado.";
        renderStatus(data);
      } catch (error) {
        messagingMsg.textContent = error.message;
      }
    });
  }

  async function refreshProvider(channel) {
    const response = await fetch("/api/messaging/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudo refrescar el proveedor.");
    }
    renderStatus(data);
  }

  if (refreshMessagingBtn) {
    refreshMessagingBtn.addEventListener("click", async () => {
      try {
        await fetchStatus();
      } catch (error) {
        messagingMsg.textContent = error.message;
      }
    });
  }
  if (refreshWhatsappBtn) {
    refreshWhatsappBtn.addEventListener("click", async () => {
      try {
        messagingMsg.textContent = "Refrescando WhatsApp...";
        await refreshProvider("whatsapp");
        messagingMsg.textContent = "WhatsApp actualizado.";
      } catch (error) {
        messagingMsg.textContent = error.message;
      }
    });
  }
  if (refreshTelegramBtn) {
    refreshTelegramBtn.addEventListener("click", async () => {
      try {
        messagingMsg.textContent = "Reiniciando Telegram...";
        await refreshProvider("telegram");
        messagingMsg.textContent = "Telegram actualizado.";
      } catch (error) {
        messagingMsg.textContent = error.message;
      }
    });
  }

  if (typeof io === "function") {
    const socket = io();
    socket.on("whatsapp-status", () => {
      fetchStatus().catch(() => {});
    });
    socket.on("telegram-status", () => {
      fetchStatus().catch(() => {});
    });
  }

  setInterval(() => {
    fetchStatus().catch(() => {});
  }, 10000);

  fetchStatus().catch(() => {});
})();
