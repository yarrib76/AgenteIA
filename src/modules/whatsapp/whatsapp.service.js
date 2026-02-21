const path = require("path");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const whatsappState = require("./whatsapp.state");
const whatsappGateway = require("./whatsapp.gateway");
const { addMessage } = require("../chat/messages.service");
const { normalizePhone } = require("../agenda/contacts.service");
const contactAliasesService = require("../agenda/contact-aliases.service");
const taskReplyRoutesService = require("../task/task-reply-routes.service");

function buildWhatsAppService() {
  let io = null;
  let client = null;
  let initializing = false;
  let initPromise = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let refreshInProgress = false;
  let qrWaitTimer = null;
  let initWatchdogTimer = null;

  function broadcast(status) {
    if (!io) return;
    io.emit("whatsapp-status", status);
  }

  async function refreshQrInternal() {
    if (refreshInProgress) return;
    refreshInProgress = true;

    const snapshot = whatsappState.getPublicStatus();

    if (snapshot.linked) {
      // Con vinculacion activa no hay QR nuevo; la sesion ya es persistente.
      whatsappState.patchState({
        statusText: "Ya esta vinculado. No se requiere generar un nuevo QR.",
      });
      refreshInProgress = false;
      return;
    }

    whatsappState.patchState({
      linked: false,
      statusText: "Generando un nuevo QR...",
      phoneNumber: null,
    });
    armQrWaitTimeout();

    try {
      if (initializing && initPromise) {
        await initPromise.catch(() => {});
      }

      if (!client) {
        await initWhatsApp();
        return;
      }

      await safeDestroyClient();
      client = null;
      await initWhatsApp();
    } finally {
      refreshInProgress = false;
    }
  }

  async function safeDestroyClient() {
    if (!client) return;
    try {
      await client.destroy();
    } catch (error) {
      // Ignorar errores al destruir una instancia en carrera de navegacion.
    }
  }

  function toChatId(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new Error("Numero de WhatsApp invalido.");
    }
    return `${normalized}@c.us`;
  }

  function toContactKeyFromChatId(chatId) {
    if (!chatId) return null;
    return normalizePhone(String(chatId).split("@")[0]);
  }

  async function resolveContactKeysInternal(phone) {
    const keys = new Set(await contactAliasesService.getAliases(phone));
    const normalized = normalizePhone(phone);
    if (normalized) keys.add(normalized);

    const status = whatsappState.getPublicStatus();
    if (!client || !status.linked) return Array.from(keys);

    try {
      const userIds = [normalized, `${normalized}@c.us`, `${normalized}@lid`];
      const resolved = await client.getContactLidAndPhone(userIds);
      for (const item of resolved || []) {
        const lidKey = toContactKeyFromChatId(item && item.lid);
        const pnKey = toContactKeyFromChatId(item && item.pn);
        if (lidKey) keys.add(lidKey);
        if (pnKey) keys.add(pnKey);
      }
      await contactAliasesService.addAliases(normalized, Array.from(keys));
    } catch (error) {
      // Si no se puede resolver, se mantiene el numero base.
    }

    return Array.from(keys);
  }

  async function sendMessageInternal(phone, text) {
    if (!client) throw new Error("Cliente de WhatsApp no disponible.");
    const status = whatsappState.getPublicStatus();
    if (!status.linked) throw new Error("WhatsApp no esta vinculado.");

    let chatId = toChatId(phone);
    try {
      const normalized = normalizePhone(phone);
      const resolved = await client.getContactLidAndPhone([
        normalized,
        `${normalized}@c.us`,
        `${normalized}@lid`,
      ]);
      const first = resolved && resolved[0] ? resolved[0] : null;
      if (first && first.lid) {
        chatId = first.lid;
      } else if (first && first.pn) {
        chatId = first.pn;
      } else {
        const numberId = await client.getNumberId(normalized);
        if (numberId && numberId._serialized) {
          chatId = numberId._serialized;
        }
      }
    } catch (error) {
      // Fallback a c.us armado manualmente.
    }

    await client.sendMessage(chatId, text);
    await contactAliasesService.addAliases(normalizePhone(phone), [
      toContactKeyFromChatId(chatId),
      normalizePhone(phone),
    ]);
    return {
      chatId,
      contactKey: toContactKeyFromChatId(chatId) || normalizePhone(phone),
    };
  }

  async function routeTaskReplyIfNeeded(sourcePhone, text) {
    const routes = await taskReplyRoutesService.findActiveRoutesBySourcePhone(sourcePhone);
    if (!routes || routes.length === 0) return;

    const dedup = new Map();
    for (const route of routes) {
      if (!route.destinationPhone) continue;
      if (!dedup.has(route.destinationPhone)) {
        dedup.set(route.destinationPhone, route);
      }
    }

    for (const route of dedup.values()) {
      try {
        await sendMessageInternal(route.destinationPhone, text);
        await addMessage({
          contactPhone: route.destinationPhone,
          direction: "out",
          text,
          status: "routed_from_task_reply",
        });
      } catch (error) {
        // Si falla un destino, no se interrumpe el procesamiento del resto.
      }
    }
  }

  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    reconnectAttempts += 1;
    const waitMs = Math.min(1500 * reconnectAttempts, 10000);

    whatsappState.patchState({
      linked: false,
      statusText: `${reason} Reintentando en ${Math.round(waitMs / 1000)}s...`,
      phoneNumber: null,
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      refreshQrInternal().catch((error) => {
        whatsappState.patchState({
          statusText: `Error al reconectar WhatsApp: ${error.message}`,
        });
      });
    }, waitMs);
  }

  function attachIo(nextIo) {
    io = nextIo;
    io.on("connection", (socket) => {
      socket.emit("whatsapp-status", whatsappState.getPublicStatus());
    });
  }

  function armQrWaitTimeout() {
    if (qrWaitTimer) clearTimeout(qrWaitTimer);
    qrWaitTimer = setTimeout(() => {
      const snapshot = whatsappState.getPublicStatus();
      if (!snapshot.linked && !snapshot.qrDataUrl) {
        whatsappState.patchState({
          statusText: "Aun no se pudo generar el QR. Reintenta en unos segundos.",
        });
      }
    }, 15000);
  }

  function clearTimers() {
    if (qrWaitTimer) {
      clearTimeout(qrWaitTimer);
      qrWaitTimer = null;
    }
    if (initWatchdogTimer) {
      clearTimeout(initWatchdogTimer);
      initWatchdogTimer = null;
    }
  }

  async function initWhatsApp() {
    if (initializing && initPromise) return initPromise;
    initializing = true;

    initPromise = (async () => {
      whatsappState.patchState({
        hasClient: true,
        statusText: "Iniciando cliente de WhatsApp...",
      });
      armQrWaitTimeout();

      const authDir = path.join(process.cwd(), ".wwebjs_auth");
      client = new Client({
        authStrategy: new LocalAuth({
          clientId: "agenteia-main",
          dataPath: authDir,
        }),
        puppeteer: {
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      });

      initWatchdogTimer = setTimeout(async () => {
        const snapshot = whatsappState.getPublicStatus();
        if (!snapshot.linked && !snapshot.qrDataUrl) {
          whatsappState.patchState({
            statusText: "Timeout de inicializacion. Reiniciando cliente WhatsApp...",
          });
          await safeDestroyClient();
          client = null;
          scheduleReconnect("Cliente sin respuesta.");
        }
      }, 25000);

      client.on("loading_screen", (percent, message) => {
        whatsappState.patchState({
          statusText: `Cargando WhatsApp Web (${percent}%): ${message}`,
        });
      });

      client.on("qr", async (qr) => {
        try {
          clearTimers();
          const qrDataUrl = await QRCode.toDataURL(qr);
          whatsappState.patchState({
            linked: false,
            statusText: "Escanea el QR para vincular el dispositivo.",
            qrDataUrl,
            phoneNumber: null,
          });
        } catch (error) {
          whatsappState.patchState({
            linked: false,
            statusText: `No se pudo renderizar el QR: ${error.message}`,
            qrDataUrl: null,
            phoneNumber: null,
          });
        }
      });

      client.on("authenticated", () => {
        clearTimers();
        reconnectAttempts = 0;
        whatsappState.patchState({
          statusText: "Autenticado. Esperando estado listo...",
        });
      });

      client.on("ready", async () => {
        clearTimers();
        let phoneNumber = null;
        try {
          const wid = client.info && client.info.wid ? client.info.wid.user : null;
          phoneNumber = wid || null;
        } catch (error) {
          phoneNumber = null;
        }

        whatsappState.patchState({
          linked: true,
          statusText: "Vinculado y listo.",
          qrDataUrl: null,
          phoneNumber,
        });
        reconnectAttempts = 0;
      });

      client.on("message", async (message) => {
        try {
          if (message.fromMe) return;
          if (!message.from || message.from.includes("@g.us")) return;
          const fromRaw = String(message.from);
          const fromKey = normalizePhone(fromRaw.split("@")[0]);
          let contactPhone =
            (await contactAliasesService.findCanonicalByAlias(fromKey)) || fromKey;

          if (fromRaw.endsWith("@lid")) {
            try {
              const resolved = await client.getContactLidAndPhone([fromRaw]);
              const first = resolved && resolved[0] ? resolved[0] : null;
              const pnKey = toContactKeyFromChatId(first && first.pn);
              if (pnKey) {
                contactPhone = pnKey;
                await contactAliasesService.addAliases(pnKey, [fromKey, pnKey]);
              }
            } catch (error) {
              // fallback a alias local.
            }
          }

          const text = message.body || "";
          if (!text.trim()) return;
          await addMessage({
            contactPhone,
            direction: "in",
            text,
            status: "received",
          });
          await routeTaskReplyIfNeeded(contactPhone, text);
        } catch (error) {
          // No interrumpir la sesion por falla de persistencia.
        }
      });

      client.on("change_state", (nextState) => {
        const base = whatsappState.getPublicStatus();
        whatsappState.patchState({
          statusText: base.linked
            ? `Conectado (${nextState})`
            : `Pendiente de vincular (${nextState})`,
        });
      });

      client.on("auth_failure", (message) => {
        clearTimers();
        whatsappState.patchState({
          linked: false,
          statusText: `Fallo de autenticacion: ${message}`,
          qrDataUrl: null,
          phoneNumber: null,
        });
        scheduleReconnect("Fallo de autenticacion.");
      });

      client.on("disconnected", (reason) => {
        clearTimers();
        scheduleReconnect(`Desconectado: ${reason}.`);
      });

      client.on("change_battery", () => {
        // Evento opcional en algunas versiones; se define para mantener estabilidad.
      });

      client.on("error", (error) => {
        scheduleReconnect(`Error del cliente: ${error.message}.`);
      });

      try {
        await client.initialize();
      } catch (error) {
        clearTimers();
        await safeDestroyClient();
        client = null;
        scheduleReconnect(`Fallo al inicializar cliente: ${error.message}.`);
        throw error;
      }
    })();

    try {
      await initPromise;
    } finally {
      clearTimers();
      initializing = false;
      initPromise = null;
    }
  }

  whatsappState.setHooks({
    onRefresh: refreshQrInternal,
    onBroadcast: broadcast,
  });

  whatsappGateway.setGateway({
    sendMessage: sendMessageInternal,
    isReady: () => {
      const status = whatsappState.getPublicStatus();
      return Boolean(status.linked);
    },
    resolveContactKeys: resolveContactKeysInternal,
  });

  return {
    init: initWhatsApp,
    attachIo,
  };
}

module.exports = buildWhatsAppService;
