(function () {
  const contactSelect = document.getElementById("contactSelect");
  const chatWindow = document.getElementById("chatWindow");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatStatus = document.getElementById("chatStatus");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const activeChannelInput = document.getElementById("activeChannel");
  const internalActorModeInput = document.getElementById("internalActorMode");
  const internalActorModeSelect = document.getElementById("internalActorModeSelect");
  const selectedContactConfiguredInput = document.getElementById("selectedContactConfigured");
  const sendButton = chatForm ? chatForm.querySelector('button[type="submit"]') : null;
  const attachButton = document.getElementById("chatAttachBtn");
  const imageInput = document.getElementById("chatImageInput");
  const attachmentPreview = document.getElementById("chatAttachmentPreview");
  const attachmentImage = document.getElementById("chatAttachmentImage");
  const attachmentName = document.getElementById("chatAttachmentName");
  const attachmentClear = document.getElementById("chatAttachmentClear");
  const imageModal = document.getElementById("chatImageModal");
  const imageModalImage = document.getElementById("chatImageModalImage");
  const imageModalClose = document.getElementById("chatImageModalClose");
  let refreshTimer = null;
  let lastRenderedFingerprint = "";
  let pendingAttachment = null;
  const chatTimeZone = "America/Argentina/Buenos_Aires";

  if (!contactSelect || !chatForm) return;

  function buildActorQuery() {
    if (!internalActorModeInput || !internalActorModeInput.value) return "";
    return "?actor=" + encodeURIComponent(internalActorModeInput.value);
  }

  function normalizeImageAttachment(msg) {
    if (msg && msg.attachment && msg.attachment.type === "image" && msg.attachment.url) {
      return msg.attachment;
    }
    if (
      msg
      && msg.attachmentType === "image"
      && String(msg.fileId || "").trim()
      && String(msg.attachmentRelativePath || "").trim()
    ) {
      return {
        type: "image",
        fileId: msg.fileId,
        originalName: msg.attachmentOriginalName || "imagen",
        url: "/" + String(msg.attachmentRelativePath || "").replace(/^\/+/, ""),
        fallbackUrl: "/files/content/" + msg.fileId,
      };
    }
    return null;
  }

  function renderMessages(messages) {
    const fingerprint = JSON.stringify(
      (messages || []).map((m) => {
        const attachment = normalizeImageAttachment(m);
        return [m.id, m.timestamp, m.text, m.direction, m.senderName, m.conversationType, attachment && attachment.url];
      })
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
        const timestamp = formatTimestamp(msg.timestamp);
        const showSender = activeChannelInput && activeChannelInput.value === "internal_chat"
          && msg.direction !== "out"
          && msg.conversationType === "group"
          && String(msg.senderName || "").trim();
        const senderHtml = showSender
          ? `<div class="meta"><strong>${escapeHtml(msg.senderName)}</strong></div>`
          : "";
        const attachment = normalizeImageAttachment(msg);
        const imageHtml = attachment && attachment.url
          ? `<img class="chat-image" src="${escapeAttribute(attachment.url)}" data-fallback-src="${escapeAttribute(attachment.fallbackUrl || "")}" onerror="if(this.dataset.fallbackSrc && this.src.indexOf(this.dataset.fallbackSrc)===-1){this.src=this.dataset.fallbackSrc;}else{this.style.display='none';}" alt="${escapeAttribute(attachment.originalName || "imagen")}" />`
          : "";
        const textHtml = String(msg.text || "").trim()
          ? `<div>${escapeHtml(msg.text)}</div>`
          : "";
        return `<div class="message ${cls}">
          <div class="bubble">${senderHtml}${imageHtml}${textHtml}</div>
          <span class="meta">${escapeHtml(timestamp)}</span>
        </div>`;
      })
      .join("");
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function formatTimestamp(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: chatTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('"', "&quot;");
  }

  function clearAttachment() {
    if (pendingAttachment && pendingAttachment.previewUrl) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    pendingAttachment = null;
    if (imageInput) imageInput.value = "";
    if (attachmentPreview) attachmentPreview.classList.add("hidden");
    if (attachmentImage) attachmentImage.removeAttribute("src");
    if (attachmentName) attachmentName.textContent = "";
  }

  function openImageModal(src) {
    if (!imageModal || !imageModalImage || !src) return;
    imageModalImage.src = src;
    imageModal.classList.remove("hidden");
  }

  function closeImageModal() {
    if (!imageModal || !imageModalImage) return;
    imageModal.classList.add("hidden");
    imageModalImage.removeAttribute("src");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });
  }

  async function setPendingAttachment(file) {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      throw new Error("Solo se permiten imagenes JPG, PNG o WEBP.");
    }
    const dataUrl = await readFileAsDataUrl(file);
    clearAttachment();
    pendingAttachment = {
      originalName: file.name || "imagen",
      mimeType: file.type,
      contentBase64: dataUrl,
      previewUrl: URL.createObjectURL(file),
    };
    if (attachmentImage) attachmentImage.src = pendingAttachment.previewUrl;
    if (attachmentName) attachmentName.textContent = pendingAttachment.originalName;
    if (attachmentPreview) attachmentPreview.classList.remove("hidden");
  }

  async function handleClipboardPaste(event) {
    const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
    const imageItem = items.find((item) => item.type && item.type.startsWith("image/"));
    if (!imageItem) return;
    event.preventDefault();
    try {
      const file = imageItem.getAsFile();
      await setPendingAttachment(file);
      chatStatus.textContent = "Imagen lista para enviar.";
    } catch (error) {
      chatStatus.textContent = error.message;
    }
  }

  async function loadConversation(contactId) {
    if (!contactId) {
      renderMessages([]);
      return;
    }
    try {
      const response = await fetch(`/api/chat/${contactId}/messages${buildActorQuery()}`);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo cargar la conversacion.");
      }
      renderMessages(data.messages || []);
      const configured = data.configured !== false;
      if (chatInput) chatInput.disabled = !configured;
      if (sendButton) sendButton.disabled = !configured;
      if (attachButton) attachButton.disabled = !configured;
      if (selectedContactConfiguredInput) {
        selectedContactConfiguredInput.value = configured ? "true" : "false";
      }
      const channelLabel =
        activeChannelInput && activeChannelInput.value === "telegram"
          ? "Telegram"
          : activeChannelInput && activeChannelInput.value === "internal_chat"
            ? "interna"
            : "WhatsApp";
      const actorLabel = internalActorModeInput && internalActorModeInput.value === "system"
        ? "Sistema"
        : "tu usuario";
      chatStatus.textContent = configured
        ? (activeChannelInput && activeChannelInput.value === "internal_chat"
            ? `Conversacion ${channelLabel} con ${data.contact.name} (${actorLabel})`
            : `Conversacion ${channelLabel} con ${data.contact.name}`)
        : `El contacto ${data.contact.name} no esta configurado para este canal.`;
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
    clearAttachment();
    loadConversation(id);
    restartAutoRefresh();
  });

  if (internalActorModeSelect && internalActorModeInput) {
    internalActorModeSelect.addEventListener("change", () => {
      internalActorModeInput.value = internalActorModeSelect.value;
      const params = new URLSearchParams(window.location.search);
      if (contactSelect.value) params.set("contactId", contactSelect.value);
      params.set("actor", internalActorModeSelect.value);
      window.location.search = params.toString();
    });
  }

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const contactId = contactSelect.value;
    const message = chatInput.value.trim();
    if (!contactId) {
      chatStatus.textContent = "Selecciona un contacto.";
      return;
    }
    if (selectedContactConfiguredInput && selectedContactConfiguredInput.value !== "true") {
      chatStatus.textContent = "El contacto no esta configurado para este canal.";
      return;
    }
    if (!message && !pendingAttachment) return;

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          message,
          attachment: pendingAttachment
            ? {
                originalName: pendingAttachment.originalName,
                mimeType: pendingAttachment.mimeType,
                contentBase64: pendingAttachment.contentBase64,
              }
            : null,
          actor: internalActorModeInput ? internalActorModeInput.value : "user",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo enviar el mensaje.");
      }
      chatInput.value = "";
      clearAttachment();
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
          body: JSON.stringify({
            contactId,
            actor: internalActorModeInput ? internalActorModeInput.value : "user",
          }),
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

  if (attachButton && imageInput) {
    attachButton.addEventListener("click", () => imageInput.click());
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;
      try {
        await setPendingAttachment(file);
        chatStatus.textContent = "Imagen lista para enviar.";
      } catch (error) {
        chatStatus.textContent = error.message;
      }
    });
  }

  if (attachmentClear) {
    attachmentClear.addEventListener("click", clearAttachment);
  }

  if (chatInput) {
    chatInput.addEventListener("paste", handleClipboardPaste);
  }

  if (chatWindow) {
    chatWindow.addEventListener("paste", handleClipboardPaste);
    chatWindow.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.classList.contains("chat-image")) return;
      openImageModal(target.currentSrc || target.src);
    });
  }

  if (imageModalClose) {
    imageModalClose.addEventListener("click", closeImageModal);
  }

  if (imageModal) {
    imageModal.addEventListener("click", (event) => {
      if (event.target === imageModal) {
        closeImageModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeImageModal();
    }
  });

  if (contactSelect.value) {
    loadConversation(contactSelect.value);
    restartAutoRefresh();
  }
})();
