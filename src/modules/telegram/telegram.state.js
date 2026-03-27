const state = {
  linked: false,
  statusText: "Telegram no configurado.",
  phoneNumber: null,
  qrDataUrl: null,
  lastUpdate: new Date().toISOString(),
  hasClient: false,
  botUsername: "",
  configured: false,
  polling: false,
};

let refresher = null;
let broadcaster = null;

function setHooks({ onRefresh, onBroadcast }) {
  refresher = onRefresh;
  broadcaster = onBroadcast;
}

function patchState(patch) {
  Object.assign(state, patch, { lastUpdate: new Date().toISOString() });
  if (broadcaster) {
    broadcaster(getPublicStatus());
  }
}

function getPublicStatus() {
  return {
    linked: state.linked,
    statusText: state.statusText,
    phoneNumber: state.phoneNumber,
    qrDataUrl: state.qrDataUrl,
    lastUpdate: state.lastUpdate,
    hasClient: state.hasClient,
    botUsername: state.botUsername,
    configured: state.configured,
    polling: state.polling,
  };
}

async function refreshLink() {
  if (!refresher) {
    throw new Error("Servicio de Telegram aun no inicializado.");
  }
  await refresher();
}

module.exports = {
  setHooks,
  patchState,
  getPublicStatus,
  refreshLink,
};
