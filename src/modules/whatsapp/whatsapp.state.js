const state = {
  linked: false,
  statusText: "Inicializando",
  phoneNumber: null,
  qrDataUrl: null,
  lastUpdate: new Date().toISOString(),
  hasClient: false,
};

let refresher = null;
let broadcaster = null;

function setHooks({ onRefresh, onBroadcast }) {
  refresher = onRefresh;
  broadcaster = onBroadcast;
}

function patchState(patch) {
  Object.assign(state, patch, { lastUpdate: new Date().toISOString() });
  if (broadcaster) broadcaster(getPublicStatus());
}

function getPublicStatus() {
  return {
    linked: state.linked,
    statusText: state.statusText,
    phoneNumber: state.phoneNumber,
    qrDataUrl: state.qrDataUrl,
    lastUpdate: state.lastUpdate,
    hasClient: state.hasClient,
  };
}

async function refreshQr() {
  if (!refresher) {
    throw new Error("Servicio de WhatsApp aun no inicializado.");
  }
  await refresher();
}

module.exports = {
  setHooks,
  patchState,
  getPublicStatus,
  refreshQr,
};

