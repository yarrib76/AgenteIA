const http = require("http");
const app = require("./app");
const buildWhatsAppService = require("./modules/whatsapp/whatsapp.service");
const buildTelegramService = require("./modules/telegram/telegram.service");
const buildTaskSchedulerService = require("./modules/task/task-scheduler.service");

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const { init: initWhatsApp, attachIo } = buildWhatsAppService();
const { init: initTelegram, stop: stopTelegram, attachIo: attachTelegramIo } = buildTelegramService();
const { start: startTaskScheduler, stop: stopTaskScheduler } = buildTaskSchedulerService();
const io = require("socket.io")(server);
attachIo(io);
attachTelegramIo(io);
app.set("io", io);

initWhatsApp().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Error inicializando WhatsApp:", error.message);
});

initTelegram().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Error inicializando Telegram:", error.message);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Promesa no manejada:", reason);
});

process.on("uncaughtException", (error) => {
  // eslint-disable-next-line no-console
  console.error("Excepcion no capturada:", error);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  startTaskScheduler();
});

process.on("SIGINT", () => {
  stopTaskScheduler();
  stopTelegram();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopTaskScheduler();
  stopTelegram();
  process.exit(0);
});
