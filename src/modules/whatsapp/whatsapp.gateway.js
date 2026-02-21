let gateway = {
  sendMessage: null,
  isReady: null,
  resolveContactKeys: null,
};

function setGateway(nextGateway) {
  gateway = {
    ...gateway,
    ...nextGateway,
  };
}

async function sendMessage(phone, text) {
  if (!gateway.sendMessage) {
    throw new Error("Cliente de WhatsApp no inicializado.");
  }
  return gateway.sendMessage(phone, text);
}

function isReady() {
  if (!gateway.isReady) return false;
  return gateway.isReady();
}

async function resolveContactKeys(phone) {
  if (!gateway.resolveContactKeys) return [String(phone || "")];
  return gateway.resolveContactKeys(phone);
}

module.exports = {
  setGateway,
  sendMessage,
  isReady,
  resolveContactKeys,
};
