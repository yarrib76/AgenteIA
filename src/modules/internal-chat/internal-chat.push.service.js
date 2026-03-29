const { createSign } = require("crypto");
const mobileDeviceTokensService = require("../mobile/mobile-device-tokens.service");

let cachedAccessToken = {
  token: "",
  expiresAt: 0,
};

function normalizeText(value) {
  return String(value || "").trim();
}

function getConfig() {
  return {
    projectId: normalizeText(process.env.FCM_PROJECT_ID),
    clientEmail: normalizeText(process.env.FCM_CLIENT_EMAIL),
    privateKey: normalizeText(process.env.FCM_PRIVATE_KEY).replace(/\\n/g, "\n"),
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.projectId && config.clientEmail && config.privateKey);
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken() {
  if (cachedAccessToken.token && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }
  const config = getConfig();
  if (!isConfigured()) {
    return "";
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedClaims = base64Url(JSON.stringify(claimSet));
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedClaims}`);
  signer.end();
  const signature = signer.sign(config.privateKey);
  const jwt = `${encodedHeader}.${encodedClaims}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "No se pudo obtener token FCM.");
  }
  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000),
  };
  return cachedAccessToken.token;
}

async function sendPushToUser(userId, { title, body, conversationId }) {
  if (!isConfigured()) {
    return { sent: false, reason: "fcm_not_configured" };
  }
  const config = getConfig();
  const accessToken = await getAccessToken();
  const tokens = await mobileDeviceTokensService.listTokensByUserId(userId);
  if (tokens.length === 0) {
    return { sent: false, reason: "no_device_tokens" };
  }
  let sent = 0;
  for (const device of tokens) {
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: {
                title: title || "Nuevo mensaje",
                body: body || "",
              },
              data: {
                conversationId: normalizeText(conversationId),
                channel: "internal_chat",
              },
              android: {
                priority: "high",
              },
            },
          }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404 || response.status === 400) {
          await mobileDeviceTokensService.unregisterToken(device.token);
        }
        throw new Error(text || `FCM ${response.status}`);
      }
      sent += 1;
    } catch (error) {
      // Continuar con el resto de dispositivos.
    }
  }
  return {
    sent: sent > 0,
    count: sent,
  };
}

module.exports = {
  isConfigured,
  sendPushToUser,
};
