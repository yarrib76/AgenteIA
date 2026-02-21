(function () {
  const contactSelect = document.getElementById("contactSelect");
  const chatWindow = document.getElementById("chatWindow");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatStatus = document.getElementById("chatStatus");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  let refreshTimer = null;
  let lastRenderedFingerprint = "";

  if (!contactSelect || !chatForm) return;

  function renderMessages(messages) {
    const fingerprint = JSON.stringify(
      (messages || []).map((m) => [m.id, m.timestamp, m.text, m.direction])
    );
    if (fingerprint === lastRenderedFingerprint) {
      return;
    }
    lastRenderedFingerprint = fingerprint;

    if (!messages || messages.length === 0) {
      chatWindow.innerHTML = '<p class="note">Sin mensajes recientes para este contacto.</p>';
      return;
    }
    chatWindow.innerHTML = messages
      .map((msg) => {
        const cls = msg.direction === "out" ? "out" : "in";
        return `<div class="message ${cls}">
          <div class="bubble">${escapeHtml(msg.text)}</div>
          <span class="meta">${msg.timestamp}</span>
        </div>`;
      })
      .join("");
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  async function loadConversation(contactId) {
    if (!contactId) {
      renderMessages([]);
      return;
    }
    try {
      const response = await fetch(`/api/chat/${contactId}/messages`);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo cargar la conversacion.");
      }
      renderMessages(data.messages || []);
      chatStatus.textContent = `Conversacion con ${data.contact.name}`;
    } catch (error) {
      chatStatus.textContent = error.message;
    }
  }

  function restartAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!contactSelect.value) return;
      loadConversation(contactSelect.value);
    }, 3000);
  }

  contactSelect.addEventListener("change", () => {
    const id = contactSelect.value;
    lastRenderedFingerprint = "";
    loadConversation(id);
    restartAutoRefresh();
  });

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const contactId = contactSelect.value;
    const message = chatInput.value.trim();
    if (!contactId) {
      chatStatus.textContent = "Selecciona un contacto.";
      return;
    }
    if (!message) return;

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, message }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo enviar el mensaje.");
      }
      chatInput.value = "";
      await loadConversation(contactId);
    } catch (error) {
      chatStatus.textContent = error.message;
    }
  });

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", async () => {
      const contactId = contactSelect.value;
      if (!contactId) {
        chatStatus.textContent = "Selecciona un contacto.";
        return;
      }
      const confirmed = window.confirm(
        "Se borrara el historial de esta conversacion. Continuar?"
      );
      if (!confirmed) return;

      clearHistoryBtn.disabled = true;
      try {
        const response = await fetch("/api/chat/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo borrar el historial.");
        }
        lastRenderedFingerprint = "";
        await loadConversation(contactId);
        chatStatus.textContent = `Historial borrado (${data.deletedCount} mensajes).`;
      } catch (error) {
        chatStatus.textContent = error.message;
      } finally {
        clearHistoryBtn.disabled = false;
      }
    });
  }

  if (contactSelect.value) {
    loadConversation(contactSelect.value);
    restartAutoRefresh();
  }
})();
