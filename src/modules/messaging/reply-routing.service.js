const messagingGateway = require("./messaging.gateway");
const taskReplyRoutesService = require("../task/task-reply-routes.service");
const { addMessage } = require("../chat/messages.service");

async function routeTaskReplyIfNeeded({
  channel,
  sourceTarget,
  text,
  quotedMessageId = "",
  isGroup = false,
  groupName = "",
  authorName = "",
  authorTarget = "",
}) {
  const routeWindowHours = Number.parseInt(
    String(process.env.TASK_REPLY_ROUTE_WINDOW_HOURS || "168"),
    10
  );
  const selection = await taskReplyRoutesService.findRoutesForIncoming({
    channel,
    sourcePhone: sourceTarget,
    quotedMessageId,
    maxAgeHours: routeWindowHours,
  });
  const routes = selection && Array.isArray(selection.routes) ? selection.routes : [];
  if (routes.length === 0) return;

  for (const route of routes) {
    try {
      const headerLine = isGroup
        ? `[Grupo: ${String(groupName || sourceTarget)}] [Autor: ${String(
            authorName || authorTarget || "desconocido"
          )}]`
        : `[Autor: ${String(authorName || authorTarget || sourceTarget || "desconocido")}]`;
      const originalLine = String(route.originalMessage || "").trim()
        ? `Mensaje original:\n${String(route.originalMessage || "").trim()}`
        : "Mensaje original:\n(No disponible)";
      const replyLine = `Respuesta entrante:\n${String(text || "").trim()}`;
      const finalText = [headerLine, originalLine, replyLine].join("\n\n");

      await messagingGateway.sendMessage(route.destinationPhone, finalText, { channel });
      await addMessage({
        channel,
        contactPhone: route.destinationPhone,
        direction: "out",
        text: finalText,
        status: "routed_from_task_reply",
      });
      await taskReplyRoutesService.markRouteResponded(route.id);
    } catch (error) {
      // Un fallo en una ruta no debe frenar las demas.
    }
  }
}

module.exports = {
  routeTaskReplyIfNeeded,
};
