const modelEnvService = require("./model-env.service");
const fs = require("fs/promises");

function normalizeApiKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function inferProviderFromName(modelName) {
  const name = String(modelName || "").toLowerCase();
  if (name.includes("deepseek")) return "deepseek";
  return "openai";
}

function extractText(payload) {
  const text =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content;
  if (!text) return "";
  if (Array.isArray(text)) {
    return text.map((item) => (item && item.text ? item.text : "")).join("\n");
  }
  return String(text);
}

function extractResponsesText(payload) {
  if (payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const part of content) {
      if (part && part.type === "output_text" && part.text) {
        chunks.push(String(part.text));
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAiCompatible({ apiKey, modelName, message }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: message }],
      temperature: 0.2,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : "";
    throw new Error(`Error OpenAI (${response.status}): ${detail || "sin detalle"}`);
  }
  return extractText(payload);
}

async function callOpenAiWithFile({ apiKey, modelName, message, fileAttachment }) {
  const binary = await fs.readFile(fileAttachment.absolutePath);
  const base64 = binary.toString("base64");
  const mime = String(fileAttachment.mimeType || "").trim() || "application/octet-stream";
  const fileData = `data:${mime};base64,${base64}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: message },
            {
              type: "input_file",
              filename: fileAttachment.originalName,
              file_data: fileData,
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : "";
    throw new Error(`Error OpenAI file (${response.status}): ${detail || "sin detalle"}`);
  }
  return extractResponsesText(payload);
}

async function callOpenAiCompatibleCustom({
  apiKey,
  modelName,
  message,
  baseUrl,
}) {
  const url = `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: message }],
      temperature: 0.2,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : "";
    throw new Error(`Error OpenAI Compatible (${response.status}): ${detail || "sin detalle"}`);
  }
  return extractText(payload);
}

async function callDeepSeek({ apiKey, modelName, message }) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: message }],
      temperature: 0.2,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : "";
    throw new Error(`Error DeepSeek (${response.status}): ${detail || "sin detalle"}`);
  }
  return extractText(payload);
}

async function testModel({
  envKey,
  modelName,
  provider,
  modelId,
  baseUrl,
  message,
  fileAttachment,
}) {
  const apiKey = normalizeApiKey(await modelEnvService.getKeyValue(envKey));
  if (!apiKey) {
    throw new Error(`ApiKey vacia en .env para ${envKey}.`);
  }

  const prompt = String(message || "").trim();
  if (!prompt) throw new Error("Escribe un mensaje para probar.");

  const nextProvider = String(provider || "").trim().toLowerCase() || inferProviderFromName(modelName);
  const resolvedModel = String(modelId || "").trim() || String(modelName || "").trim();
  if (!resolvedModel) throw new Error("Model ID vacio.");

  if (
    nextProvider === "openai" &&
    fileAttachment &&
    String(fileAttachment.extension || "").toLowerCase() !== ".pdf"
  ) {
    throw new Error(
      "OpenAI en esta implementacion solo admite adjunto PDF. Convierte el archivo a PDF o usa entrada textual."
    );
  }

  if (nextProvider === "deepseek") {
    try {
      return await callDeepSeek({
        apiKey,
        modelName: resolvedModel,
        message: prompt,
      });
    } catch (error) {
      throw new Error(
        `${error.message}. Modelo usado: ${resolvedModel}. Prueba con 'deepseek-chat' o 'deepseek-reasoner'.`
      );
    }
  }
  if (nextProvider === "openai" && fileAttachment) {
    return callOpenAiWithFile({
      apiKey,
      modelName: resolvedModel,
      message: prompt,
      fileAttachment,
    });
  }
  if (nextProvider === "openai_compatible") {
    if (!String(baseUrl || "").trim()) {
      throw new Error("Base URL requerida para OpenAI Compatible.");
    }
    return callOpenAiCompatibleCustom({
      apiKey,
      modelName: resolvedModel,
      message: prompt,
      baseUrl,
    });
  }
  return callOpenAiCompatible({
    apiKey,
    modelName: resolvedModel,
    message: prompt,
  });
}

module.exports = {
  testModel,
};
